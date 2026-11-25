// Tests for the one-note-per-issue helper. The gh call is a fake passed in, so no network call runs. Run with: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MARKER, findNote, noteCall, parseComments, postNote, type Comment, type Gh } from '../scripts/fix-note.ts';

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
