// Quick sums by voice: "what's 12 times 7", "what is 100 divided by 8", "what's half of 30". Pure: no DOM, no fetch, so Node tests it
// (test/voice-math.test.ts). The sum is worked out by the Calculator's own parser (apps/calculator/web/calc.ts), so the answer
// matches the Calculator app. Anything that is not a plain sum returns null and the phrase goes on.
import { evaluate, format } from '../../apps/calculator/web/calc.ts';

/** The reply for a sum asked for, or null when the phrase is not a sum this can work out. Takes what was heard (any case,
 *  symbols such as + × ÷ % and x between two numbers are read as words). */
export function mathSay(raw: string): string | null {
  // speech writes a thousands comma ("1,500"): it is taken out first, so the number reads as one number
  const t = raw.toLowerCase().replace(/’/g, "'").replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim();
  const m = /^(?:what(?:'s| is)|how much is) (.+)$/.exec(t);
  if (!m) return null;
  const sum = m[1].trim();
  // symbols heard from speech: between two numbers, + × x ÷ % and - become the words
  let s = sum
    // "7 squared" and "3 cubed" are the number multiplied by itself (the words become times, then the symbol)
    .replace(/(\d+(?:\.\d+)?) squared\b/g, '$1 times $1')
    .replace(/(\d+(?:\.\d+)?) cubed\b/g, '$1 times $1 times $1')
    .replace(/(\d)\s*\+\s*(\d)/g, '$1 plus $2')
    .replace(/(\d)\s*[×x*]\s*(\d)/g, '$1 times $2')
    .replace(/(\d)\s*÷\s*(\d)/g, '$1 divided by $2')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 divided by $2')
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 minus $2')
    .replace(/\s+/g, ' ');
  s = s
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
