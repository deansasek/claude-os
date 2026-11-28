// Kitchen units, with no DOM: cups, tablespoons, teaspoons, millilitres and US fluid ounces (volume), and degrees
// Fahrenheit and Celsius (temperature). Volume is kept in millilitres; weight is not converted (it needs a density per food).

export type Unit = 'cup' | 'tbsp' | 'tsp' | 'ml' | 'floz' | 'F' | 'C';

export const UNITS: { id: Unit; label: string; group: 'volume' | 'temp' }[] = [
  { id: 'cup', label: 'cup', group: 'volume' },
  { id: 'tbsp', label: 'tbsp', group: 'volume' },
  { id: 'tsp', label: 'tsp', group: 'volume' },
  { id: 'ml', label: 'ml', group: 'volume' },
  { id: 'floz', label: 'fl oz', group: 'volume' },
  { id: 'F', label: '°F', group: 'temp' },
  { id: 'C', label: '°C', group: 'temp' },
];

// US customary measures, in millilitres
const ML: Partial<Record<Unit, number>> = { cup: 236.588, tbsp: 14.787, tsp: 4.929, ml: 1, floz: 29.574 };

/** Convert a value between two units of the same kind. Null when the units cannot be converted to each other. */
export function convert(value: number, from: Unit, to: Unit): number | null {
  if (!Number.isFinite(value)) return null;
  if (from === to) return value;
  if (from === 'F' || from === 'C' || to === 'F' || to === 'C') {
    if (from === 'F' && to === 'C') return (value - 32) * 5 / 9;
    if (from === 'C' && to === 'F') return value * 9 / 5 + 32;
    return null;
  }
  const a = ML[from], b = ML[to];
  return a && b ? (value * a) / b : null;
}

/** A result for the readout: at most two decimal places, with no trailing zeros. */
export function roundResult(v: number): string {
  return String(Math.round(v * 100) / 100);
}
