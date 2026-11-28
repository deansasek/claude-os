// Scaling a recipe to other servings (src/apps/recipes/web/scale.ts), and the stepper on the recipe page (index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { kitchenNumber, scaleAmount, servesCount } from '../src/apps/recipes/web/scale.ts';

test('the servings count is read from the Serves text', () => {
  assert.equal(servesCount('4'), 4);
  assert.equal(servesCount('4 people'), 4);
  assert.equal(servesCount(''), null);
  assert.equal(servesCount('0'), null);
  assert.equal(servesCount('a few'), null);
});

test('amounts scale and show as kitchen fractions', () => {
  assert.equal(scaleAmount('2 tbsp', 0.5), '1 tbsp');
  assert.equal(scaleAmount('1/2 cup', 2), '1 cup');
  assert.equal(scaleAmount('1 1/2 cups', 2), '3 cups');
  assert.equal(scaleAmount('1 1/2 cups', 1.5), '2 1/4 cups');
  assert.equal(scaleAmount('1 cup', 0.5), '1/2 cup');
  assert.equal(scaleAmount('1/3 cup', 3), '1 cup');
  assert.equal(scaleAmount('2 eggs', 1.5), '3 eggs');
  assert.equal(scaleAmount('1 tsp', 0.5), '1/2 tsp');
});

test('an amount with no number, or a range, is left as it is', () => {
  assert.equal(scaleAmount('a pinch', 2), 'a pinch');
  assert.equal(scaleAmount('to taste', 3), 'to taste');
  assert.equal(scaleAmount('2-3 cups', 2), '2-3 cups');
});

test('one serving, or a factor of nothing, changes nothing', () => {
  assert.equal(scaleAmount('1/2 cup', 1), '1/2 cup');
  assert.equal(scaleAmount('2 tbsp', 0), '2 tbsp');
});

test('kitchenNumber rounds to the nearest kitchen fraction', () => {
  assert.equal(kitchenNumber(2.25), '2 1/4');
  assert.equal(kitchenNumber(0.99), '1');
  assert.equal(kitchenNumber(0.4), '3/8');
});

test('the recipe page shows the stepper and scales the amounts with it', () => {
  const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /data-act="serve-minus"/);
  assert.match(src, /case 'serve-plus': if \(servings < 99\) servings\+\+; break;/);
  assert.match(src, /scaleAmount\(g\.amount, factor\)/);
});
