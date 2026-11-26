// Builds the tablet app without Gradle, using only the tools in tools (see setup-tools.ts):
//   aapt2 (resources + manifest) -> javac -> d8 (dex) -> zipalign -> apksigner
// Works on Windows, macOS and Linux.
// Output: android/build/claude-hub.apk
// Install / update it:   node android/build.ts --install [--device <serial>]

import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import {
  androidJar, binPath, buildTools, fail, here, jdkTool, keystorePath, keystoreProblem, lineagePath, newKeystorePath, pageAssetEntries,
  pageBundleProblem, platformTools, run, tools,
} from './toolchain.ts';

function args(argv: string[]): { install: boolean; device: string } {
  const install = argv.includes('--install');
  const i = argv.indexOf('--device');
  const device = i === -1 ? '' : argv[i + 1] ?? '';
  if (i !== -1 && !device) fail('--device needs a device serial.');
  return { install, device };
}

// Every file under dir with a given extension, as absolute paths.
function filesUnder(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => join(e.parentPath ?? (e as any).path, e.name));
}

/**
 * Writes HubConfig.java with the hub's address, from config.json at the repository root: its host and port.
 * The host must be this PC's address on the home network. 0.0.0.0 (listen on all) can't be used here.
 */
function writeHubConfig(genDir: string): void {
  const file = join(here, '..', 'config.json');
  if (!existsSync(file)) fail('config.json is missing. Run npm run setup and set the address the tablet should use.');
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as { host?: unknown; port?: unknown };
  const host = typeof cfg.host === 'string' ? cfg.host.trim() : '';
  if (!host || host === '0.0.0.0' || !/^[\w.\-:[\]]+$/.test(host)) {
    fail('config.json needs "host" set to this PC\'s address on your home network (for example 192.168.1.20), not 0.0.0.0. The tablet loads its page from there.');
  }
  const port = Number.isInteger(cfg.port) ? cfg.port as number : 8000;
  const url = `http://${host}:${port}/?device=tablet`;
  const pkg = join(genDir, 'hub', 'kiosk');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'HubConfig.java'),
    `package hub.kiosk;\n\n// Written by android/build.ts from config.json. Do not edit.\nfinal class HubConfig {\n  static final String DEFAULT_URL = "${url}";\n  private HubConfig() {}\n}\n`);
  console.log(`tablet loads ${url}`);
}

