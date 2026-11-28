// Claude's tablet_status tool reads the tablet's battery and Wi-Fi with the words the voice uses (src/apps/claude/...).
// The tools run in the SDK and on the tablet, so their wiring is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => readFileSync(new URL(`../src/apps/claude/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tablet = read('server/tablet.ts');
const relay = read('web/browser-relay.ts');
const cards = read('web/tools.ts');

test('tablet_status is a read-only tool, passed to the tablet with no arguments', () => {
  assert.ok(tablet.includes("tool('tablet_status',"));
  assert.ok(tablet.includes("if (op === 'clock_status' || op === 'cancel_alarms' || op === 'tablet_status') return { ok: true, op, args: {} };"));
  assert.ok(read('server/browser.ts').includes("| 'tablet_status' | 'dnd';"));
});

test('the tablet answers with the battery and Wi-Fi words the voice uses', () => {
  assert.ok(relay.includes("if (job.op === 'tablet_status') return runStatus();"));
  assert.ok(relay.includes('`${batterySay(device.battery())} ${wifiSay(device.wifi())}`'));
  assert.ok(relay.includes("import { batterySay } from '../../../core/web/voice-battery.ts';"));
});

test('the approval card names the tablet_status tool', () => {
  assert.ok(cards.includes("'mcp__claudeos_tablet__tablet_status': { now: 'Check the tablet’s battery and Wi-Fi', past: 'Checked the tablet’s battery and Wi-Fi', doing: 'Checking the battery and Wi-Fi' },"));
});
