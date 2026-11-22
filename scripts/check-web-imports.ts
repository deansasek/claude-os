// Walks the import graph of the browser code (src/main.web.ts, and the mock tablet loaded by index.html) and fails
// if any module it imports is one the hub will not serve to a browser. The server only serves paths matching
// WEB_FILE (src/core/server/index.ts); anything else 404s and the whole page fails to boot.
// This is the same regex as WEB_FILE, and the script fails if the two ever differ, so change both together.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'src', 'core', 'server', 'index.ts');
const WEB_FILE = /^\/src\/(main\.web\.ts|core\/web\/[\w./-]+\.(ts|html)|apps\/[\w-]+\/(web\/[\w./-]+\.ts|view\.html|app\.css|manifest\.ts|api\.ts))$/;
const ENTRIES = ['/src/main.web.ts', '/src/core/web/mock-device.ts'];

const errors: string[] = [];

// The regex must be the one the server uses, byte for byte.
const serverSource = fs.readFileSync(SERVER, 'utf8');
const serverLine = /^(?:export )?const WEB_FILE = (\/.*\/);$/m.exec(serverSource)?.[1];
if (serverLine !== WEB_FILE.toString()) {
  errors.push(`WEB_FILE in src/core/server/index.ts is not the same as scripts/check-web-imports.ts; keep them in sync:\n  server: ${serverLine}\n  here:   ${WEB_FILE}`);
}

// import x from 'y' / import {a} from 'y' / import 'y' / export {a} from 'y' / import('y')
const SPEC = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s+[\w*{}\s,]+\s*from\s*|\bimport\s*\()\s*(['"])([^'"\n]+)\1/g;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const seen = new Set<string>();
let modules = 0;

function walk(served: string, from: string | null): void {
  if (seen.has(served)) return;
  seen.add(served);
  modules++;
  const file = path.join(ROOT, served);
  if (!fs.existsSync(file)) { errors.push(`${from ?? 'entry'} needs ${served}, which does not exist`); return; }
  if (!WEB_FILE.test(served)) { errors.push(`${from} imports ${served}, which the hub does not serve to browsers (not in WEB_FILE)`); return; }
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  for (const m of text.matchAll(SPEC)) {
    const spec = m[2]!;
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      errors.push(`${served} imports "${spec}", a bare module name the browser cannot resolve`);
      continue;
    }
    const target = spec.startsWith('/') ? spec : path.posix.join(path.posix.dirname(served), spec);
    if (!WEB_FILE.test(target)) {
      errors.push(`${served} imports "${spec}" -> ${target}, which the hub does not serve to browsers (not in WEB_FILE): the page would 404 and fail to boot`);
      continue;
    }
    walk(target, served);
  }
}

for (const entry of ENTRIES) walk(entry, null);

if (errors.length) {
  console.error('web import check failed:');
  for (const e of errors) console.error('  - ' + e);
  process.exitCode = 1;
} else {
  console.log(`web imports ok: ${modules} browser modules reachable from ${ENTRIES.join(', ')}`);
}
