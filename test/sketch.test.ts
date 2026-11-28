// The Sketch drawing model (src/apps/sketch/web/strokes.ts). Pure logic, so it is tested directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY, begin, extend, undo } from '../src/apps/sketch/web/strokes.ts';

test('a pen down starts a stroke with its tool and first point', () => {
  const b = begin(EMPTY, 'clay', { x: 1, y: 2 });
  assert.deepEqual(b, [{ tool: 'clay', pts: [{ x: 1, y: 2 }] }]);
});

test('a pen move adds points to the newest stroke, and leaves the earlier ones alone', () => {
  let b = begin(EMPTY, 'ink', { x: 0, y: 0 });
  b = begin(b, 'erase', { x: 5, y: 5 });
  b = extend(b, { x: 6, y: 7 });
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].pts, [{ x: 0, y: 0 }]);
  assert.deepEqual(b[1], { tool: 'erase', pts: [{ x: 5, y: 5 }, { x: 6, y: 7 }] });
});

test('a move with no stroke started does nothing', () => {
  assert.equal(extend(EMPTY, { x: 1, y: 1 }), EMPTY);
});

test('each change returns a new board, so an earlier board is unchanged', () => {
  const first = begin(EMPTY, 'ink', { x: 0, y: 0 });
  const second = extend(first, { x: 1, y: 1 });
  assert.equal(first[0].pts.length, 1);
  assert.equal(second[0].pts.length, 2);
});

test('undo takes the newest stroke back, and an empty board stays empty', () => {
  let b = begin(EMPTY, 'ink', { x: 0, y: 0 });
  b = begin(b, 'clay', { x: 2, y: 2 });
  assert.equal(undo(b).length, 1);
  assert.equal(undo(undo(b)).length, 0);
  assert.deepEqual(undo(EMPTY), []);
});
