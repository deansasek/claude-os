// "a" or "an" before a spoken word or number (src/core/web/voice-parse.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleFor } from '../src/core/web/voice-parse.ts';

test('a number with a vowel sound takes "an": 8, 11, 18 and 80 to 89', () => {
  assert.equal(articleFor(8), 'an');
  assert.equal(articleFor('11'), 'an');
  assert.equal(articleFor(18), 'an');
  assert.equal(articleFor(80), 'an');
  assert.equal(articleFor(84), 'an');
  assert.equal(articleFor(89), 'an');
});

test('other numbers take "a", including 30 and 90', () => {
  assert.equal(articleFor(30), 'a');
  assert.equal(articleFor(0), 'a');
  assert.equal(articleFor(90), 'a');
  assert.equal(articleFor(60), 'a');
});

test('a word takes "an" when it starts with a vowel, and "a" otherwise', () => {
  assert.equal(articleFor('egg'), 'an');
  assert.equal(articleFor('oven'), 'an');
  assert.equal(articleFor('pasta'), 'a');
  assert.equal(articleFor('tea'), 'a');
});
