// Commit a PNG to the attachments branch under the issue number, and print its raw URL. Run with Node 22 type stripping:
//   node attach-image.ts <issue number> <png file> <name.png>
// The attachments branch is an orphan branch that holds only screenshots, one folder per issue. The URL pins the commit,
// so it keeps working after later commits. Clear the folder with detach-image.ts when the issue closes.
// Needs git push access to origin. Prints the raw URL on stdout and nothing else.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BRANCH = 'attachments';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

/** Build the raw URL for a file on a commit. */
export function rawUrl(repo: string, sha: string, issue: string, name: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${issue}/${name}`;
}

/** Run git with the given args in dir and return stdout, trimmed. */
function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function main(): void {
  const [issue, file, name] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY ?? 'deansasek/claude-os';
  if (!issue || !/^\d+$/.test(issue) || !file || !name || !NAME.test(name) || !existsSync(file)) {
    console.error('usage: node attach-image.ts <issue number> <png file> <name.png>');
    process.exit(1);
  }
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const work = join(mkdtempSync(join(tmpdir(), 'attach-')), 'tree');

  // Check out the attachments branch in a temporary worktree. Create the orphan branch when it does not exist yet.
  const exists = git(top, ['ls-remote', '--heads', 'origin', BRANCH]) !== '';
  if (exists) {
    git(top, ['fetch', '--quiet', 'origin', BRANCH]);
    git(top, ['worktree', 'add', '--quiet', '--detach', work, `origin/${BRANCH}`]);
  } else {
    git(top, ['worktree', 'add', '--quiet', '--orphan', '-b', `${BRANCH}-${Date.now()}`, work]);
  }
  try {
    mkdirSync(join(work, issue), { recursive: true });
    copyFileSync(file, join(work, issue, name));
    git(work, ['add', `${issue}/${name}`]);
    git(work, ['-c', 'user.name=ClaudeOS', '-c', 'user.email=attachments@users.noreply.github.com', 'commit', '--quiet', '-m', `chore(attachments): add ${name} for issue ${issue}`]);
    git(work, ['push', '--quiet', 'origin', `HEAD:${BRANCH}`]);
    const sha = git(work, ['rev-parse', 'HEAD']);
    console.log(rawUrl(repo, sha, issue, name));
  } finally {
    git(top, ['worktree', 'remove', '--force', work]);
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('attach-image.ts')) {
  try {
    main();
  } catch (error) {
    console.error(`attach-image failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
