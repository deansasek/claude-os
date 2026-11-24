// Ship an AI issue fix: refuse unsafe repo state, stage the patch, run the gate,
// then push a branch and open a pull request. Run with Node 22 type stripping:
//   node fix-ship.ts <issue number> <path to pr.md>
// Set FIX_SHIP_DRY=1 to print the push and pull request commands instead of running them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gate, type FileChange } from './fix-gate.ts';

// Every git call turns off hooks and the fsmonitor, so repo-local code does not run.
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
// Every git call ignores the system and global config, so only the repo config counts.
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const DRY = process.env.FIX_SHIP_DRY === '1';
// Keys that git reads from anywhere in the repo config. Refused by name, before the allowlist.
const DENIED_KEYS: RegExp[] = [
  /^include\.path$/, /^url\..+\.(insteadof|pushurl)$/, /^remote\..+\.pushurl$/,
  /^gpg\.program$/, /^credential\..+\.helper$/, /^alias\./,
];
const ORIGIN_URL = /^https:\/\/(x-access-token:[^@/\s]+@)?github\.com\/deansasek\/claude-os(\.git)?$/;
const DENIED_DIRS = ['.github/', '.claude/', 'host/', 'scripts/fix-', 'scripts/check-'];
const DENIED_NAMES = [/^CLAUDE\.md$/, /^\.mcp\.json$/, /^tsconfig\.json$/, /^\.npmrc$/, /^package[^/]*\.json$/];

function refuse(rule: string, reason: string): never {
  console.error(`fix-ship refused [${rule}]: ${reason}`);
  process.exit(1);
}

const git = (args: string[]): string => execFileSync('git', [...SAFE, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, env: GIT_ENV });

function step(tool: string, args: string[]): string {
  if (DRY) {
    console.log(`${tool} ${args.join(' ')}`);
    return '';
  }
  return execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: tool === 'git' ? GIT_ENV : process.env });
}

// Lower-case the section and the variable name. Keep the subsection, which is case-sensitive.
function canonicalKey(key: string): string {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first < 0) return key.toLowerCase();
  const section = key.slice(0, first).toLowerCase();
  const name = key.slice(last + 1).toLowerCase();
  return first < last ? `${section}.${key.slice(first + 1, last)}.${name}` : `${section}.${name}`;
}

const toSlash = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '');
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Return the value check for an allowed key, or undefined when the key is not allowed.
function allowedKey(canonical: string, workspace: string): ((value: string) => boolean) | undefined {
  if (/^core\.(repositoryformatversion|filemode|bare|logallrefupdates|fsmonitor)$/.test(canonical)) return () => true;
  if (canonical === 'core.hookspath') return value => value === '/dev/null';
  if (/^(gc\.auto|user\.name|user\.email|remote\.origin\.fetch)$/.test(canonical)) return () => true;
  if (canonical === 'remote.origin.url') return value => ORIGIN_URL.test(value);
  if (/^branch\..+\.(remote|merge)$/.test(canonical)) return () => true;
  if (canonical === 'http.https://github.com/.extraheader') return () => true;

  // actions/checkout writes one includeif per checkout path. Allow only those four gitdir paths.
  const gitdir = /^includeif\.gitdir:(.+)\.path$/.exec(canonical);
  if (!gitdir) return undefined;
  const paths = [`${toSlash(workspace)}/.git`, `${toSlash(workspace)}/.git/worktrees/*`,
    '/github/workspace/.git', '/github/workspace/.git/worktrees/*'];
  const pathOk = paths.some(path => new RegExp(`^${path.split('*').map(escapeRegExp).join('[^/]+')}$`).test(toSlash(gitdir[1])));
  if (!pathOk) return undefined;
  const roots = [process.env.RUNNER_TEMP, '/github/runner_temp'].filter((root): root is string => Boolean(root)).map(toSlash);
  return value => {
    const file = toSlash(value);
    return roots.some(root => file.startsWith(`${root}/`)) && !file.split('/').includes('..');
  };
}

// Read every config entry with its origin. Output format: origin NUL "key LF value" NUL.
function readConfigEntries(): Array<{ key: string; value: string }> {
  const parts = git(['config', '--list', '--show-origin', '--includes', '-z']).split('\0');
  const entries: Array<{ key: string; value: string }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const record = parts[i + 1];
    const split = record.indexOf('\n');
    entries.push({ key: split < 0 ? record : record.slice(0, split), value: split < 0 ? '' : record.slice(split + 1) });
  }
  return entries;
}

