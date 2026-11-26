// Shared helpers for the Android build scripts. Works on Windows, macOS and Linux.
// The tools go into tools/ (see setup-tools.ts). Nothing is installed system-wide.

import { spawnSync } from 'node:child_process';
import {
  chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

export const here = dirname(fileURLToPath(import.meta.url));
export const tools = join(here, '..', 'tools');

export const isWindows = process.platform === 'win32';
export const osName: 'windows' | 'mac' | 'linux' =
  isWindows ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
export const archName: 'x64' | 'aarch64' = process.arch === 'arm64' ? 'aarch64' : 'x64';

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The app's original signing key. The lineage starts at this key (APK Signature Scheme v3 rotation). */
export const keystorePath = join(here, 'hub.keystore');
/** The app's current signing key. The lineage rotates to this key. */
export const newKeystorePath = join(here, 'hub-new.keystore');
/** The signing-certificate lineage: proof that the original key hands over to the new key. Public certificates only. */
export const lineagePath = join(here, 'hub.lineage');

/** The web page bundle that scripts/build-page.ts writes (npm run build:page). The APK holds it under assets/page/. */
export const pageBundleDir = join(here, '..', 'dist', 'page');

/**
 * Returns the message to stop the build with when the page bundle is incomplete, or null when it is whole.
 * The bundle needs index.html, manifest.json, and every file that manifest.json lists.
 */
export function pageBundleProblem(dir: string = pageBundleDir): string | null {
  for (const name of ['index.html', 'manifest.json']) {
    if (!existsSync(join(dir, name))) {
      return `dist/page/${name} is missing. Run npm run build:page, then build the APK again.`;
    }
  }
  let files: { path: string }[];
  try {
    files = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { files?: { path: string }[] }).files ?? [];
  } catch {
    return 'dist/page/manifest.json is not valid JSON. Run npm run build:page again.';
  }
  for (const f of files) {
    if (!existsSync(join(dir, f.path))) {
      return `dist/page${f.path} is listed in manifest.json but missing. Run npm run build:page again.`;
    }
  }
  return null;
}

/** Every file of the page bundle as an APK asset: `from` is the file on disk, `to` its path in the APK (page/...). */
export function pageAssetEntries(dir: string = pageBundleDir): { from: string; to: string }[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => p.split(sep).join('/'))
    .filter((p) => statSync(join(dir, p)).isFile())
    .sort()
    .map((p) => ({ from: join(dir, p), to: `page/${p}` }));
}

/**
 * Returns the message to stop the build with when a signing file is missing, or null when all exist.
 * The files are looked up in dir (android/ by default): hub.keystore, hub-new.keystore and hub.lineage.
 * The build never makes a new key: Android refuses an update signed with a key outside the lineage.
 */
export function keystoreProblem(dir: string = here): string | null {
  if (!existsSync(join(dir, 'hub.keystore'))) {
    return 'android/hub.keystore is missing. Restore the backup copy. The lineage needs the original key, and a new key would make Android refuse every update.';
  }
  if (!existsSync(join(dir, 'hub-new.keystore'))) {
    return 'android/hub-new.keystore is missing. Restore the backup copy. It is the current signing key in android/hub.lineage.';
  }
  if (!existsSync(join(dir, 'hub.lineage'))) {
    return 'android/hub.lineage is missing. Restore it from git. Without the lineage, Android refuses an update signed with the new key.';
  }
  return null;
}

// ---- tool locations ----

/**
 * Finds a tool in a folder. Windows tools end in .exe, .bat or .cmd; macOS and Linux tools have no
 * extension. Returns the first match, or the first candidate name when none exists yet.
 */
export function binPath(dir: string, name: string): string {
  const candidates = isWindows ? [`${name}.exe`, `${name}.bat`, `${name}.cmd`, name] : [name];
  for (const c of candidates) {
    const p = join(dir, c);
    if (existsSync(p)) return p;
  }
  return join(dir, candidates[0]);
}

export const sdkRoot = join(tools, 'android-sdk');
export const buildTools = join(sdkRoot, 'build-tools', '35.0.0');
export const androidJar = join(sdkRoot, 'platforms', 'android-35', 'android.jar');
export const platformTools = join(tools, 'platform-tools');
export const cmdlineLatest = join(sdkRoot, 'cmdline-tools', 'latest');

/** The JDK home. macOS archives keep the home under Contents/Home. */
export function jdkHome(): string {
  const base = join(tools, 'jdk');
  const mac = join(base, 'Contents', 'Home');
  return existsSync(join(mac, 'bin')) ? mac : base;
}

export function jdkTool(name: string): string {
  return binPath(join(jdkHome(), 'bin'), name);
}

export function toolEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    JAVA_HOME: jdkHome(),
    ANDROID_HOME: sdkRoot,
    ANDROID_USER_HOME: join(tools, 'android-user'),
  };
}

