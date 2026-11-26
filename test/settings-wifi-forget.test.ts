// The Wi-Fi Forget handler must report a failed forget
// (src/apps/settings/web/index.ts, the forget handler in the Network section).
// The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the forget handler reads the result of wifiForget and tests ok', () => {
  const start = src.indexOf('const forget = (ssid: string) =>');
  const body = src.slice(start, src.indexOf("$('stWifiCurrent').addEventListener", start));
  assert.match(body, /ok = device\.wifiForget\(ssid\)\.ok;/);
  assert.match(body, /if \(!ok\)/);
});

test('the forget handler sets the Couldn’t forget text when the forget fails', () => {
  const start = src.indexOf('const forget = (ssid: string) =>');
  const body = src.slice(start, src.indexOf("$('stWifiCurrent').addEventListener", start));
  assert.match(body, /\$\('stWifiNow'\)\.textContent = 'Couldn’t forget ' \+ ssid \+ '\. Try again\.';/);
});
