// The Weather units setting is saved to the PC even when no forecast is loaded (src/apps/weather/web/index.ts, setUnits).
// The web page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/weather/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function setUnits(u: Units)');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('setUnits sends the unit to the PC without a loaded forecast as a condition', () => {
  assert.ok(start > 0, 'setUnits exists');
  assert.match(body, /try \{ await sendLocation\(\{ units: u \}\); \}\s*catch \(err\) \{/);
  assert.doesNotMatch(body, /isOk\(wx\)/);
});

test('setUnits restores the saved unit and repaints when the save fails', () => {
  assert.match(body, /const prev = pickUnits;/);
  assert.match(body, /catch \(err\) \{[^]*?report\('wx-units-failed'\); pickUnits = prev; paintUnits\(\);\s*\}/);
});

test('sendLocation clears pcDown once the PC answers, before reading the status', () => {
  const sendStart = src.indexOf('async function sendLocation(');
  const sendBody = src.slice(sendStart, src.indexOf('\n}\n', sendStart));
  assert.ok(sendStart > 0, 'sendLocation exists');
  const posted = sendBody.indexOf('await postJson');
  const cleared = sendBody.indexOf('pcDown = false');
  const checked = sendBody.indexOf("d.status === 'ok'");
  assert.ok(posted > 0, 'sendLocation awaits postJson');
  assert.ok(cleared > posted, 'pcDown = false comes after await postJson');
  assert.ok(checked > cleared, 'pcDown = false comes before the d.status checks');
});

test('choosePlace names the PC and marks it down when the save fails', () => {
  const pickStart = src.indexOf('async function choosePlace(p: Place)');
  const pickBody = src.slice(pickStart, src.indexOf('\n}\n', pickStart));
  assert.ok(pickStart > 0, 'choosePlace exists');
  const catchBody = pickBody.slice(pickBody.indexOf('catch (err)'));
  assert.match(catchBody, /pcDown = true;/);
  assert.match(catchBody, /Couldn’t reach your PC, so <em>\$\{esc\(p\.name\)\}<\/em> isn’t saved\. Try again\./);
  assert.doesNotMatch(pickBody, /Couldn’t save that\./);
});

test('setUnits marks the PC down before it names the PC in the notice', () => {
  const catchBody = body.slice(body.indexOf('catch (err)'));
  const marked = catchBody.indexOf('pcDown = true;');
  const notified = catchBody.indexOf('notify(');
  assert.match(catchBody, /pcDown = true;/);
  assert.ok(marked > 0, 'pcDown = true is in the setUnits catch');
  assert.ok(notified > marked, 'pcDown = true comes before notify(');
});

// saveLocation writes meter-config.json, so it must read it with readJsonOrSetAside: a broken file is kept as
// .corrupt instead of being overwritten by the { units } save. The config path has no seam, so this reads the source.
const weatherFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/weather/server/weather.ts');
const weatherSrc = readFileSync(weatherFile, 'utf8').replace(/\r\n/g, '\n');
const saveStart = weatherSrc.indexOf('export async function saveLocation(');
const saveBody = weatherSrc.slice(saveStart, weatherSrc.indexOf('\n}\n', saveStart));

test('saveLocation reads meter-config.json with readJsonOrSetAside, not readConfig', () => {
  assert.ok(saveStart > 0, 'saveLocation exists');
  assert.match(saveBody, /readJsonOrSetAside<unknown>\(CONFIG_FILE\) \?\? \{\}/);
  assert.doesNotMatch(saveBody, /readConfig\(\)/);
});

test('openPicker keeps the saved unit when no forecast is loaded', () => {
  const pickStart = src.indexOf('function openPicker(): void {');
  const pickBody = src.slice(pickStart, src.indexOf('\n}\n', pickStart));
  assert.ok(pickStart > 0, 'openPicker exists');
  assert.doesNotMatch(pickBody, /: 'fahrenheit'/);
  assert.match(pickBody, /isOk\(wx\) \? wx\.units : pickUnits/);
});

test('a place or unit the PC answers but cannot save is not reported as the PC being unreachable', () => {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /class NotSaved extends Error \{\}/);
  assert.match(src, /throw new NotSaved\(/);
  assert.match(src, /Your PC couldn’t save <em>/);
  assert.match(src, /Your PC couldn’t save the new temperature unit/);
  assert.match(src, /if \(!notSaved\) pcDown = true;/);
});
