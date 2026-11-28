// The Calculator's arithmetic and key presses (src/apps/calculator/web/calc.ts). Pure logic, so it is tested directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { START, display, evaluate, format, step, type CalcState } from '../src/apps/calculator/web/calc.ts';

// Press a string of keys, one at a time, from a start state.
const press = (keys: string[], from: CalcState = START): CalcState => keys.reduce((s, k) => step(s, k), from);

test('evaluate keeps the usual precedence, and reads leading and repeated minus signs', () => {
  assert.equal(evaluate('2+3×4'), 14);
  assert.equal(evaluate('10÷4'), 2.5);
  assert.equal(evaluate('8−3−2'), 3);
  assert.equal(evaluate('−3+5'), 2);
  assert.equal(evaluate('5×−2'), -10);
  assert.equal(evaluate('5−−3'), 8);
});

test('a percent sign divides the number before it by one hundred', () => {
  assert.equal(evaluate('50%'), 0.5);
  assert.equal(evaluate('100%×50'), 50);
});

test('evaluate returns null for a divide by zero, an unfinished sum, or anything unreadable', () => {
  assert.equal(evaluate('1÷0'), null);
  assert.equal(evaluate('5+'), null);
  assert.equal(evaluate('5 5'), null);
  assert.equal(evaluate('2+x'), null);
});

test('format shows whole numbers as they are, and rounds the rest to twelve significant digits', () => {
  assert.equal(format(15), '15');
  assert.equal(format(0.1 + 0.2), '0.3');
  assert.equal(format(1 / 3), '0.333333333333');
});

test('a sum types, evaluates and shows its result', () => {
  const s = press(['1', '2', '+', '3', '=']);
  assert.equal(display(s), '15');
  assert.equal(s.done, true);
});

test('a number typed after = starts a new calculation, and an operator carries on from the result', () => {
  assert.equal(display(press(['5'], press(['1', '5', '='] ))), '5');
  assert.equal(display(press(['+', '2', '='], press(['1', '5', '=']))), '17');
});

test('the decimal point is added once per number, and a leading point gets its zero', () => {
  assert.equal(display(press(['1', '.', '2', '.'])), '1.2');
  assert.equal(display(press(['.'])), '0.');
});

test('a dangling operator is dropped when = is pressed', () => {
  assert.equal(display(press(['2', '+', '='])), '2');
});

test('a divide by zero shows Error, and the next number starts again', () => {
  const failed = press(['1', '÷', '0', '=']);
  assert.equal(display(failed), 'Error');
  assert.equal(display(press(['5'], failed)), '5');
});

test('C clears, and backspace removes the last key, or clears a finished result', () => {
  assert.equal(display(press(['1', '2', '3', 'C'])), '0');
  assert.equal(display(press(['1', '2', '⌫'])), '1');
  assert.equal(display(press(['⌫'], press(['1', '='])))  , '0');
});

test('a percent sign follows a number only, and no number follows it', () => {
  assert.equal(display(press(['5', '0', '%'])), '50%');
  assert.equal(display(press(['%'])), '0');
  assert.equal(display(press(['5', '0', '%', '3'])), '50%');
});

test('only a minus can start an expression, and an operator replaces the one just typed', () => {
  assert.equal(display(press(['+'])), '0');
  assert.equal(display(press(['−', '5'])), '−5');
  assert.equal(display(press(['5', '+', '×'])), '5×');
});
