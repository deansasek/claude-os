// Speech that drops the apostrophe is heard the same ("whats the time" is "what's the time"). The normaliser is in
// src/core/web/voice-commands.ts, which needs the browser, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rule = "t = t.replace(/ (what|when|how)s(?= )/g, ' $1\\'s');";

test('whats, whens and hows are read with the apostrophe, before the commands match', () => {
  assert.ok(src.includes(rule), 'the normaliser rewrites whats, whens and hows');
  assert.ok(src.indexOf(rule) < src.indexOf('const dinner = dinnerWord(t);'), 'the rewrite runs before the commands');
});
