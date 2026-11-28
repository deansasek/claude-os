// Fails if the "test" script in package.json does not run every test/*.test.ts file. The script names the files with a glob,
// so no file can be left out of a list. Pass a folder to check a different root (for example a scratch copy); the default is
// the repository root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
const script = pkg.scripts?.test ?? '';
const onDisk = fs.readdirSync(path.join(ROOT, 'test')).filter(name => name.endsWith('.test.ts'));

const errors: string[] = [];
if (!/"?test\/\*\.test\.ts"?/.test(script)) errors.push('the "test" script must run the glob "test/*.test.ts"');
if (onDisk.length === 0) errors.push('no test/*.test.ts files were found');

if (errors.length) {
  console.error('test list check failed:');
  for (const e of errors) console.error('  - ' + e);
  process.exitCode = 1;
} else {
  console.log(`test list ok: ${onDisk.length} test files, all run by the "test" script glob`);
}
