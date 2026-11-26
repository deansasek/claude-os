// Fetches what voice needs into tools/voice (nothing is installed on the PC):
//   - Vosk for Android (offline speech recognition, Apache 2.0) and JNA, which it uses, from Maven Central
//   - a small English Vosk model (~40 MB), from alphacephei.com
// android/build.ts picks these up when they are there: the jars go on the classpath, the arm64 .so files
// into the APK's lib/, and the model into the APK's assets (unpacked on the tablet on first use).
//
// --model picks another Vosk model, e.g. the larger, more accurate (and ~4x bigger) one:
//   node android/setup-voice.ts --model vosk-model-en-us-0.22-lgraph

import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract, fail, tools } from './toolchain.ts';

const voice = join(tools, 'voice');
const dl = join(voice, 'download');
mkdirSync(dl, { recursive: true });

function parseModel(argv: string[]): string {
  const i = argv.indexOf('--model');
  if (i === -1) return 'vosk-model-small-en-us-0.15';
  const value = argv[i + 1];
  if (!value) fail('--model needs a model name.');
  return value;
}

// Unpack into a short temp folder, then copy only the files the build needs into tools/voice.
// That keeps the deep model paths out of the long tools/ path.
function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'hub-voice-'));
}

async function download(url: string, name: string): Promise<string> {
  const to = join(dl, name);
  if (!existsSync(to)) {
    console.log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
    // written under a .part name and renamed when whole: a cut-off download is not taken for the file on the next run
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(to + '.part'));
    renameSync(to + '.part', to);
  }
  return to;
}

async function main(): Promise<void> {
  const model = parseModel(process.argv.slice(2));
  const aars = [
    { url: 'https://repo1.maven.org/maven2/com/alphacephei/vosk-android/0.3.75/vosk-android-0.3.75.aar', name: 'vosk-android.aar', lib: 'vosk-android' },
    { url: 'https://repo1.maven.org/maven2/net/java/dev/jna/jna/5.18.1/jna-5.18.1.aar', name: 'jna.aar', lib: 'jna' },
  ];
  const modelUrl = `https://alphacephei.com/vosk/models/${model}.zip`;

  const aarFiles = await Promise.all(aars.map((a) => download(a.url, a.name)));
  const modelZip = await download(modelUrl, `${model}.zip`);

  // classes.jar + jni/arm64-v8a/*.so from each AAR
  const lib = join(voice, 'lib', 'arm64-v8a');
  const jars = join(voice, 'jars');
  mkdirSync(lib, { recursive: true });
  mkdirSync(jars, { recursive: true });
  for (const [i, a] of aars.entries()) {
    const dir = scratchDir();
    await extract(aarFiles[i], dir, false);
    try {
      cpSync(join(dir, 'classes.jar'), join(jars, `${a.lib}.jar`));
      const nativeDir = join(dir, 'jni', 'arm64-v8a');
      if (existsSync(nativeDir)) {
        for (const so of readdirSync(nativeDir).filter((n) => n.endsWith('.so'))) {
          cpSync(join(nativeDir, so), join(lib, so));
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // the model goes into assets/model-en-us, with a uuid file so the app knows when it changed
  const assets = join(voice, 'assets');
  rmSync(assets, { recursive: true, force: true });
  const modelDir = join(assets, 'model-en-us');
  mkdirSync(modelDir, { recursive: true });
  const dir = scratchDir();
  await extract(modelZip, dir, false);
  try {
    const tops = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    if (tops.length !== 1) fail(`expected one top folder in ${model}.zip, found ${tops.length}`);
    const top = tops[0];
    cpSync(join(dir, top), modelDir, { recursive: true });
    // Set-Content -Encoding ascii wrote CRLF line endings; keep them so the app reads the same file.
    writeFileSync(join(modelDir, 'uuid'), `${top}\r\n`, 'ascii');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`voice tools ready in ${voice}`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
