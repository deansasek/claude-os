// Post, update, read or usage-stamp the one Claude note on an issue or pull request. Run with Node 22 type stripping:
//   node fix-note.ts <number> <path to note file>   post or update the note
//   node fix-note.ts --read <number>                print the note body. Prints nothing when no note exists.
//   node fix-note.ts --usage <number>               set the Usage line from $RUNNER_TEMP/usage-line.txt. Never fails.
// The note has MARKER on one of its lines (the native progress comment adds a header above it). Reads take the newest
// Claude comment with the marker. A re-run PATCHes the existing note and does not post a new one.
// A comment from before the marker counts as the note when its body starts with LEGACY_TITLE.
// Needs GITHUB_REPOSITORY and GH_TOKEN in the environment. Prints the comment URL.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MARKER = '<!-- claudeos-note -->';
export const LEGACY_TITLE = '### Code review of PR #';
export const USAGE_PREFIX = 'Usage:';

/** Runs gh with the given args and returns stdout. Tests pass a fake. */
export type Gh = (args: string[]) => string;

export interface Comment {
  id: number;
  login: string;
  body: string;
}

const isClaude = (c: Comment): boolean => c.login === 'claude' || c.login === 'claude[bot]';

/** True when a line of body is the marker. The native progress comment puts a header above Claude's text, so line 1 is not always the marker. */
export const hasMarker = (body: string): boolean => body.split('\n').some(line => line.trim() === MARKER);

/** Return the newest Claude note: the latest bot comment with the marker on any line. Comments are listed oldest first. */
export function findNote(comments: Comment[]): Comment | undefined {
  return [...comments].reverse().find(c => isClaude(c) && hasMarker(c.body));
}

/** Return the note. If none exists, return the newest Claude review comment from before the marker. */
export function findNoteOrLegacy(comments: Comment[]): Comment | undefined {
  return findNote(comments) ?? [...comments].reverse().find(c => isClaude(c) && c.body.startsWith(LEGACY_TITLE));
}

/** Choose the gh api call. PATCH the existing note, or POST a new one. */
export function noteCall(comments: Comment[], repo: string, issue: string, bodyFile: string): string[] {
  const note = findNoteOrLegacy(comments);
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

/** List every comment on the issue or pull request. */
export function listComments(opts: { repo: string; issue: string; gh: Gh }): Comment[] {
  return parseComments(opts.gh(['api', '--paginate', `repos/${opts.repo}/issues/${opts.issue}/comments`,
    '--jq', '.[] | {id: .id, login: .user.login, body: .body}']));
}

/** Return the note body for --read. Returns an empty string when no note exists. */
export function readNote(opts: { repo: string; issue: string; gh: Gh }): string {
  return findNoteOrLegacy(listComments(opts))?.body ?? '';
}

/** Return the body with exactly one marker on line 1. Drops a leading BOM and whitespace, then drops marker lines directly at the top. */
export function withOneMarker(message: string): string {
  const lines = message.replace(/^﻿/, '').trimStart().split('\n');
  while (lines.length > 0 && lines[0].trim() === MARKER) lines.shift();
  return `${[MARKER, ...lines].join('\n').trimEnd()}\n`;
}

/** Write the marker and the message to bodyFile, then post or update the note. Returns the comment URL. */
export function postNote(opts: { repo: string; issue: string; message: string; bodyFile: string; gh: Gh }): string {
  const comments = listComments(opts);
  writeFileSync(opts.bodyFile, withOneMarker(opts.message));
  return opts.gh(noteCall(comments, opts.repo, opts.issue, opts.bodyFile)).trim();
}

/** Set the last Usage: line of body to line. Append the line after a blank line when no Usage: line exists. */
export function setUsageLine(body: string, line: string): string {
  const lines = body.trimEnd().split('\n');
  let at = -1;
  lines.forEach((text, i) => {
    if (text.startsWith(USAGE_PREFIX)) at = i;
  });
  if (at >= 0) lines[at] = line;
  else lines.push('', line);
  return `${lines.join('\n')}\n`;
}

/** Set the Usage line on the note from usageFile, and PATCH the note. Returns a status line. Throws on gh errors. */
export function writeUsage(opts: { repo: string; issue: string; usageFile: string; bodyFile: string; gh: Gh }): string {
  if (!existsSync(opts.usageFile)) return `No usage file at ${opts.usageFile}. The note is unchanged.`;
  const note = findNoteOrLegacy(listComments(opts));
  if (!note) return 'No Claude note on this pull request. Nothing written.';
  const line = readFileSync(opts.usageFile, 'utf8').trim();
  const withMarker = hasMarker(note.body) ? note.body : `${MARKER}\n${note.body}`;
  writeFileSync(opts.bodyFile, setUsageLine(withMarker, line));
  return opts.gh(['api', '-X', 'PATCH', `repos/${opts.repo}/issues/comments/${note.id}`, '-F', `body=@${opts.bodyFile}`,
    '--jq', '.html_url']).trim();
}

const isNumber = (value: string | undefined): value is string => !!value && /^\d+$/.test(value);

function main(): void {
  const [first, second] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  const gh: Gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

  if (first === '--usage') {
    // Never fail the job. Print the error and exit 0.
    try {
      if (!repo || !isNumber(second)) throw new Error('usage: node fix-note.ts --usage <number> (needs GITHUB_REPOSITORY)');
      const usageFile = join(process.env.RUNNER_TEMP ?? tmpdir(), 'usage-line.txt');
      const bodyFile = join(mkdtempSync(join(tmpdir(), 'fix-note-')), 'body.md');
      console.log(writeUsage({ repo, issue: second, usageFile, bodyFile, gh }));
    } catch (error) {
      console.log(`fix-note usage failed: ${(error as Error).message}`);
    }
    return;
  }

  if (first === '--read') {
    if (!repo || !isNumber(second)) {
      console.error('usage: node fix-note.ts --read <number> (needs GITHUB_REPOSITORY)');
      process.exit(1);
    }
    const body = readNote({ repo, issue: second, gh });
    if (body) process.stdout.write(body.endsWith('\n') ? body : `${body}\n`);
    return;
  }

  const [issue, file] = [first, second];
  if (!isNumber(issue) || !file || !repo) {
    console.error('usage: node fix-note.ts <number> <message file> (needs GITHUB_REPOSITORY)');
    process.exit(1);
  }
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
