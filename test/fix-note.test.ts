// Tests for the one-note-per-issue helper. The gh call is a fake passed in, so no network call runs. Run with: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { LEGACY_TITLE, MARKER, findNote, findNoteOrLegacy, noteCall, parseComments, postNote, readNote, setUsageLine, withOneMarker, writeUsage, type Comment, type Gh } from '../scripts/fix-note.ts';

const note: Comment = { id: 7, login: 'claude[bot]', body: `${MARKER}\nOld note` };

// A fake gh: returns the listing for --paginate calls and a comment URL for writes. It records every call.
const fakeGh = (listing: string, calls: string[][]): Gh => args => {
  calls.push(args);
  return args.includes('--paginate') ? listing : 'https://github.com/deansasek/claude-os/issues/5#issuecomment-9\n';
};

const listingOf = (comments: Comment[]): string =>
  comments.map(c => JSON.stringify({ id: c.id, login: c.login, body: c.body })).join('\n');

test('findNote returns the bot comment that has the marker', () => {
  assert.equal(findNote([note])?.id, 7);
  assert.equal(findNote([{ ...note, login: 'claude' }])?.id, 7);
});

test('findNote ignores a comment without the marker and a marker comment from a person', () => {
  assert.equal(findNote([{ id: 1, login: 'claude[bot]', body: 'Progress' }]), undefined);
  assert.equal(findNote([{ id: 2, login: 'deansasek', body: note.body }]), undefined);
});

test('noteCall PATCHes the existing note by its id', () => {
  const args = noteCall([{ id: 1, login: 'someone', body: 'hi' }, note], 'deansasek/claude-os', '5', '/tmp/b.md');
  assert.deepEqual(args, ['api', '-X', 'PATCH', 'repos/deansasek/claude-os/issues/comments/7', '-F', 'body=@/tmp/b.md', '--jq', '.html_url']);
});

test('noteCall POSTs a new note when the issue has none', () => {
  const args = noteCall([{ id: 1, login: 'someone', body: 'hi' }], 'deansasek/claude-os', '5', '/tmp/b.md');
  assert.deepEqual(args, ['api', '-X', 'POST', 'repos/deansasek/claude-os/issues/5/comments', '-F', 'body=@/tmp/b.md', '--jq', '.html_url']);
});

test('parseComments reads one JSON object per line and treats a null body as empty', () => {
  const parsed = parseComments(`${JSON.stringify({ id: 3, login: 'a', body: null })}\n\n`);
  assert.deepEqual(parsed, [{ id: 3, login: 'a', body: '' }]);
});

test('postNote updates the existing note and writes the marker first', () => {
  const calls: string[][] = [];
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'fix-note-test-')), 'body.md');
  const url = postNote({ repo: 'deansasek/claude-os', issue: '5', message: 'Done.\n', bodyFile, gh: fakeGh(listingOf([note]), calls) });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 2), ['api', '--paginate']);
  assert.equal(calls[1][2], 'PATCH');
  assert.equal(readFileSync(bodyFile, 'utf8'), `${MARKER}\nDone.\n`);
  assert.match(url, /issuecomment-9$/);
});

test('postNote posts a new note when no marker comment exists', () => {
  const calls: string[][] = [];
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'fix-note-test-')), 'body.md');
  postNote({ repo: 'deansasek/claude-os', issue: '5', message: 'Blocked.', bodyFile, gh: fakeGh('', calls) });
  assert.equal(calls[1][2], 'POST');
  assert.equal(calls[1][3], 'repos/deansasek/claude-os/issues/5/comments');
});

test('findNote finds the marker on any line, so a header above it does not hide the note', () => {
  assert.equal(findNote([{ id: 4, login: 'claude[bot]', body: `Claude finished @user's task\n---\n${MARKER}\nOld` }])?.id, 4);
});

test('findNote returns the newest note when several have the marker (comments are oldest first)', () => {
  const older: Comment = { id: 1, login: 'claude[bot]', body: `${MARKER}\nFirst run` };
  const newer: Comment = { id: 2, login: 'claude[bot]', body: `${MARKER}\nSecond run` };
  assert.equal(findNote([older, newer])?.id, 2);
});

test('findNote skips a newer working comment that has no marker yet', () => {
  const finished: Comment = { id: 1, login: 'claude[bot]', body: `${MARKER}\nDone` };
  const working: Comment = { id: 2, login: 'claude[bot]', body: 'Claude Code is working…' };
  assert.equal(findNote([finished, working])?.id, 1);
});

