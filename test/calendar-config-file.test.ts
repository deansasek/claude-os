// The calendar config on a scratch file: a readable one loads; a broken one is moved aside, and a save never overwrites it.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-calendar-'));
const file = path.join(dir, 'calendar-config.json');
process.env.CLAUDEOS_CALENDAR_CONFIG = file;

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a readable config loads with its address, shown masked', async () => {
  fs.writeFileSync(file, JSON.stringify({ address: 'https://calendar.example.com/private/abc.ics' }));
  const cal = await import(`../src/apps/calendar/server/calendar.ts?good=${Date.now()}`);
  assert.equal(cal.status().configured, true);
  assert.equal(cal.status().address, 'calendar.example.com/…', 'only the host is shown, never the secret path');
  assert.equal(fs.existsSync(file), true, 'a good config is left where it is');
});

test('a broken config is moved aside as .corrupt and loads as not set up', async () => {
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '{ "address": "https://calendar.example.com/private/keep-me.ics", broken');
  const cal = await import(`../src/apps/calendar/server/calendar.ts?broken=${Date.now()}`);
  assert.equal(cal.status().configured, false, 'a broken file gives no address');
  assert.equal(fs.existsSync(file), false, 'the broken file is no longer in place');
  assert.equal(
    fs.readFileSync(`${file}.corrupt`, 'utf8'),
    '{ "address": "https://calendar.example.com/private/keep-me.ics", broken',
  );
});

test('a save after a broken config does not overwrite the .corrupt copy', async () => {
  const corrupt = fs.readFileSync(`${file}.corrupt`, 'utf8');
  const cal = await import(`../src/apps/calendar/server/calendar.ts?save=${Date.now()}`);
  const res = cal.saveConfig('https://calendar.example.com/private/new.ics');
  assert.equal(res.ok, true, 'the new address saves');
  assert.equal(res.configured, true);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), corrupt, 'the set-aside copy is left as it was');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).address, 'https://calendar.example.com/private/new.ics');
});
