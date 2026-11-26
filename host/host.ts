// ClaudeOS Host as an npm command, for Windows, macOS and Linux. It runs the host server, restarts it after a crash, and
// keeps its log. It replaces the Windows tray app (host/ClaudeHubHost.exe). The client (the tablet or iPad app) reads from it. Run with Node 22 type stripping:
//   npm run host                  start the host and stay in the foreground (Ctrl+C stops it)
//   npm run host -- --port 8001   start it with extra server arguments
//   npm run host:stop             stop a host that npm run host started
//   npm run host:status           show whether it runs and answers
//   npm run host:logs             show the last lines of the log
//   npm run host -- autostart on|off|status   start the host at logon (Windows; Startup folder)
// The server reads its address from config.json. Logs go to host/logs/server.log (5 MB cap, one backup).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CANNOT_LISTEN } from '../src/core/server/exit.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = join(ROOT, 'host', 'logs');
const LOG = join(LOG_DIR, 'server.log');
const MAX_LOG = 5 * 1024 * 1024;
const BACKOFF = [1, 2, 5, 10, 30];   // seconds between restarts, as the tray app did
/** The state files of one host, keyed by its port, so two hosts on different ports do not share them. */
function stateFiles(extra: string[]) {
  const port = new URL(hostUrl(extra)).port;
  return {
    pid: join(LOG_DIR, `host.${port}.pid`),
    child: join(LOG_DIR, `host.${port}.child.pid`),
    stop: join(LOG_DIR, `host.${port}.stop`),
    url: join(LOG_DIR, `host.${port}.url`),
  };
}

const HEALTHY_MS = 60_000;           // a run this long resets the backoff

/** Append text to the log, moving the log to server.log.1 when it passes the cap. */
function log(text: string): void {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const lines = text.split('\n').filter(l => l.length > 0);
  for (const line of lines) {
    const out = `${stamp} ${line}\n`;
    // a log that cannot be written (it is held open, the disk is full) must not stop the host: the console still gets the line
    try {
      mkdirSync(LOG_DIR, { recursive: true });
      if (existsSync(LOG) && statSync(LOG).size > MAX_LOG) renameSync(LOG, `${LOG}.1`);
      appendFileSync(LOG, out);
    } catch { /* the console below still has it */ }
    process.stdout.write(out);
  }
}

/** The server defaults, as src/core/server/config.ts has them. Used when config.json is missing. */
export const DEFAULTS = { host: '0.0.0.0', port: 8000 };

