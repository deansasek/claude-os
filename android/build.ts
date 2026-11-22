// Builds the tablet app without Gradle, using only the tools in tools (see setup-tools.ts):
//   aapt2 (resources + manifest) -> javac -> d8 (dex) -> zipalign -> apksigner
// Output: android/build/claude-hub.apk
// Install / update it:   node android/build.ts --install [--device <serial>]

import {
  cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, '..', 'tools');
const sdk = join(tools, 'android-sdk');
const bt = join(sdk, 'build-tools', '35.0.0');
const androidJar = join(sdk, 'platforms', 'android-35', 'android.jar');
const jdk = join(tools, 'jdk');
const javac = join(jdk, 'bin', 'javac.exe');
const keytool = join(jdk, 'bin', 'keytool.exe');
const jarTool = join(jdk, 'bin', 'jar.exe');
const adb = join(tools, 'platform-tools', 'adb.exe');
const env = { ...process.env, JAVA_HOME: jdk };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function args(argv: string[]): { install: boolean; device: string } {
  const install = argv.includes('--install');
  const i = argv.indexOf('--device');
  const device = i === -1 ? '' : argv[i + 1] ?? '';
  if (i !== -1 && !device) fail('--device needs a device serial.');
  return { install, device };
}

// Run an .exe directly. Fails the build on a non-zero exit.
function run(exe: string, argv: string[], what: string, opts: { quiet?: boolean } = {}): void {
  const result = spawnSync(exe, argv, { env, stdio: opts.quiet ? 'pipe' : 'inherit' });
  if (result.status !== 0) fail(`${what} failed (exit ${result.status})`);
}

// Run a .bat (d8.bat, apksigner.bat). cmd.exe needs one verbatim command line when the path has spaces.
function runBat(bat: string, argv: string[], what: string): void {
  const line = [bat, ...argv].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    env,
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) fail(`${what} failed (exit ${result.status})`);
}

// Every file under dir with a given extension, as absolute paths.
function filesUnder(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => join(e.parentPath ?? (e as any).path, e.name));
}

