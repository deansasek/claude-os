// Writes the web page as plain files, the bytes the hub serves for it: public/** and every browser file under src/
// that WEB_FILE allows. A .ts file is written as servedBytes() gives it (stripped to plain JS, as serveStatic does),
// so a bundled file is byte-for-byte what the PC sends. Also writes manifest.json: each path, size and SHA-256.
// Run with: npm run build:page. Pass a folder to write somewhere else (the default is dist/page, which git ignores).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servedBytes, WEB_FILE } from '../src/core/server/served.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SRC = path.join(ROOT, 'src');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist', 'page'));

interface Entry { path: string; size: number; sha256: string; bytes: Buffer | string }

/** Every file under a folder, as slash-separated paths relative to it. */
function listFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map(p => p.split(path.sep).join('/'))
    .filter(p => fs.statSync(path.join(dir, p)).isFile());
}

const entries: Entry[] = [];
const add = (urlPath: string, file: string) => {
  const bytes = servedBytes(file);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  entries.push({ path: urlPath, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), bytes });
};

for (const f of listFiles(PUBLIC)) add(`/${f}`, path.join(PUBLIC, f));
for (const f of listFiles(SRC)) {
  const urlPath = `/src/${f}`;
  if (WEB_FILE.test(urlPath)) add(urlPath, path.join(SRC, f));
}
entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

fs.rmSync(OUT, { recursive: true, force: true });
for (const e of entries) {
  const dest = path.join(OUT, e.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, e.bytes);
}
const manifest = { files: entries.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })) };
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// The marker a page reads to know it runs from this bundle (shell.ts). Not in the manifest: the PC does not serve it.
fs.writeFileSync(path.join(OUT, 'bundle.json'), JSON.stringify({ bundled: true }) + '\n');

const total = entries.reduce((sum, e) => sum + e.size, 0);
console.log(`page bundle: ${entries.length} files, ${total} bytes -> ${path.relative(ROOT, OUT) || '.'}`);
