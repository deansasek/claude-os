// Installs everything needed to build the tablet app into tools, nothing system-wide:
//   tools/jdk          Eclipse Temurin JDK 21
//   tools/android-sdk  Android command-line tools, platform 35, build-tools 35.0.0
//   tools/android-user sdkmanager's own settings (instead of ~/.android)
// Works on Windows, macOS (Intel and Apple Silicon) and Linux. Re-running is safe: finished parts are skipped.
// Usage: node android/setup-tools.ts

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  archName, binPath, buildTools, cmdlineLatest, extract, fail, jdkHome, osName, platformTools, run, runStatus, sdkRoot, tools,
} from './toolchain.ts';

const dl = join(tools, 'download');
mkdirSync(dl, { recursive: true });

async function getArchive(url: string, name: string): Promise<string> {
  const archive = join(dl, name);
  if (!existsSync(archive)) {
    console.log(`downloading ${name}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
    // written under a .part name and renamed when whole: a cut-off download is not taken for the archive on the next run
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(archive + '.part'));
    renameSync(archive + '.part', archive);
  }
  return archive;
}

async function main(): Promise<void> {
  // ---- JDK ----
  // Windows gets a zip; macOS and Linux get a tar.gz. The mac build is under Contents/Home (see jdkHome).
  const jdk = join(tools, 'jdk');
  if (!existsSync(join(jdkHome(), 'bin', osName === 'windows' ? 'javac.exe' : 'javac'))) {
    const ext = osName === 'windows' ? 'zip' : 'tar.gz';
    const jdkArch = osName === 'mac' && archName === 'aarch64' ? 'aarch64' : 'x64';
    const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${osName}/${jdkArch}/jdk/hotspot/normal/eclipse`;
    const archive = await getArchive(url, `jdk21.${ext}`);
    rmSync(jdk, { recursive: true, force: true });
    await extract(archive, jdk, true);
  }
  console.log('jdk ok');

  // ---- Android command-line tools ----
  // Google names the packages win, mac and linux. Try the newest build first, then the older one.
  const platformName = osName === 'windows' ? 'win' : osName === 'mac' ? 'mac' : 'linux';
  const sdkmanagerName = binPath(join(cmdlineLatest, 'bin'), 'sdkmanager');
  if (!existsSync(sdkmanagerName)) {
    let archive: string | null = null;
    for (const v of ['13114758', '11076708']) {
      try {
        archive = await getArchive(`https://dl.google.com/android/repository/commandlinetools-${platformName}-${v}_latest.zip`, `cmdline-tools-${platformName}-${v}.zip`);
        break;
      } catch {
        console.log(`cmdline-tools ${v} not available`);
      }
    }
    if (!archive) fail('no command-line tools package could be downloaded');
    rmSync(cmdlineLatest, { recursive: true, force: true });
    await extract(archive, cmdlineLatest, true);
  }
  console.log('cmdline-tools ok');

  // ---- platform-tools (adb, used to install the APK on the tablet) ----
  if (!existsSync(binPath(platformTools, 'adb'))) {
    const archive = await getArchive(`https://dl.google.com/android/repository/platform-tools-latest-${platformName === 'win' ? 'windows' : platformName === 'mac' ? 'darwin' : 'linux'}.zip`, `platform-tools-${platformName}.zip`);
    rmSync(platformTools, { recursive: true, force: true });
    await extract(archive, platformTools, true);
  }
  console.log('platform-tools ok');

  // ---- SDK packages (the user accepts the Android SDK License Agreement) ----
  const sm = binPath(join(cmdlineLatest, 'bin'), 'sdkmanager');
  const needsAapt2 = !existsSync(binPath(buildTools, 'aapt2'));
  const needsJar = !existsSync(join(sdkRoot, 'platforms', 'android-35', 'android.jar'));
  if (needsAapt2 || needsJar) {
    // Feed "yes" to the license prompts on stdin. The licence step may exit non-zero when nothing is new,
    // so its status is not checked; the install below is what must succeed.
    const answers = 'y\n'.repeat(30);
    const licences = runStatus(sm, [`--sdk_root=${sdkRoot}`, '--licenses'], { input: answers, quiet: true });
    writeFileSync(join(dl, 'licenses-status.txt'), `sdkmanager --licenses exit ${licences}\n`);
    run(sm, [`--sdk_root=${sdkRoot}`, 'platforms;android-35', 'build-tools;35.0.0'], 'sdkmanager install');
  }
  console.log('sdk ok');
  console.log(readdirSync(tools).join('\n'));
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
