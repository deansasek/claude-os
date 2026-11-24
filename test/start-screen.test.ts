// The start screen in public/index.html: the Claude mark with a slow pulse, drawn with the core.css tokens.
// This is a source-text check: index.html is a plain page, not a module, so the test reads its text.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const dom = fs.readFileSync(path.join(ROOT, 'src', 'core', 'web', 'dom.ts'), 'utf8');

/** The part of the boot script that draws the start screen: from buildScreen to showScreen. */
const screen = html.slice(html.indexOf('function buildScreen() {'), html.indexOf('function showScreen('));

test('the start screen is drawn with core.css tokens and no raw colour', () => {
  assert.ok(screen.length > 200, 'buildScreen found');
  assert.doesNotMatch(screen, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(screen, /#fff\b|\bwhite\b|rgba?\(/i);
  for (const token of ['--bg', '--text', '--t3', '--clay', '--serif', '--sans', '--ease-std']) {
    assert.ok(screen.includes(`var(${token})`), `uses var(${token})`);
  }
});

test('the Claude mark is the spark from dom.ts, inline and drawn in the clay token', () => {
  const spark = /export const SPARK_PATH = '([^']+)';/.exec(dom)?.[1];
  assert.ok(spark, 'SPARK_PATH in dom.ts');
  assert.ok(screen.includes(`<path d="${spark}"/>`), 'the start screen carries the same spark path');
  assert.match(screen, /<svg class="hub-mark" viewBox="-50 -50 100 100" aria-hidden="true">/);
  assert.match(screen, /#hub-start \.hub-mark\{[^}]*fill:var\(--clay\)/);
});

test('the mark pulses slowly with transform and opacity only', () => {
  assert.match(screen, /animation:hub-start-pulse 3\.2s/);
  const keys = /@keyframes hub-start-pulse\{([^]*?)\}\}/.exec(screen)?.[1] ?? '';
  assert.ok(keys.includes('transform:scale(') && keys.includes('opacity:'), 'keyframes use transform and opacity');
  assert.doesNotMatch(keys, /width|height|top|left|background|color/);
});

test('reduced motion stops the pulse', () => {
  assert.match(screen, /@media \(prefers-reduced-motion:reduce\)\{#hub-start \.hub-mark\{animation:none\}\}/);
});

test('the start screen keeps its text: ClaudeOS and the status line', () => {
  assert.match(screen, /<h1>ClaudeOS<\/h1><p><\/p>/);
  assert.match(html, /showScreen\('Starting up…'\)/);
});

test('the inline boot script still parses', () => {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(inline.length >= 1);
  for (const code of inline) assert.doesNotThrow(() => new vm.Script(code));
});
