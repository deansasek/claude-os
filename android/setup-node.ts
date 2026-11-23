// SPIKE: fetches what the embedded Node.js test needs into tools/nodejs-mobile (nothing is installed on the PC):
//   - nodejs-mobile v18.20.4 for Android (Node.js 18.20.4 as libnode.so, MIT), from its GitHub release
//   - libc++_shared.so, which libnode.so needs, from Android NDK r24 (the NDK nodejs-mobile builds with).
//     Only that one file is read from the NDK zip, with HTTP range requests (the whole zip is about 670 MB).
//   - Claude Code 2.1.112 from npm: the last release that is a JavaScript package (cli.js, Node >= 18).
//     Later releases are native Linux, macOS and Windows binaries and need Node >= 22.
// android/build.ts --node puts these into the APK (lib/arm64-v8a and assets/node). See hub.kiosk.node.NodeRunner.

import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { extract, fail, tools } from './toolchain.ts';

const NODE_MOBILE = 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip';
const NDK = 'https://dl.google.com/android/repository/android-ndk-r24-linux.zip';
const LIBCXX = 'android-ndk-r24/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so';
const CLAUDE = 'https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.112.tgz';

const root = join(tools, 'nodejs-mobile');
const dl = join(root, 'download');
const lib = join(root, 'lib', 'arm64-v8a');
const assets = join(root, 'assets', 'node');

async function download(url: string, name: string): Promise<string> {
  const to = join(dl, name);
  if (!existsSync(to)) {
    console.log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(to));
  }
  return to;
}

/** Copies one entry of a zip (local file or remote reader) to a file. */
function copyEntry(zip: yauzl.ZipFile, wanted: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let found = false;
    zip.on('error', reject);
    zip.on('end', () => { if (!found) reject(new Error(`${wanted} is not in the zip`)); });
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName !== wanted) { zip.readEntry(); return; }
      found = true;
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error(`cannot read ${wanted}`));
        pipeline(stream, createWriteStream(to)).then(() => { zip.close(); resolve(); }, reject);
      });
    });
    zip.readEntry();
  });
}

/**
 * A yauzl reader that fetches byte ranges of a remote zip, so one file can be read without the whole zip.
 * The zip's tail (its central directory) is fetched once and read from memory: yauzl reads each entry
 * header separately, and the NDK zip has many thousands of entries.
 */
class HttpReader extends yauzl.RandomAccessReader {
  private url: string;
  private tail: Buffer;
  private tailStart: number;
  constructor(url: string, tail: Buffer, tailStart: number) {
    super();
    this.url = url;
    this.tail = tail;
    this.tailStart = tailStart;
  }
  _readStreamForRange(start: number, end: number): Readable {
    if (start >= this.tailStart) return Readable.from([this.tail.subarray(start - this.tailStart, end - this.tailStart)]);
    const out = new PassThrough();
    fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } }).then((r) => {
      if (r.status !== 206 || !r.body) throw new Error(`range request failed (${r.status})`);
      Readable.fromWeb(r.body as any).pipe(out);
    }).catch((e: unknown) => out.destroy(e as Error));
    return out;
  }
}

async function remoteFile(url: string, wanted: string, to: string): Promise<void> {
  // the last 16 MB holds the central directory. Its range answer ("bytes a-b/<size>") also gives the size
  // (dl.google.com's HEAD can report a different length).
  const r = await fetch(url, { headers: { Range: 'bytes=-16777216' } });
  const tail = Buffer.from(await r.arrayBuffer());
  const size = Number(/\/(\d+)$/.exec(r.headers.get('content-range') ?? '')?.[1]);
  if (r.status !== 206 || !size) throw new Error(`cannot read the end of ${url} (${r.status})`);
  const reader = new HttpReader(url, tail, size - tail.length);
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromRandomAccessReader(reader, size, { lazyEntries: true }, (err, z) => (err || !z ? reject(err) : resolve(z)));
  });
  await copyEntry(zip, wanted, to);
}

async function main(): Promise<void> {
  for (const d of [dl, lib, assets]) mkdirSync(d, { recursive: true });

  // 1. libnode.so (arm64 only)
  const nodeZip = await download(NODE_MOBILE, 'nodejs-mobile-android.zip');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(nodeZip, { lazyEntries: true }, (err, z) => (err || !z ? reject(err) : resolve(z)));
  });
  await copyEntry(zip, 'bin/arm64-v8a/libnode.so', join(lib, 'libnode.so'));

  // 2. libc++_shared.so, which libnode.so links against
  const libcxx = join(lib, 'libc++_shared.so');
  if (!existsSync(libcxx)) {
    console.log(`reading libc++_shared.so from ${NDK}`);
    await remoteFile(NDK, LIBCXX, libcxx);
  }

  // 3. Claude Code's cli.js and package.json ("type": "module", so Node loads cli.js as ES module)
  const tgz = await download(CLAUDE, 'claude-code-2.1.112.tgz');
  const tmp = mkdtempSync(join(tmpdir(), 'hub-node-'));
  try {
    await extract(tgz, tmp, true);
    const claude = join(assets, 'claude-code');
    rmSync(claude, { recursive: true, force: true });
    mkdirSync(claude, { recursive: true });
    for (const f of ['cli.js', 'package.json']) cpSync(join(tmp, f), join(claude, f));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(join(assets, 'version'), 'nodejs-mobile 18.20.4 + claude-code 2.1.112\n');
  console.log(`node tools ready in ${root}`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
