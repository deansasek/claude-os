// Remove the screenshots of one issue or pull request from the attachments branch. Run with Node 22 type stripping:
//   node detach-image.ts <number>
// Does nothing when the branch or the folder does not exist. Prints what it removed.
// Needs git push access to origin (the workflow gives it contents: write).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BRANCH = 'attachments';

/** Run git with the given args in dir and return stdout, trimmed. */
function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function main(): void {
  const [item] = process.argv.slice(2);
  if (!item || !/^\d+$/.test(item)) {
    console.error('usage: node detach-image.ts <number>');
    process.exit(1);
  }
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (git(top, ['ls-remote', '--heads', 'origin', BRANCH]) === '') {
    console.log(`No ${BRANCH} branch. Nothing to remove for #${item}.`);
    return;
  }
  git(top, ['fetch', '--quiet', 'origin', BRANCH]);
  const work = join(mkdtempSync(join(tmpdir(), 'detach-')), 'tree');
  git(top, ['worktree', 'add', '--quiet', '--detach', work, `origin/${BRANCH}`]);
  try {
    if (!existsSync(join(work, item))) {
      console.log(`No images for #${item}. Nothing to remove.`);
      return;
    }
    git(work, ['rm', '-r', '--quiet', item]);
    git(work, ['-c', 'user.name=ClaudeOS', '-c', 'user.email=attachments@users.noreply.github.com', 'commit', '--quiet', '-m', `chore(attachments): remove the images for #${item}`]);
    git(work, ['push', '--quiet', 'origin', `HEAD:${BRANCH}`]);
    console.log(`Removed the images for #${item}.`);
  } finally {
    git(top, ['worktree', 'remove', '--force', work]);
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('detach-image.ts')) {
  try {
    main();
  } catch (error) {
    console.error(`detach-image failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
