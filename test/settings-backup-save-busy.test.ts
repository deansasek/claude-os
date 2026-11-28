// A second tap on Settings > Storage "Save to PC" does not start a second save (src/apps/settings/web/index.ts initBackup).
// The Settings page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/settings/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf("$('stBkSave').addEventListener('click', async () => {");
const handler = src.slice(start, src.indexOf('\n  });', start));

test('the save handler returns while a save runs, and clears the flag in finally', () => {
  assert.ok(start > 0, 'the Save to PC handler exists');
  assert.match(src, /let backupSaving = false;/);
  assert.match(handler, /if \(backupSaving\) return;\s*backupSaving = true;/);
  assert.match(handler, /finally \{\s*backupSaving = false;\s*\}/);
});

test('the guard comes before the save is sent', () => {
  const guard = handler.indexOf('if (backupSaving) return;');
  assert.ok(guard > 0 && guard < handler.indexOf('await saveSettings()'), 'the guard comes before saveSettings()');
});
