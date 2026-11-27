// The rain line for a day in the Weather week list. Pure: no DOM and no imports, so the test can run it under node.
// The amount is rounded for the unit first, and the checks use the rounded value: a tiny amount reads Dry, not 0.00 in.

/** "Dry", or the chance of rain with the amount when it rounds to more than nothing. */
export function rainLine(pp: number, amt: number, unit: string): string {
  const t = amt.toFixed(unit === 'in' ? 2 : 1);
  const wet = Number(t) > 0;
  return pp < 10 && !wet ? 'Dry' : `${pp}% chance of rain${wet ? `, ${t} ${unit}` : ''}`;
}