/** The host's address: --host and --port in the extra arguments win, then config.json, then the defaults. */
export function hostUrl(extra: string[], config: { host: string; port: number } = loadConfig()): string {
  const at = (flag: string): string | undefined => { const i = extra.indexOf(flag); return i >= 0 ? extra[i + 1] : undefined; };
  const host = at('--host') ?? config.host;
  const port = at('--port') ?? String(config.port);
  return `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
}

/** Read config.json, or return the defaults when it is missing or unreadable. */
export function loadConfig(): { host: string; port: number } {
  try {
    const c = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) as { host?: string; port?: number };
    return { host: c.host ?? DEFAULTS.host, port: c.port ?? DEFAULTS.port };
  } catch {
    return { ...DEFAULTS };
  }
}

/** True when a process with this id is alive. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Stop a process and its children. Windows needs taskkill for the tree; POSIX signals the process group. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  }
}

function readPid(file: string): number | null {
  if (!existsSync(file)) return null;
  const n = Number(readFileSync(file, 'utf8').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Run the host: start the server, restart it after a crash, and stop when asked. */
function run(extra: string[]): void {
  const f = stateFiles(extra);
  mkdirSync(LOG_DIR, { recursive: true });
  const running = readPid(f.pid);
  if (running && alive(running)) {
    console.error(`The host is already running (pid ${running}). Use npm run host:stop first.`);
    process.exit(1);
  }
  rmSync(f.stop, { force: true });
  writeFileSync(f.pid, String(process.pid));
  writeFileSync(f.url, hostUrl(extra));   // the address this host answers on, for status

  let child: ChildProcess | null = null;
  let stopping = false;
  let restarts = 0;

  const finish = (): void => {
    stopping = true;
    if (child?.pid) killTree(child.pid);
    rmSync(f.child, { force: true });
    rmSync(f.pid, { force: true });
    rmSync(f.url, { force: true });
    rmSync(f.stop, { force: true });
    log('[host] the host stopped');
    process.exit(0);
  };
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
  setInterval(() => { if (existsSync(f.stop)) finish(); }, 2000);

  const start = (): void => {
    const began = Date.now();
    log('[host] starting the host');
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.server.ts', ...extra], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',   // its own group, so the whole tree can be stopped
    });
    if (child.pid) writeFileSync(f.child, String(child.pid));
    child.stdout?.on('data', (d: Buffer) => log(d.toString()));
    child.stderr?.on('data', (d: Buffer) => log(d.toString()));
    child.on('exit', code => {
      if (stopping) return;
      if (code === EXIT_CANNOT_LISTEN) { log('[host] the host cannot listen on its address (see the line above); not restarting it. Check config.json, then start the host again.'); return; }
      if (Date.now() - began > HEALTHY_MS) restarts = 0;
      const wait = BACKOFF[Math.min(restarts, BACKOFF.length - 1)];
      restarts++;
      log(`[host] the host exited with code ${code}; restarting in ${wait}s`);
      setTimeout(() => { if (!stopping) start(); }, wait * 1000);
    });
  };
  start();
}

/** Ask a running host to stop, and wait for it to finish. */
async function stop(extra: string[]): Promise<void> {
  const f = stateFiles(extra);
  const pid = readPid(f.pid);
  if (!pid || !alive(pid)) {
    console.log('The host is not running.');
    rmSync(f.pid, { force: true });
    return;
  }
  writeFileSync(f.stop, '');
  for (let i = 0; i < 30 && alive(pid); i++) await new Promise(r => setTimeout(r, 500));
  console.log(alive(pid) ? `The host (pid ${pid}) did not stop in time. Stop it from the terminal where it runs.` : 'The host stopped.');
}

/** Print whether the host runs, and whether its address answers. */
async function status(extra: string[]): Promise<void> {
  const f = stateFiles(extra);
  const pid = readPid(f.pid);
  if (!pid || !alive(pid)) {
    console.log('The host is not running.');
    return;
  }
  const child = readPid(f.child);
  const url = existsSync(f.url) ? readFileSync(f.url, 'utf8').trim() : hostUrl(extra);
  let answer = 'no answer';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    answer = `HTTP ${res.status}`;
  } catch { /* keep "no answer" */ }
  console.log(`The host runs (pid ${pid}, server pid ${child ?? 'none'}). ${url}: ${answer}.`);
}

/** Print the last lines of the log. */
function logs(count: number): void {
  if (!existsSync(LOG)) { console.log('No log yet.'); return; }
  const lines = readFileSync(LOG, 'utf8').split('\n');
  console.log(lines.slice(-count - 1).join('\n'));
}

/** The script in the Windows Startup folder that starts the host, minimized, at logon. Pure, so a test can check the quoting. */
export function startupScript(nodePath: string, hostFile: string): string {
  return ['@echo off', `start "ClaudeOS Host" /min "${nodePath}" "${hostFile}"`, ''].join(String.fromCharCode(13, 10));
}

/** The Startup folder file for the host. Empty when there is no user profile to find it in. */
function startupFile(): string {
  const appData = process.env.APPDATA;
  return appData ? join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ClaudeOS Host.cmd') : '';
}

/** Turn autostart on, off or status. Windows uses the Startup folder. macOS and Linux print what to do. */
function autostart(action: 'on' | 'off' | 'status'): void {
  if (process.platform !== 'win32') {
    console.log('Autostart is set up for Windows only for now. On macOS or Linux, start npm run host from a login script.');
    return;
  }
  const file = startupFile();
  if (!file) { console.error('APPDATA is not set, so the Startup folder cannot be found.'); process.exit(1); }
  if (action === 'on') {
    writeFileSync(file, startupScript(process.execPath, join(ROOT, 'host', 'host.ts')));
    console.log('The host starts minimized when you log on.');
  } else if (action === 'off') {
    rmSync(file, { force: true });
    console.log('Autostart is off.');
  } else {
    console.log(existsSync(file) ? 'Autostart is on.' : 'Autostart is off.');
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command.startsWith('-')) return run(process.argv.slice(2));
  if (command === 'run') return run(rest);
  if (command === 'stop') return stop(rest);
  if (command === 'status') return status(rest);
  if (command === 'logs') return logs(Number(rest[0] ?? 100));
  if (command === 'autostart') return autostart((rest[0] ?? 'on') as 'on' | 'off' | 'status');
  console.error('usage: npm run host [-- extra server args] | host:stop | host:status | host:logs');
  process.exit(1);
}

if (process.argv[1]?.endsWith('host.ts')) {
  main().catch(error => {
    console.error(`host failed: ${(error as Error).message}`);
    process.exit(1);
  });
}
