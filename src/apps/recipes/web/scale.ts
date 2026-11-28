// Scaling a recipe to another number of servings, with no DOM. Amounts are kept as kitchen fractions (1/4, 1/3, 1/2, 2/3,
// 3/4), and an amount with no leading number ("a pinch", "to taste") or a range ("2-3 cups") is left as it is.

const FRACTIONS: [number, string][] = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'],
  [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8']];

/** The servings a recipe makes, from its "Serves" text ("4", "4 people"), or null when it gives no number. */
export function servesCount(serves: string): number | null {
  const m = /^\s*(\d{1,2})\b/.exec(serves);
  return m && +m[1] > 0 ? +m[1] : null;
}

/** The amount as a number, and the text after it: "1 1/2 cups" → [1.5, " cups"]. Null when no number starts it. */
function leadingQuantity(amount: string): [number, string] | null {
  const mixed = /^\s*(\d+)\s+(\d+)\/(\d+)(?!\d)/.exec(amount);
  if (mixed && +mixed[3] > 0) return [+mixed[1] + +mixed[2] / +mixed[3], amount.slice(mixed[0].length)];
  const frac = /^\s*(\d+)\/(\d+)(?!\d)/.exec(amount);
  if (frac && +frac[2] > 0) return [+frac[1] / +frac[2], amount.slice(frac[0].length)];
  const dec = /^\s*(\d+(?:\.\d+)?|\.\d+)/.exec(amount);
  if (dec) return [parseFloat(dec[1]), amount.slice(dec[0].length)];
  return null;
}

/** A number as a kitchen fraction: "1 1/2", "2", "3/4". Values that are close to no fraction keep one decimal place. */
export function kitchenNumber(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const part = v - whole;
  const near = FRACTIONS.reduce((best, f) => (Math.abs(f[0] - part) < Math.abs(best[0] - part) ? f : best));
  if (Math.abs(near[0] - part) > 0.05) {
    const text = String(Math.round(v * 10) / 10);
    return text;
  }
  if (near[1] === '') return whole > 0 ? String(whole) : '0';
  return whole > 0 ? `${whole} ${near[1]}` : near[1];
}

/** One ingredient amount scaled by factor (servings wanted ÷ servings in the recipe). */
export function scaleAmount(amount: string, factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return amount;
  const q = leadingQuantity(amount);
  if (!q) return amount;
  const [value, rest] = q;
  if (/^\s*[-–]\s*\d/.test(rest)) return amount;   // a range: "2-3 cups" stays as written
  const scaled = value * factor;
  if (!(scaled > 0)) return amount;
  return `${kitchenNumber(scaled)}${rest}`;
}