test('writeUsage does not add a second marker when the marker is below a header', () => {
  const calls: string[][] = [];
  const dir = mkdtempSync(join(tmpdir(), 'fix-note-test-'));
  const usageFile = join(dir, 'usage-line.txt');
  writeFileSync(usageFile, 'Usage: 7 tokens\n');
  const bodyFile = join(dir, 'body.md');
  const headed: Comment = { id: 9, login: 'claude[bot]', body: `Claude finished\n---\n${MARKER}\nResult` };
  writeUsage({ repo: 'deansasek/claude-os', issue: '5', usageFile, bodyFile, gh: fakeGh(listingOf([headed]), calls) });
  const written = readFileSync(bodyFile, 'utf8');
  assert.equal(written.split(MARKER).length - 1, 1);
  assert.match(written, /^Claude finished\n---\n<!-- claudeos-note -->\nResult\n\nUsage: 7 tokens\n$/);
});

test('findNoteOrLegacy falls back to an old review comment with the legacy title', () => {
  const legacy: Comment = { id: 8, login: 'claude[bot]', body: `${LEGACY_TITLE}5\n\n- [x] Summarize` };
  assert.equal(findNoteOrLegacy([{ id: 1, login: 'someone', body: LEGACY_TITLE }, legacy])?.id, 8);
  assert.equal(findNoteOrLegacy([{ id: 1, login: 'someone', body: `${LEGACY_TITLE}5` }]), undefined);
  // A marker note wins over an older legacy comment.
  assert.equal(findNoteOrLegacy([legacy, note])?.id, 7);
});

test('postNote updates a legacy review comment and adds the marker on line 1', () => {
  const calls: string[][] = [];
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'fix-note-test-')), 'body.md');
  const legacy: Comment = { id: 8, login: 'claude', body: `${LEGACY_TITLE}5\n\nOld review` };
  postNote({ repo: 'deansasek/claude-os', issue: '5', message: 'New review.', bodyFile, gh: fakeGh(listingOf([legacy]), calls) });
  assert.equal(calls[1][2], 'PATCH');
  assert.equal(calls[1][3], 'repos/deansasek/claude-os/issues/comments/8');
  assert.equal(readFileSync(bodyFile, 'utf8'), `${MARKER}\nNew review.\n`);
});

test('withOneMarker keeps one marker when the body already starts with it', () => {
  assert.equal(withOneMarker(`${MARKER}\nReview\n`), `${MARKER}\nReview\n`);
  assert.equal(withOneMarker(`﻿  ${MARKER}\nReview`), `${MARKER}\nReview\n`);
});

test('withOneMarker adds the marker to a body without it', () => {
  assert.equal(withOneMarker('Review\n'), `${MARKER}\nReview\n`);
});

test('withOneMarker reduces a body with the marker twice to one marker', () => {
  assert.equal(withOneMarker(`${MARKER}\n${MARKER}\nReview\n`), `${MARKER}\nReview\n`);
  assert.equal(withOneMarker(`${MARKER}\n${MARKER}\n${MARKER}\nReview\n`), `${MARKER}\nReview\n`);
});

test('readNote returns the note body, or an empty string when no note exists', () => {
  const calls: string[][] = [];
  const body = readNote({ repo: 'deansasek/claude-os', issue: '5', gh: fakeGh(listingOf([note]), calls) });
  assert.equal(body, note.body);
  assert.equal(readNote({ repo: 'deansasek/claude-os', issue: '5', gh: fakeGh('', []) }), '');
});

test('setUsageLine replaces the last Usage line', () => {
  const body = `${MARKER}\nReview\n\nUsage: 1 tokens\nUsage: old\n`;
  assert.equal(setUsageLine(body, 'Usage: new'), `${MARKER}\nReview\n\nUsage: 1 tokens\nUsage: new\n`);
});

test('setUsageLine appends the Usage line after a blank line when none exists', () => {
  assert.equal(setUsageLine(`${MARKER}\nReview\n`, 'Usage: new'), `${MARKER}\nReview\n\nUsage: new\n`);
});

test('writeUsage PATCHes the note with the usage line set', () => {
  const calls: string[][] = [];
  const dir = mkdtempSync(join(tmpdir(), 'fix-note-test-'));
  const usageFile = join(dir, 'usage-line.txt');
  writeFileSync(usageFile, 'Usage: 42 tokens\n');
  const bodyFile = join(dir, 'body.md');
  const url = writeUsage({ repo: 'deansasek/claude-os', issue: '5', usageFile, bodyFile, gh: fakeGh(listingOf([note]), calls) });
  assert.equal(calls[1][2], 'PATCH');
  assert.equal(readFileSync(bodyFile, 'utf8'), `${MARKER}\nOld note\n\nUsage: 42 tokens\n`);
  assert.match(url, /issuecomment-9$/);
});

test('writeUsage returns a status and makes no gh call when the usage file is missing', () => {
  const calls: string[][] = [];
  const dir = mkdtempSync(join(tmpdir(), 'fix-note-test-'));
  const usageFile = join(dir, 'missing.txt');
  assert.equal(existsSync(usageFile), false);
  const status = writeUsage({ repo: 'deansasek/claude-os', issue: '5', usageFile, bodyFile: join(dir, 'body.md'), gh: fakeGh(listingOf([note]), calls) });
  assert.match(status, /No usage file/);
  assert.equal(calls.length, 0);
});
