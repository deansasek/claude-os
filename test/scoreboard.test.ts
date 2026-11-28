// The Scoreboard scores (src/apps/scoreboard/web/score.ts). Pure logic, so it is tested directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { change, leaders, newGame, parse, undo } from '../src/apps/scoreboard/web/score.ts';

test('a new game has two to six players at zero', () => {
  assert.deepEqual(newGame(3).players, [0, 0, 0]);
  assert.equal(newGame(0).players.length, 2);
  assert.equal(newGame(9).players.length, 6);
});

test('a change moves one player, and an unknown player changes nothing', () => {
  const g = change(newGame(3), 1, 2);
  assert.deepEqual(g.players, [0, 2, 0]);
  assert.equal(change(g, 5, 1), g);
  assert.equal(change(g, -1, 1), g);
});

test('undo takes back the last change, and a game with no changes is unchanged', () => {
  const g = change(change(newGame(2), 0, 1), 1, 4);
  assert.deepEqual(undo(g).players, [1, 0]);
  assert.deepEqual(undo(undo(undo(g))).players, [0, 0]);
  const fresh = newGame(2);
  assert.equal(undo(fresh), fresh);
});

test('the leader is the top score, and nobody leads at zero', () => {
  assert.deepEqual(leaders(newGame(3)), []);
  assert.deepEqual(leaders(change(change(newGame(3), 0, 4), 2, 4)), [0, 2]);
});

test('a saved game is read back, and anything else is not a game', () => {
  const g = change(newGame(4), 2, 3);
  assert.deepEqual(parse(JSON.stringify(g)), g);
  assert.equal(parse(null), null);
  assert.equal(parse('nope'), null);
  assert.equal(parse(JSON.stringify({ players: [1], history: [] })), null);
});