// Refuse any git config key that is not on the allowlist. Name the key in the message.
function checkGitConfig(): void {
  const workspace = process.env.GITHUB_WORKSPACE ?? git(['rev-parse', '--show-toplevel']).trim();
  for (const { key, value } of readConfigEntries()) {
    const canonical = canonicalKey(key);
    if (DENIED_KEYS.some(pattern => pattern.test(canonical))) refuse('git-config', `git config key ${key} is not allowed`);
    const valueOk = allowedKey(canonical, workspace);
    if (!valueOk) refuse('git-config', `git config key ${key} is not on the allowlist`);
    if (!valueOk(value)) refuse('git-config', `git config key ${key} has a value that is not allowed`);
  }
}

function main(): void {
  const [issue, prPath] = process.argv.slice(2);
  if (!issue || !/^\d+$/.test(issue) || !prPath) refuse('usage', 'usage: node fix-ship.ts <issue number> <pr.md path>');

  // Refuse before any git write: planted hooks or unsafe config keys.
  // Read the common git dir, not --git-path hooks: that flag returns core.hooksPath when it is set.
  const hooks = resolve(git(['rev-parse', '--git-common-dir']).trim(), 'hooks');
  if (existsSync(hooks)) {
    const extra = readdirSync(hooks).filter(name => !name.endsWith('.sample'));
    if (extra.length) refuse('git-hooks', `.git/hooks has files other than *.sample: ${extra.join(', ')}`);
  }
  checkGitConfig();

  // Stage the patch and read its line counts, modes, and base package.json.
  git(['add', '-A']);
  const numstat = git(['diff', '--cached', '--numstat', '--no-renames', '-z']);
  const raw = git(['diff', '--cached', '--raw', '--no-renames', '-z']).split('\0');
  const baseJson = git(['show', 'HEAD:package.json']);
  const modes = new Map<string, string>();
  for (let i = 0; i + 1 < raw.length; i++) {
    if (raw[i].startsWith(':')) modes.set(raw[++i], raw[i - 1].split(' ')[1]);
  }
  const files: FileChange[] = numstat.split('\0').filter(Boolean).map(entry => {
    const [added, deleted, ...rest] = entry.split('\t');
    const path = rest.join('\t');
    const mode = modes.get(path);
    return {
      path, mode, binary: added === '-', symlink: mode === '120000',
      added: added === '-' ? 0 : Number(added), deleted: deleted === '-' ? 0 : Number(deleted),
    };
  });
  const protectedFile = files.find(file => DENIED_DIRS.some(dir => file.path.startsWith(dir))
    || DENIED_NAMES.some(pattern => pattern.test(file.path.split('/').pop() ?? '')));
  if (protectedFile) refuse('protected-path', `${protectedFile.path} is a protected path`);

  // Read the PR title (line 1) and body (the rest), then run the gate rules.
  const lines = readFileSync(prPath, 'utf8').replace(/\r/g, '').split('\n');
  const title = (lines[0] ?? '').trim();
  const body = `${lines.slice(1).join('\n').trim()}\n`;
  const packageJson = files.some(file => file.path === 'package.json')
    ? { before: baseJson, after: readFileSync('package.json', 'utf8') }
    : undefined;
  const result = gate({ files, title, body, packageJson });
  if (!result.pass) refuse(result.rule, result.reason);

  // Name the branch from the issue title. Refuse when the remote already has it.
  const repoArgs = process.env.GITHUB_REPOSITORY ? ['--repo', process.env.GITHUB_REPOSITORY] : [];
  const issueTitle = execFileSync('gh', ['issue', 'view', issue, ...repoArgs, '--json', 'title', '--jq', '.title'], { encoding: 'utf8' }).trim();
  const slug = issueTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'fix';
  const branch = `fix/issue-${issue}-${slug}`;
  if (git(['ls-remote', '--heads', 'origin', branch]).trim() !== '') refuse('branch-exists', `origin already has ${branch}`);

  // Write the commit message and the PR body to a scratch folder.
  const dir = mkdtempSync(join(tmpdir(), 'fix-ship-'));
  const titleFile = join(dir, 'title.txt');
  const bodyFile = join(dir, 'body.md');
  const fixes = `Fixes #${issue}`;
  const hasFixes = body.split('\n').some(line => line.trim() === fixes);
  writeFileSync(titleFile, `${title}\n`);
  writeFileSync(bodyFile, hasFixes ? body : `${body.trimEnd()}\n\n${fixes}\n`);

  step('git', [...SAFE, 'switch', '-c', branch]);
  step('git', [...SAFE, 'commit', '-F', titleFile]);
  step('git', [...SAFE, 'push', 'origin', branch]);
  const url = step('gh', ['pr', 'create', ...repoArgs, '--base', 'main', '--head', branch, '--title', title,
    '--body-file', bodyFile, '--label', 'ai-generated', '--label', 'ai-review']);
  if (!DRY) console.log(url.trim());
}

try {
  main();
} catch (error) {
  console.error(`fix-ship failed: ${(error as Error).message}`);
  process.exit(1);
}
