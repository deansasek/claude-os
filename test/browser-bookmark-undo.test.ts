// Undo of a removed bookmark puts back one copy, at its old place (src/apps/browser/web/later.ts restoreLater, used by
// panels.ts restoreBookmark). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreLater } from '../src/apps/browser/web/later.ts';

test('a bookmark added again while the undo is offered is not doubled when undo restores it', () => {
  const list = [{ url: 'https://a.example', title: 'A', at: 1 }, { url: 'https://b.example', title: 'B', at: 2 }];
  const gone = { url: 'https://c.example', title: 'C', at: 3 };
  const again = [{ url: 'https://c.example', title: 'C', at: 9 }, ...list];
  const back = restoreLater(again, gone, 2);
  assert.equal(back.filter(b => b.url === 'https://c.example').length, 1);
  assert.equal(back.findIndex(b => b.url === 'https://c.example'), 2);
});