// ---- running tools ----

/** Runs a .bat or .cmd file through cmd.exe. Its path can contain spaces, so it is one verbatim line. */
function runThroughCmd(file: string, argv: string[], opts: RunOptions) {
  const line = [file, ...argv].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    env: toolEnv(),
    stdio: opts.quiet ? 'pipe' : 'inherit',
    windowsVerbatimArguments: true,
    input: opts.input,
    encoding: opts.input !== undefined ? 'utf8' : undefined,
  });
}

export interface RunOptions {
  quiet?: boolean;
  input?: string | Buffer;
}

/** Runs a tool and returns how it ended: its exit code, or the error it could not start with (not found, no permission). Batch files go through cmd.exe on Windows. */
export function runResult(exe: string, argv: string[], opts: RunOptions = {}): { status: number | null; signal: string | null; error?: Error } {
  const batch = isWindows && /\.(bat|cmd)$/i.test(exe);
  const result = batch
    ? runThroughCmd(exe, argv, opts)
    : spawnSync(exe, argv, {
      env: toolEnv(),
      stdio: opts.quiet ? 'pipe' : 'inherit',
      input: opts.input,
      encoding: opts.input !== undefined ? 'utf8' : undefined,
    });
  return { status: result.status, signal: result.signal, error: result.error };
}

/** The exit code of a tool, or null when it did not run to an exit. */
export function runStatus(exe: string, argv: string[], opts: RunOptions = {}): number | null {
  return runResult(exe, argv, opts).status;
}

/** What to say when a tool could not start at all: the cause, and what to do when that is a missing tool. */
export function startProblem(exe: string, error: NodeJS.ErrnoException): string {
  const code = error.code ?? error.message;
  const hint = code === 'ENOENT' ? ' Run node android/setup-tools.ts first.' : '';
  return `could not start ${exe}: ${code}.${hint}`;
}

/** Runs a tool. Fails the build on a non-zero exit, and says why when the tool did not start. */
export function run(exe: string, argv: string[], what: string, opts: RunOptions = {}): void {
  const r = runResult(exe, argv, opts);
  if (r.status === 0) return;
  if (r.error) fail(`${what} ${startProblem(exe, r.error as NodeJS.ErrnoException)}`);
  fail(`${what} failed (exit ${r.status ?? r.signal})`);
}

// ---- unpacking ----

/**
 * Unpacks a .zip, .tar.gz or .tgz. When stripTop is true, the archive's single top folder is removed,
 * as the Adoptium and Android archives have one. Zip files use a Node library, so no system zip tool is needed.
 */
export function extract(archive: string, dest: string, stripTop: boolean): Promise<void> {
  mkdirSync(dest, { recursive: true });
  if (/\.(tar\.gz|tgz)$/i.test(archive)) {
    // tar is built into macOS, Linux and Windows 10+.
    const args = ['-xzf', archive, '-C', dest];
    if (stripTop) args.push('--strip-components=1');
    const result = spawnSync('tar', args, { stdio: 'inherit' });
    if (result.status !== 0) return Promise.reject(new Error(`unpacking ${archive} failed`));
    return Promise.resolve();
  }
  const root = resolve(dest);
  return new Promise((resolveP, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`cannot open ${archive}`));
      zip.on('error', reject);
      zip.on('end', resolveP);
      zip.on('entry', (entry: yauzl.Entry) => {
        const parts = entry.fileName.split('/').filter(Boolean);
        const rel = stripTop ? parts.slice(1) : parts;
        if (rel.length === 0) { zip.readEntry(); return; }
        const target = resolve(root, ...rel);
        if (target !== root && !target.startsWith(root + sep)) return reject(new Error(`unsafe path in ${archive}: ${entry.fileName}`));

        if (entry.fileName.endsWith('/')) {
          mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }
        mkdirSync(dirname(target), { recursive: true });
        const attrs = entry.externalFileAttributes;
        const mode = (attrs >>> 16) & 0o7777;          // unix permissions, when the archive stores them
        const isLink = ((attrs >>> 16) & 0o170000) === 0o120000;

        zip.openReadStream(entry, (openErr, stream) => {
          if (openErr || !stream) return reject(openErr ?? new Error(`cannot read ${entry.fileName}`));
          if (isLink) {
            // a symbolic link stores its target as the file body
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
              rmSync(target, { force: true });
              symlinkSync(Buffer.concat(chunks).toString('utf8'), target);
              zip.readEntry();
            });
            stream.on('error', reject);
            return;
          }
          rmSync(target, { force: true });
          const out = createWriteStream(target);
          stream.on('error', reject);
          out.on('error', reject);
          out.on('finish', () => {
            if (mode) chmodSync(target, mode);
            zip.readEntry();
          });
          stream.pipe(out);
        });
      });
      zip.readEntry();
    });
  });
}
