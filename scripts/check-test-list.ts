// Fails if a test/*.test.ts file is not named in the "test" script in package.json, or if the script names a
// file that does not exist. `node --test` only runs the files it is given, so a missing name skips that test.
// Pass a folder to check a different root (for example a scratch copy); the default is the repository root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
const script = pkg.scripts?.test ?? '';

const listed = new Set(script.split(/\s+/).filter(word => /^test\/[\w.-]+\.test\.ts$/.test(word)));
const onDisk = fs.readdirSync(path.join(ROOT, 'test')).filter(name => name.endsWith('.test.ts')).map(name => `test/${name}`);

const errors: string[] = [];
for (const file of onDisk) if (!listed.has(file)) errors.push(`${file} is not in the "test" script in package.json`);
for (const file of listed) if (!onDisk.includes(file)) errors.push(`the "test" script names ${file}, which does not exist`);

if (errors.length) {
  console.error('test list check failed:');
  for (const e of errors) console.error('  - ' + e);
  process.exitCode = 1;
} else {
  console.log(`test list ok: ${onDisk.length} test files, all in the "test" script`);
}
