// npm run setup: make config.json from config.example.json, asking for the address, the port and an
// optional cast device. Never overwrites an existing config.json without asking.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(HUB, 'config.example.json');
const TARGET = process.env.CLAUDEOS_CONFIG || path.join(HUB, 'config.json');

/** This PC's first IPv4 address on the home network, as a suggestion. */
function lanAddress(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '0.0.0.0';
}

// Answers are read line by line, so piped input works too; at the end of input every question takes its default.
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q: string, def: string) => {
  process.stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
  const next = await lines.next();
  if (next.done) process.stdout.write('\n');
  return (next.done ? '' : String(next.value)).trim() || def;
};

try {
  if (fs.existsSync(TARGET)) {
    const yes = (await ask(`${path.basename(TARGET)} already exists. Replace it? (y/N)`, 'n')).toLowerCase();
    if (yes !== 'y' && yes !== 'yes') { console.log(`Kept the existing ${path.basename(TARGET)}.`); process.exit(0); }
  }
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  console.log('ClaudeOS setup. Press Enter to keep the suggestion in brackets.');
  cfg.host = await ask('Address to listen on (this PC on your home network, or 0.0.0.0 for all)', lanAddress());
  const def = Number(cfg.port) || 8000;
  let port = Number(await ask('Port', String(def)));
  while (!(Number.isInteger(port) && port > 0 && port < 65536)) {
    console.log('A port is a whole number from 1 to 65535.');
    port = Number(await ask('Port', String(def)));
  }
  cfg.port = port;
  cfg.cast = await ask('Nest Hub or Chromecast address to keep the page cast to (optional, Enter to skip)', '');
  fs.writeFileSync(TARGET, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Wrote ${TARGET}. Start the hub with: npm start`);
} finally {
  rl.close();
}
