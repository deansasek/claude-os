// The lock screen's critter (src/core/web/critter-svg.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CRITTER_VIEWBOX, critterSvg } from '../src/core/web/critter-svg.ts';

test('the critter is one crisp svg in its own 14 x 9.6 box', () => {
  const svg = critterSvg();
  assert.match(svg, /^<svg [^>]*viewBox="0 0 14 9.6"/);
  assert.equal(CRITTER_VIEWBOX, '0 0 14 9.6');
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /^<svg viewBox=/);   // no class unless one is asked for
});

test('the class goes on the svg, and the moving part is .crit-body', () => {
  assert.match(critterSvg('lock-crit'), /^<svg class="lock-crit" /);
  assert.equal(critterSvg('lock-crit').match(/class="crit-body"/g)?.length, 1);
});

test('the critter uses the theme colours and is awake', () => {
  const svg = critterSvg();
  for (const token of ['--clay', '--clay-deep', '--eye', '--blush']) assert.ok(svg.includes(`var(${token})`), token);
  assert.equal(svg.match(/<rect /g)?.length, 11);                      // 4 feet, 2 arms, the body, 2 eyes, 2 cheeks
  assert.ok(svg.includes('<rect x="4" y="3" width="1" height="2"/>'));  // open eyes, as on Home
  assert.ok(!svg.includes('height=".5"'));                               // no shut eyes
});
