// Control the Claude Hub Host tray app from the command line.
// Usage: node host/hubctl.ts status|start|stop|restart|logs [--lines N]|health
// Reads %APPDATA%\ClaudeHubHost\api.json for the API URL and token path, then calls the API.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS = ['status', 'start', 'stop', 'restart', 'logs', 'health'] as const;
type Command = (typeof COMMANDS)[number];

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv: string[]): { command: Command; lines: number } {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    fail(`Usage: node host/hubctl.ts ${COMMANDS.join('|')} [--lines N]`);
  }
  let lines = 100;
  const i = argv.indexOf('--lines');
  if (i !== -1) {
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n)) fail('--lines needs a whole number.');
    lines = n;
  }
  return { command, lines };
}

function readApiFile(): { url: string; tokenPath: string } {
  const appData = process.env.APPDATA;
  if (!appData) fail('APPDATA is not set. Run this on Windows.');
  const apiFile = join(appData, 'ClaudeHubHost', 'api.json');
  if (!existsSync(apiFile)) fail(`No api.json at ${apiFile}. Is ClaudeHubHost running?`);
  const api = JSON.parse(readFileSync(apiFile, 'utf8')) as { url?: string; tokenPath?: string };
  if (!api.url || !api.tokenPath) fail(`api.json at ${apiFile} is missing url or tokenPath.`);
  return { url: api.url.replace(/\/+$/, ''), tokenPath: api.tokenPath };
}

function readToken(tokenPath: string): string {
  if (!existsSync(tokenPath)) fail(`Token file not found: ${tokenPath}`);
  return readFileSync(tokenPath, 'utf8').trim();
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h >= 1 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

async function callApi(base: string, token: string, command: Command, lines: number): Promise<any> {
  const routes: Record<Command, { method: 'GET' | 'POST'; path: string }> = {
    status: { method: 'GET', path: '/status' },
    start: { method: 'POST', path: '/start' },
    stop: { method: 'POST', path: '/stop' },
    restart: { method: 'POST', path: '/restart' },
    health: { method: 'GET', path: '/health' },
    logs: { method: 'GET', path: `/logs?lines=${Math.max(1, Math.min(500, lines))}` },
  };
  const { method, path } = routes[command];
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`${RED}API error ${response.status} : ${text || response.statusText}${RESET}`);
  }
  return text ? JSON.parse(text) : {};
}

function printStatus(r: any): void {
  const color = r.state === 'Running' ? GREEN : r.state === 'Restarting' ? YELLOW : GRAY;
  console.log(`${color}State:      ${r.state}${RESET}`);
  console.log(`PID:        ${r.pid ?? '-'}`);
  console.log(`Uptime:     ${formatUptime(Number(r.uptimeSeconds ?? 0))}`);
  console.log(`Restarts:   ${r.restartCount}`);
  console.log(`Last exit:  ${r.lastExitCode ?? '-'}`);
  if (r.nextRestartInSeconds != null) console.log(`Next retry: in ${r.nextRestartInSeconds}s`);
  console.log(`Server URL: ${r.serverUrl}`);
  if (r.lastError) console.log(`${YELLOW}Last error: ${r.lastError}${RESET}`);
}

async function main(): Promise<void> {
  const { command, lines } = parseArgs(process.argv.slice(2));
  const { url, tokenPath } = readApiFile();
  const token = readToken(tokenPath);
  const r = await callApi(url, token, command, lines);

  if (command === 'logs') {
    for (const line of r.lines ?? []) console.log(line);
    return;
  }
  if (command === 'health') {
    if (r.healthy) {
      console.log(`${GREEN}Hub server answers at ${r.url} (HTTP ${r.httpStatus})${RESET}`);
      return;
    }
    fail(`${RED}Hub server NOT answering at ${r.url}: ${r.error}${RESET}`, 2);
  }
  printStatus(r);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
