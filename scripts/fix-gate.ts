// Gate rules for the AI issue-fix flow. Each patch must pass these checks before a PR opens.
// Pure functions only: no network, no git calls, no file writes. Callers pass plain data.
// gate() runs the rules in order and reports the first rule that fails.

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
  binary?: boolean;
  mode?: string;
  symlink?: boolean;
}

/** The old and new text of package.json. Needed only when package.json is in the change. */
export interface PackageJsonPair {
  before: string;
  after: string;
}

export interface GateInput {
  files: FileChange[];
  title: string;
  body: string;
  packageJson?: PackageJsonPair;
}

export interface GateResult {
  pass: boolean;
  rule: string;
  reason: string;
}

export const MAX_FILES = 10;
export const MAX_LINES = 300;

const DENIED_DIRS = ['.github/', '.claude/', 'host/'];
const DENIED_NAMES = new Set(['CLAUDE.md', '.mcp.json', 'tsconfig.json', '.npmrc', 'package-lock.json', 'keystore.properties']);
const DENIED_PATTERNS = [/^scripts\/check-/, /\.jks$/, /\.keystore$/];
const TEST_FILE = /^test\/[\w.-]+\.test\.ts$/;
const TITLE = /^(feat|fix|refactor|perf|test|docs|chore|style|ci|revert)(\([a-z0-9-]+\))?!?: [^ ].*$/;
const ATTRIBUTION = /generated with|co-authored-by/i;

/** Convert Windows separators so every rule compares the same form. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/** True when a changed path is off limits for an AI patch. package.json is checked by its own rule. */
export function isDeniedPath(path: string): boolean {
  const p = toPosixPath(path);
  const name = p.split('/').pop() ?? p;
  return DENIED_DIRS.some(dir => p.startsWith(dir))
    || DENIED_NAMES.has(name)
    || DENIED_PATTERNS.some(pattern => pattern.test(p));
}

const tokens = (script: string): string[] => script.split(/\s+/).filter(Boolean);

/**
 * True when package.json changes only add test file names to the "test" script.
 * Any other key, script, or removed token makes the change invalid.
 */
export function isPackageJsonChangeAllowed(before: string, after: string): boolean {
  let a: Record<string, any>;
  let b: Record<string, any>;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch {
    return false;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key !== 'scripts' && JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  const scriptsA: Record<string, string> = a.scripts ?? {};
  const scriptsB: Record<string, string> = b.scripts ?? {};
  const names = new Set([...Object.keys(scriptsA), ...Object.keys(scriptsB)]);
  for (const name of names) {
    if (name !== 'test' && scriptsA[name] !== scriptsB[name]) return false;
  }
  const oldTests = tokens(scriptsA.test ?? '');
  const newTests = tokens(scriptsB.test ?? '');
  if (!oldTests.every(token => newTests.includes(token))) return false;
  return newTests
    .filter(token => !oldTests.includes(token))
    .every(token => TEST_FILE.test(token));
}

const fail = (rule: string, reason: string): GateResult => ({ pass: false, rule, reason });

/** Run every rule in order. Return the first failure, or a pass. */
export function gate(input: GateInput): GateResult {
  const { files, title, body } = input;

  const denied = files.find(file => isDeniedPath(file.path));
  if (denied) return fail('denied-path', `${toPosixPath(denied.path)} is a protected path`);

  if (files.some(file => toPosixPath(file.path) === 'package.json')) {
    const pair = input.packageJson;
    if (!pair || !isPackageJsonChangeAllowed(pair.before, pair.after)) {
      return fail('package-json', 'package.json may only add test file names to the "test" script');
    }
  }

  const lines = files.reduce((sum, file) => sum + file.added + file.deleted, 0);
  if (files.length === 0 || lines === 0) return fail('no-change', 'the patch changes no lines');

  if (files.some(file => file.symlink)) return fail('symlink', 'the patch adds or changes a symlink');

  if (files.length > MAX_FILES) return fail('file-count', `the patch changes ${files.length} files; the limit is ${MAX_FILES}`);
  if (lines > MAX_LINES) return fail('line-count', `the patch changes ${lines} lines; the limit is ${MAX_LINES}`);

  if (!TITLE.test(title)) return fail('pr-title', `PR title is not Conventional Commits: ${title}`);

  const text = body.replace(/\r/g, '');
  for (const heading of ['Why', 'What', 'Tests']) {
    if (!new RegExp(`^## ${heading}[ \\t]*$`, 'm').test(text)) {
      return fail('pr-body', `PR body lacks the heading: ## ${heading}`);
    }
  }
  if (ATTRIBUTION.test(text)) return fail('pr-attribution', 'PR body has AI attribution text');

  return { pass: true, rule: 'none', reason: 'all rules pass' };
}
