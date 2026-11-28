// The backup saved time and the last-update time follow the 24-hour setting (src/core/web/time-format.ts, used by
// src/apps/settings/web/backup.ts and index.ts). backup.ts needs the DOM, so its wiring is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dayTimeText } from '../src/core/web/time-format.ts';

const at = new Date(2026, 10, 28, 15, 5);
const backup = readFileSync(new URL('../src/apps/settings/web/backup.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/apps/settings/web/index.ts', import.meta.url), 'utf8');

test('the day and time note shows 15:05 on the 24-hour setting, and 3:05 PM on the 12-hour one', () => {
  assert.match(dayTimeText(at, '1'), /, 15:05$/);
  assert.match(dayTimeText(at, '0'), /, 3:05\s?PM$/);
});

test('the backup note takes the setting and passes it to the saved note', () => {
  assert.ok(backup.includes('export function backupNote(b: BackupState | null, h24?: string | null): string {'));
  assert.ok(backup.includes('export function savedNote(saved: string, count: number, h24?: string | null): string {'));
  assert.ok(backup.includes('const when = dayTimeText(new Date(saved), h24);'));
});

test('the Settings page passes the setting to both the backup note and the last-update line', () => {
  assert.ok(settings.includes("backupNote(b, store.get('os.clock24'))"));
  assert.ok(settings.includes("savedNote(r.saved, r.count ?? 0, store.get('os.clock24'))"));
  assert.ok(settings.includes("dayTimeText(new Date(l.at ?? 0), store.get('os.clock24'))"));
});
