// Quick sums by voice: "what's 12 times 7", "what is 100 divided by 8", "what's half of 30". Pure: no DOM, no fetch, so Node tests it
// (test/voice-math.test.ts). The sum is worked out by the Calculator's own parser (apps/calculator/web/calc.ts), so the answer
// matches the Calculator app. Anything that is not a plain sum returns null and the phrase goes on.
import { evaluate, format } from '../../apps/calculator/web/calc.ts';

/** The reply for a sum asked for, or null when the phrase is not a sum this can work out. The phrase is already cleaned. */
export function mathSay(t: string): string | null {
  const m = /^(?:what(?:'s| is)|how much is) (.+)$/.exec(t);
  if (!m) return null;
  const sum = m[1].trim();
  let s = sum
    .replace(/^half of (\d+(?:\.\d+)?)$/, '$1 / 2')
    .replace(/^(?:a )?quarter of (\d+(?:\.\d+)?)$/, '$1 / 4')
    .replace(/(\d+(?:\.\d+)?) percent of (\d+(?:\.\d+)?)/, '$1 / 100 * $2')
    .replace(/ (?:times|multiplied by) /g, ' * ')
    .replace(/ (?:divided by|over) /g, ' / ')
    .replace(/ plus /g, ' + ')
    .replace(/ (?:minus|take away) /g, ' - ');
  if (!/\d/.test(s) || !/[+\-*/%]/.test(s)) return null;   // a number on its own is not a sum
  if (!/^[\d.\s+\-*/%]+$/.test(s)) return null;             // any other word means it is not a sum
  const v = evaluate(s);
  if (v === null) return null;
  return `${sum} is ${format(v)}.`;
}
