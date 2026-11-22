// Compiles ClaudeHubHost.cs into ClaudeHubHost.exe with the .NET Framework 4.x csc.exe that ships with Windows.
// Usage: node host/build.ts [--out <path>]

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const src = join(here, 'ClaudeHubHost.cs');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function outPath(argv: string[]): string {
  const i = argv.indexOf('--out');
  if (i === -1) return join(here, 'ClaudeHubHost.exe');
  const value = argv[i + 1];
  if (!value) fail('--out needs a path.');
  return resolve(value);
}

const out = outPath(process.argv.slice(2));

if (process.platform !== 'win32') {
  fail('The tray host builds on Windows only (it uses the .NET Framework compiler). On macOS or Linux, start the hub with npm start.');
}
if (!existsSync(csc)) fail(`csc.exe not found at ${csc}`);
if (!existsSync(src)) fail(`source not found: ${src}`);

// Icon: no .ico is embedded, so the tray uses SystemIcons.Application.
const cscArgs = [
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/debug-',
  '/warn:4',
  `/out:${out}`,
  '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll',
  '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
  src,
];

console.log(`Compiling ${src}`);
const result = spawnSync(csc, cscArgs, { stdio: 'inherit' });
if (result.status !== 0) fail(`csc.exe failed with exit code ${result.status}`);
if (!existsSync(out)) fail(`build reported success but ${out} is missing`);
console.log(`Built ${out} (${statSync(out).size} bytes)`);