function main(): void {
  const { install, device } = args(process.argv.slice(2));
  // the signing key must already exist (stop before any work; never make a new one)
  const keyProblem = keystoreProblem();
  if (keyProblem) fail(keyProblem);
  // the passwords too: a missing one fails here, not after the whole build
  if (!process.env.CLAUDEOS_KEYSTORE_PASS) fail('Set CLAUDEOS_KEYSTORE_PASS to the original signing key password (docs/SETUP.md).');
  if (!process.env.CLAUDEOS_KEYSTORE_PASS_NEW) fail('Set CLAUDEOS_KEYSTORE_PASS_NEW to the new signing key password (docs/SETUP.md).');
  // the web page bundle (scripts/build-page.ts) goes into the APK as assets/page/; stop if it is not whole
  run(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, '..', 'scripts', 'build-page.ts')], 'npm run build:page');
  const pageProblem = pageBundleProblem();
  if (pageProblem) fail(pageProblem);
  const out = join(here, 'build');
  rmSync(out, { recursive: true, force: true });
  const gen = join(out, 'gen');
  const classes = join(out, 'classes');
  const dex = join(out, 'dex');
  for (const d of [gen, classes, dex]) mkdirSync(d, { recursive: true });

  const aapt2 = binPath(buildTools, 'aapt2');
  const zipalign = binPath(buildTools, 'zipalign');
  const d8 = binPath(buildTools, 'd8');
  const apksigner = binPath(buildTools, 'apksigner');
  const javac = jdkTool('javac');
  const jarTool = jdkTool('jar');
  const adb = binPath(platformTools, 'adb');

  // voice (Vosk + JNA + the speech model), fetched by setup-voice.ts into tools/voice
  const voice = join(tools, 'voice');
  if (!existsSync(join(voice, 'assets', 'model-en-us', 'uuid'))) {
    fail('voice parts missing: run node android/setup-voice.ts once');
  }
  const voiceJars = filesUnder(join(voice, 'jars'), '.jar');
  // androidx.webkit 1.12.1 (tools/webkit, fetched from Google's Maven: WebSettingsCompat, the X-Requested-With allow-list)
  const webkitJar = join(tools, 'webkit', 'webkit-classes.jar');
  if (!existsSync(webkitJar)) fail('androidx.webkit missing: see tools/webkit (webkit-1.12.1.aar, classes.jar)');

  // the hub's address for the tablet, from config.json (the Java reads it from HubConfig)
  writeHubConfig(gen);

  // 1. resources and manifest
  run(aapt2, ['compile', '--dir', join(here, 'res'), '-o', join(out, 'res.zip')], 'aapt2 compile');
  run(aapt2, [
    'link', '-o', join(out, 'base.apk'), '-I', androidJar,
    '--manifest', join(here, 'AndroidManifest.xml'), '--java', gen, join(out, 'res.zip'),
  ], 'aapt2 link');

  // 2. java -> class files. javac reads the source list from an argument file (Windows command-line limit).
  const sources = [...filesUnder(join(here, 'src'), '.java'), ...filesUnder(gen, '.java')];
  const argFile = join(out, 'javac-sources.txt');
  writeFileSync(argFile, sources.map((s) => `"${s.replace(/\\/g, '\\\\')}"`).join('\n'));
  const classpath = [androidJar, ...voiceJars, webkitJar].join(delimiter);
  run(javac, [
    '-nowarn', '-Xlint:-options', '-source', '17', '-target', '17', '-encoding', 'UTF-8',
    '-cp', classpath, '-d', classes, `@${argFile}`,
  ], 'javac');

  // 3. class files (+ the voice libraries) -> classes.dex
  // (packed into one jar first: listing every .class file overflows Windows' command-line limit)
  const appJar = join(out, 'app-classes.jar');
  run(jarTool, ['-cf', appJar, '-C', classes, '.'], 'jar');
  run(d8, [
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
  // native libraries kept in the repository (android/src/jniLibs/arm64-v8a: the musl loader libmuslld.so, cli/ClaudeCli)
  for (const so of filesUnder(join(here, 'src', 'jniLibs', 'arm64-v8a'), '.so')) {
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
  // the web page bundle: every file under dist/page goes to assets/page/ (the manifest is page/manifest.json)
  const pageFiles = pageAssetEntries();
  for (const entry of pageFiles) {
    const target = join(stageRest, 'assets', ...entry.to.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(entry.from, target);
  }
  console.log(`page bundle in the APK: ${pageFiles.length} files under assets/page/`);
  run(jarTool, ['-u', '-f', unsigned, '-C', stageRest, '.'], 'jar (libs and assets)');

  run(zipalign, ['-p', '-f', '4', unsigned, join(out, 'aligned.apk')], 'zipalign');

  // Key rotation (APK Signature Scheme v3): the original key (hub.keystore) signs first, the new key
  // (hub-new.keystore) is the next signer, and hub.lineage proves the hand-over, so an installed app
  // signed with the original key accepts the update. Both keys sit next to this script.
  // The passwords come from the environment, never from this file (see docs/SETUP.md).
  const apk = join(out, 'claude-hub.apk');
  run(apksigner, [
    'sign',
    '--ks', keystorePath, '--ks-key-alias', 'hub',
    '--ks-pass', 'env:CLAUDEOS_KEYSTORE_PASS', '--key-pass', 'env:CLAUDEOS_KEYSTORE_PASS',
    '--next-signer',
    '--ks', newKeystorePath, '--ks-key-alias', 'hub',
    '--ks-pass', 'env:CLAUDEOS_KEYSTORE_PASS_NEW', '--key-pass', 'env:CLAUDEOS_KEYSTORE_PASS_NEW',
    '--lineage', lineagePath,
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
