// Dice and the coin, with no DOM. The random source is passed in, so the tests can say exactly what comes up.
export type Rand = () => number;

/** How many dice a roll can use. */
export const MIN_DICE = 1;
export const MAX_DICE = 6;

/** Roll n dice (clamped to 1 to 6). Each face is 1 to 6. */
export function rollDice(n: number, rand: Rand = Math.random): number[] {
  const count = Math.min(MAX_DICE, Math.max(MIN_DICE, Math.floor(n)));
  return Array.from({ length: count }, () => Math.min(5, Math.floor(rand() * 6)) + 1);
}

/** The coin: heads or tails. */
export const flipCoin = (rand: Rand = Math.random): 'Heads' | 'Tails' => (rand() < 0.5 ? 'Heads' : 'Tails');

/** The total of a roll. */
export const total = (faces: number[]): number => faces.reduce((a, b) => a + b, 0);
