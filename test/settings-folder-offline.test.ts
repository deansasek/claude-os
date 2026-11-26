// The Sessions Default folder value must not say Unavailable when the PC cannot be reached
// (src/apps/settings/web/index.ts, folderLabel, paintSessions, pickFolder).
// The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// Load folderLabel from the source, with the same module state the page uses.
function loadFolderLabel(projects: { id: string; name: string }[] | null, foldersFailed: boolean) {
  const start = src.indexOf('function folderLabel(fid: string): string {');
  const end = src.indexOf('\n}\n', start) + 3;
  const body = src.slice(start, end).replace('(fid: string): string', '(fid)');
  return new Function('projects', 'foldersFailed', `${body}\nreturn folderLabel;`)(projects, foldersFailed) as (fid: string) => string;
}

test('folderLabel says Most recent when no folder is saved', () => {
  assert.equal(loadFolderLabel(null, false)(''), 'Most recent');
  assert.equal(loadFolderLabel(null, true)(''), 'Most recent');
  assert.equal(loadFolderLabel([{ id: 'a', name: 'Notes' }], false)(''), 'Most recent');
});

test('folderLabel returns the folder name when the saved folder is listed', () => {
  assert.equal(loadFolderLabel([{ id: 'a', name: 'Notes' }], false)('a'), 'Notes');
  assert.equal(loadFolderLabel([{ id: 'a', name: 'Notes' }], true)('a'), 'Notes');
});

test('folderLabel says Can’t reach the PC when the folder read failed', () => {
  assert.equal(loadFolderLabel(null, true)('a'), 'Can’t reach the PC');
});

test('folderLabel says Loading while the first folder read has not finished', () => {
  assert.equal(loadFolderLabel(null, false)('a'), 'Loading…');
});

test('folderLabel says Unavailable when the PC answered and the saved folder is gone', () => {
  assert.equal(loadFolderLabel([{ id: 'b', name: 'Other' }], false)('a'), 'Unavailable');
  assert.equal(loadFolderLabel([], false)('a'), 'Unavailable');
});

test('paintSessions uses folderLabel at both Default folder value sites', () => {
  const body = src.slice(src.indexOf('async function paintSessions(): Promise<void> {'), src.indexOf('function pickModel'));
  assert.match(body, /\$\('stNewFolderV'\)\.textContent = folderLabel\(fid\);/);
  assert.match(body, /if \(section === 'sessions'\) \$\('stNewFolderV'\)\.textContent = folderLabel\(newFolderPref\(\)\);/);
  assert.doesNotMatch(body, /'Unavailable'/);
});