function main(): void {
  const { install, device } = args(process.argv.slice(2));
  const out = join(here, 'build');
  rmSync(out, { recursive: true, force: true });
  const gen = join(out, 'gen');
  const classes = join(out, 'classes');
  const dex = join(out, 'dex');
  for (const d of [gen, classes, dex]) mkdirSync(d, { recursive: true });

  // voice (Vosk + JNA + the speech model), fetched by setup-voice.ts into tools/voice
  const voice = join(tools, 'voice');
  if (!existsSync(join(voice, 'assets', 'model-en-us', 'uuid'))) {
    fail('voice parts missing: run node android/setup-voice.ts once');
  }
  const voiceJars = filesUnder(join(voice, 'jars'), '.jar');
  // androidx.webkit 1.12.1 (tools/webkit, fetched from Google's Maven: WebSettingsCompat, the X-Requested-With allow-list)
  const webkitJar = join(tools, 'webkit', 'webkit-classes.jar');
  if (!existsSync(webkitJar)) fail('androidx.webkit missing: see tools/webkit (webkit-1.12.1.aar, classes.jar)');

  // 1. resources and manifest
  run(join(bt, 'aapt2.exe'), ['compile', '--dir', join(here, 'res'), '-o', join(out, 'res.zip')], 'aapt2 compile');
  run(join(bt, 'aapt2.exe'), [
    'link', '-o', join(out, 'base.apk'), '-I', androidJar,
    '--manifest', join(here, 'AndroidManifest.xml'), '--java', gen, join(out, 'res.zip'),
  ], 'aapt2 link');

  // 2. java -> class files. javac reads the source list from an argument file (Windows command-line limit).
  const sources = [...filesUnder(join(here, 'src'), '.java'), ...filesUnder(gen, '.java')];
  const argFile = join(out, 'javac-sources.txt');
  writeFileSync(argFile, sources.map((s) => `"${s.replace(/\\/g, '\\\\')}"`).join('\n'));
  const classpath = [androidJar, ...voiceJars, webkitJar].join(';');
  run(javac, [
    '-nowarn', '-Xlint:-options', '-source', '17', '-target', '17', '-encoding', 'UTF-8',
    '-cp', classpath, '-d', classes, `@${argFile}`,
  ], 'javac');

  // 3. class files (+ the voice libraries) -> classes.dex
  // (packed into one jar first: listing every .class file overflows Windows' command-line limit)
  const appJar = join(out, 'app-classes.jar');
  run(jarTool, ['-cf', appJar, '-C', classes, '.'], 'jar');
  runBat(join(bt, 'd8.bat'), [
    '--release', '--min-api', '28', '--lib', androidJar, '--output', dex, appJar, ...voiceJars, webkitJar,
  ], 'd8');

  // 4. put the dex into the apk, align, sign
  // The dex is stored uncompressed (jar -0). Native libs and assets are deflated, as before.
  const unsigned = join(out, 'unsigned.apk');
  cpSync(join(out, 'base.apk'), unsigned);
  const stageDex = join(out, 'stage-dex');
  mkdirSync(stageDex);
  cpSync(join(dex, 'classes.dex'), join(stageDex, 'classes.dex'));
  run(jarTool, ['-u', '-0', '-f', unsigned, '-C', stageDex, 'classes.dex'], 'jar (store dex)');

  const stageRest = join(out, 'stage-rest');
  mkdirSync(join(stageRest, 'lib', 'arm64-v8a'), { recursive: true });
  for (const so of filesUnder(join(voice, 'lib', 'arm64-v8a'), '.so')) {  // native speech recogniser (64-bit ARM tablets)
    cpSync(so, join(stageRest, 'lib', 'arm64-v8a', so.split(sep).pop()!));
  }
  // the speech model as assets, plus the app's own assets in android/assets (e.g. the recogniser's warm-up audio)
  for (const root of [join(voice, 'assets'), join(here, 'assets')]) {
    if (!existsSync(root)) continue;
    for (const file of filesUnder(root, '')) {
      if (statSync(file).isDirectory()) continue;
      const rel = relative(root, file).split(sep).join('/');
      const target = join(stageRest, 'assets', ...rel.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(file, target);
    }
  }
  run(jarTool, ['-u', '-f', unsigned, '-C', stageRest, '.'], 'jar (libs and assets)');

  run(join(bt, 'zipalign.exe'), ['-p', '-f', '4', unsigned, join(out, 'aligned.apk')], 'zipalign');

  // the app's signing key: made once, kept next to this script (updates must be signed with the same key)
  const ks = join(here, 'hub.keystore');
  if (!existsSync(ks)) {
    // keytool writes its prompts to stderr; keep them out of the build log
    run(keytool, [
      '-genkeypair', '-keystore', ks, '-alias', 'hub', '-storepass', 'hubkiosk', '-keypass', 'hubkiosk',
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Claude Hub',
    ], 'keytool', { quiet: true });
  }
  const apk = join(out, 'claude-hub.apk');
  runBat(join(bt, 'apksigner.bat'), [
    'sign', '--ks', ks, '--ks-pass', 'pass:hubkiosk', '--key-pass', 'pass:hubkiosk',
    '--out', apk, join(out, 'aligned.apk'),
  ], 'apksigner');
  console.log(`built ${apk} (${Math.round(statSync(apk).size / 1024).toLocaleString('en-US')} KB)`);

  if (install) {
    const sel = device ? ['-s', device] : [];
    run(adb, [...sel, 'install', '-r', apk], 'adb install');
    run(adb, [...sel, 'shell', 'am', 'start', '-n', 'hub.kiosk/.MainActivity'], 'adb start', { quiet: true });
    console.log('installed and started');
  }
}

main();
