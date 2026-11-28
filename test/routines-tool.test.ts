// Claude's routines_list tool lists the user's routines with their steps (src/apps/routines/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { routinesListReply } from '../src/apps/routines/server/tools.ts';

const routine = (name: string, steps: unknown[], at?: unknown) => ({ id: name, name, phrases: [], steps, ...(at ? { at } : {}) }) as never;
const ok = (routines: unknown[]) => async () => ({ ok: true, routines }) as never;

test('each routine comes with its steps in order', async () => {
  const r = await routinesListReply(ok([
    routine('Good morning', [{ kind: 'weather' }, { kind: 'say', text: 'Hello' }]),
  ]));
  assert.equal(r.content[0].text, 'Good morning: Say the weather; Say “Hello”');
});

test('a set run time is said, with its time and its days', async () => {
  const everyDay = await routinesListReply(ok([routine('Wake up', [{ kind: 'weather' }], { h: 7, m: 5, days: [0, 1, 2, 3, 4, 5, 6] })]));
  assert.equal(everyDay.content[0].text, 'Wake up (runs at 07:05 every day): Say the weather');
  const weekdays = await routinesListReply(ok([routine('Work', [{ kind: 'weather' }], { h: 8, m: 30, days: [1, 2, 3, 4, 5] })]));
  assert.equal(weekdays.content[0].text, 'Work (runs at 08:30 on Monday, Tuesday, Wednesday, Thursday, Friday): Say the weather');
});

test('no routines says so, and a failed read says it could not be read', async () => {
  assert.equal((await routinesListReply(ok([]))).content[0].text, 'There are no routines yet.');
  const failed = await routinesListReply(async () => ({ ok: false, routines: [], error: 'down' }) as never);
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /couldn’t be read/);
});

test('the tool is wired into each session, and its approval card has plain words', () => {
  const tools = readFileSync(new URL('../src/apps/routines/server/tools.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tools.includes("tool('routines_list',"));
  assert.ok(cards.includes("'mcp__claudeos_routines__routines_list': { now: 'List the routines', past: 'Listed the routines', doing: 'Listing the routines' },"));
});
