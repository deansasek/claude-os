// Installs everything needed to build the tablet app into tools, nothing system-wide:
//   tools/jdk          Eclipse Temurin JDK 21
//   tools/android-sdk  Android command-line tools, platform 35, build-tools 35.0.0
//   tools/android-user sdkmanager's own settings (instead of ~/.android)
// Re-running is safe: finished parts are skipped.
// Usage: node android/setup-tools.ts

import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, '..', 'tools');
const dl = join(tools, 'download');
mkdirSync(dl, { recursive: true });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Windows ships tar.exe, which unpacks zip files. Expand-Archive trips over long paths here.
function unzip(zip: string, into: string): void {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const result = spawnSync('tar', ['-xf', zip, '-C', into, '--strip-components=1'], { stdio: 'inherit' });
  if (result.status !== 0) fail(`unpacking ${zip} failed`);
}

async function getZip(url: string, name: string): Promise<string> {
  const zip = join(dl, name);
  if (!existsSync(zip)) {
    console.log(`downloading ${name}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(zip));
  }
  return zip;
}

async function main(): Promise<void> {
  // ---- JDK ----
  const jdk = join(tools, 'jdk');
  if (!existsSync(join(jdk, 'bin', 'javac.exe'))) {
    const zip = await getZip('https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse', 'jdk21.zip');
    unzip(zip, jdk);
  }
  console.log('jdk ok');

  // ---- Android command-line tools ----
  const sdk = join(tools, 'android-sdk');
  const latest = join(sdk, 'cmdline-tools', 'latest');
  if (!existsSync(join(latest, 'bin', 'sdkmanager.bat'))) {
    let zip: string | null = null;
    for (const v of ['13114758', '11076708']) {
      try {
        zip = await getZip(`https://dl.google.com/android/repository/commandlinetools-win-${v}_latest.zip`, `cmdline-tools-${v}.zip`);
        break;
      } catch {
        console.log(`cmdline-tools ${v} not available`);
      }
    }
    if (!zip) fail('no command-line tools package could be downloaded');
    unzip(zip, latest);
  }
  console.log('cmdline-tools ok');

  // ---- SDK packages (the user accepts the Android SDK License Agreement) ----
  const env = {
    ...process.env,
    JAVA_HOME: jdk,
    ANDROID_USER_HOME: join(tools, 'android-user'),
    ANDROID_HOME: sdk,
  };
  const sm = join(latest, 'bin', 'sdkmanager.bat');
  const needsAapt2 = !existsSync(join(sdk, 'build-tools', '35.0.0', 'aapt2.exe'));
  const needsJar = !existsSync(join(sdk, 'platforms', 'android-35', 'android.jar'));
  if (needsAapt2 || needsJar) {
    // sdkmanager ignores piped input in some hosts; feed the answers from a file instead.
    const yes = join(dl, 'yes.txt');
    writeFileSync(yes, 'y\r\n'.repeat(30));
    const licences = spawnSync('cmd', ['/c', sm, `--sdk_root=${sdk}`, '--licenses'], {
      env,
      input: readFileSync(yes),
      encoding: 'utf8',
    });
    writeFileSync(join(dl, 'licenses-out.txt'), (licences.stdout ?? '') + (licences.stderr ?? ''));
    const install = spawnSync('cmd', ['/c', sm, `--sdk_root=${sdk}`, 'platforms;android-35', 'build-tools;35.0.0'], {
      env,
      stdio: 'inherit',
    });
    if (install.status !== 0) fail('sdkmanager failed to install the SDK packages');
  }
  console.log('sdk ok');
  console.log(readdirSync(tools).join('\n'));
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
