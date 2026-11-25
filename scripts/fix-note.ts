// Post or update the one Claude note on an issue. Run with Node 22 type stripping:
//   node fix-note.ts <issue number> <path to final message file>
// The note starts with MARKER. A re-run PATCHes the existing note and does not post a new one.
// Needs GITHUB_REPOSITORY and GH_TOKEN in the environment. Prints the comment URL.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MARKER = '<!-- claudeos-note -->';

/** Runs gh with the given args and returns stdout. Tests pass a fake. */
export type Gh = (args: string[]) => string;

export interface Comment {
  id: number;
  login: string;
  body: string;
}

/** Return the Claude note: a bot comment whose body has the marker. */
export function findNote(comments: Comment[]): Comment | undefined {
  return comments.find(c => (c.login === 'claude' || c.login === 'claude[bot]') && c.body.includes(MARKER));
}

/** Choose the gh api call. PATCH the existing note, or POST a new one. */
export function noteCall(comments: Comment[], repo: string, issue: string, bodyFile: string): string[] {
  const note = findNote(comments);
  const field = `body=@${bodyFile}`;
  return note
    ? ['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${note.id}`, '-F', field, '--jq', '.html_url']
    : ['api', '-X', 'POST', `repos/${repo}/issues/${issue}/comments`, '-F', field, '--jq', '.html_url'];
}

/** Parse the list output: one JSON object per line, from --jq. */
export function parseComments(text: string): Comment[] {
  return text.split('\n').filter(line => line.trim() !== '').map(line => {
    const raw = JSON.parse(line) as { id: number; login: string | null; body: string | null };
    return { id: raw.id, login: raw.login ?? '', body: raw.body ?? '' };
  });
}

/** Write the marker and the message to bodyFile, then post or update the note. Returns the comment URL. */
export function postNote(opts: { repo: string; issue: string; message: string; bodyFile: string; gh: Gh }): string {
  const listing = opts.gh(['api', '--paginate', `repos/${opts.repo}/issues/${opts.issue}/comments`,
    '--jq', '.[] | {id: .id, login: .user.login, body: .body}']);
  writeFileSync(opts.bodyFile, `${MARKER}\n${opts.message.trimEnd()}\n`);
  return opts.gh(noteCall(parseComments(listing), opts.repo, opts.issue, opts.bodyFile)).trim();
}

function main(): void {
  const [issue, file] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  if (!issue || !/^\d+$/.test(issue) || !file || !repo) {
    console.error('usage: node fix-note.ts <issue number> <message file> (needs GITHUB_REPOSITORY)');
    process.exit(1);
  }
  const gh: Gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'fix-note-')), 'body.md');
  console.log(postNote({ repo, issue, message: readFileSync(file, 'utf8'), bodyFile, gh }));
}

// Run only as a script. Tests import this file and skip main().
if (process.argv[1]?.endsWith('fix-note.ts')) {
  try {
    main();
  } catch (error) {
    console.error(`fix-note failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
