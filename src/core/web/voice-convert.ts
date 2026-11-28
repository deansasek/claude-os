// Kitchen and temperature conversions by voice: "what's 180 celsius in fahrenheit", "how many tablespoons in a cup",
// "convert 2 cups to millilitres". Pure (no DOM, no fetch). The maths is the Calculator's own converter (convert.ts).
import { convert, roundResult, type Unit } from '../../apps/calculator/web/convert.ts';

// the words people say for each unit, and how each reads back: [singular, plural]
const WORDS: Record<string, Unit> = {
  cup: 'cup', cups: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  'fluid ounce': 'floz', 'fluid ounces': 'floz', 'fl oz': 'floz',
  fahrenheit: 'F', 'degree fahrenheit': 'F', 'degrees fahrenheit': 'F',
  celsius: 'C', centigrade: 'C', 'degree celsius': 'C', 'degrees celsius': 'C', 'degrees centigrade': 'C',
};
const SAY: Record<Unit, [string, string]> = {
  cup: ['cup', 'cups'], tbsp: ['tablespoon', 'tablespoons'], tsp: ['teaspoon', 'teaspoons'], ml: ['millilitre', 'millilitres'],
  floz: ['fluid ounce', 'fluid ounces'], F: ['degree Fahrenheit', 'degrees Fahrenheit'], C: ['degree Celsius', 'degrees Celsius'],
};

const unitOf = (w: string): Unit | undefined => WORDS[w.trim()];
const name = (u: Unit, n: number): string => SAY[u][Math.abs(n - 1) < 1e-9 ? 0 : 1];
const num = (s: string): number => (s === 'a' || s === 'an' || s === 'one' ? 1 : Number(s));

/** The spoken conversion, or null when the phrase is not a conversion or the two units cannot convert. */
export function convertSay(raw: string): string | null {
  // "minus 10", "negative 5", "−10": a minus sign for the number that follows
  const s = raw.toLowerCase().replace(/’/g, "'").replace(/\b(?:minus|negative)\s+(?=\d)/g, '-').replace(/−/g, '-')
    // "5 foot 10", "5 feet 10 inches": a height in feet and inches becomes decimal feet (5 foot 10 is 5.83 feet)
    .replace(/(\d+)\s*(?:foot|feet|ft)\s+(\d+(?:\.\d+)?)(?:\s*(?:inches|inch))?\b/g, (_, f: string, i: string) => `${+f + +i / 12} feet`)
    // "1/2 cup", "3/4 cup": a fraction amount becomes its decimal (a zero denominator is left as Infinity, and answer() refuses it)
    .replace(/(\d+)\/(\d+)\b/g, (_, a: string, b: string) => String(Number(a) / Number(b)))
    // "200g", "500ml": a unit joined to its number gets a space (the unit list is explicit, so "1c" or "2f" are left alone)
    .replace(/(\d)(g|kg|oz|lbs?|ml|tbsps?|tsps?|km|cm|mm|mins?|hrs?|secs?|mi|ft|yd|m|l)\b/g, '$1 $2')
    // "180°C", "350 °F": the degree sign and its letter become the unit word
    .replace(/\s*°\s*c\b/g, ' celsius').replace(/\s*°\s*f\b/g, ' fahrenheit').replace(/\s+/g, ' ')
    .replace(/[?.!]+$/, '').trim();
  // "what's 180 celsius in fahrenheit", "how much is 2 cups in millilitres"
  let m = /^(?:what(?:'s| is)|how much is) (-?\d+(?:\.\d+)?) (.+?) in (.+)$/.exec(s);
  if (m) return answer(Number(m[1]), m[2], m[3], 'is');
  // "convert 2 cups to millilitres"
  m = /^convert (-?\d+(?:\.\d+)?) (.+?) (?:to|into) (.+)$/.exec(s);
  if (m) return answer(Number(m[1]), m[2], m[3], 'is');
  // "how many tablespoons in a cup", "how many cups in 250 millilitres"
  m = /^how many (.+?) in (?:(a|an|one|\d+(?:\.\d+)?) )?(.+)$/.exec(s);
  if (m) return answer(m[2] ? num(m[2]) : 1, m[3], m[1], 'in');
  return null;
}

/** The value of `amount` of `fromWord`, in `toWord`. For "how many", the amount is the given unit and the wanted unit is `toWord`. */
// weight, for voice only: grams per unit. Weight converts only to weight (a cup is not grams without a density).
type WeightUnit = 'g' | 'kg' | 'oz' | 'lb';
const GRAMS: Record<WeightUnit, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const WEIGHT_WORDS: Record<string, WeightUnit> = {
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
};
const WEIGHT_SAY: Record<WeightUnit, [string, string]> = {
  g: ['gram', 'grams'], kg: ['kilogram', 'kilograms'], oz: ['ounce', 'ounces'], lb: ['pound', 'pounds'],
};
const weightName = (u: WeightUnit, n: number): string => WEIGHT_SAY[u][Math.abs(n - 1) < 1e-9 ? 0 : 1];

/** Weight to weight, or null (including a weight to a volume or a temperature). */
function weightAnswer(amount: number, fromWord: string, toWord: string, shape: 'is' | 'in'): string | null {
  const from = WEIGHT_WORDS[fromWord.trim()], to = WEIGHT_WORDS[toWord.trim()];
  if (!from || !to) return null;
  const v = amount * GRAMS[from] / GRAMS[to];
  if (shape === 'is') return `${roundResult(amount)} ${weightName(from, amount)} is ${roundResult(v)} ${weightName(to, v)}.`;
  return `${roundResult(v)} ${weightName(to, v)} in ${amount === 1 ? 'a' : roundResult(amount)} ${weightName(from, amount)}.`;
}

// distance, for voice only: metres per unit. Distance converts only to distance (a mile is not a pound).
type DistUnit = 'm' | 'km' | 'mi' | 'ft' | 'in' | 'cm' | 'mm' | 'yd';
const METRES: Record<DistUnit, number> = { m: 1, km: 1000, mi: 1609.344, ft: 0.3048, in: 0.0254, cm: 0.01, mm: 0.001, yd: 0.9144 };
const DIST_WORDS: Record<string, DistUnit> = {
  m: 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  km: 'km', kilometre: 'km', kilometres: 'km', kilometer: 'km', kilometers: 'km',
  mi: 'mi', mile: 'mi', miles: 'mi', ft: 'ft', foot: 'ft', feet: 'ft',
  inch: 'in', inches: 'in', cm: 'cm', centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  mm: 'mm', millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  yd: 'yd', yard: 'yd', yards: 'yd',
};
const DIST_SAY: Record<DistUnit, [string, string]> = {
  m: ['metre', 'metres'], km: ['kilometre', 'kilometres'], mi: ['mile', 'miles'], ft: ['foot', 'feet'],
  in: ['inch', 'inches'], cm: ['centimetre', 'centimetres'], mm: ['millimetre', 'millimetres'], yd: ['yard', 'yards'],
};
const distName = (u: DistUnit, n: number): string => DIST_SAY[u][Math.abs(n - 1) < 1e-9 ? 0 : 1];

/** Distance to distance, or null (including a distance to a weight or a volume). */
function distanceAnswer(amount: number, fromWord: string, toWord: string, shape: 'is' | 'in'): string | null {
  const from = DIST_WORDS[fromWord.trim()], to = DIST_WORDS[toWord.trim()];
  if (!from || !to) return null;
  const v = amount * METRES[from] / METRES[to];
  if (shape === 'is') return `${roundResult(amount)} ${distName(from, amount)} is ${roundResult(v)} ${distName(to, v)}.`;
  return `${roundResult(v)} ${distName(to, v)} in ${amount === 1 ? 'a' : roundResult(amount)} ${distName(from, amount)}.`;
}

// time, for voice only: seconds per unit. Time converts only to time (an hour is not a gram or a metre).
type TimeUnit = 's' | 'min' | 'h' | 'd' | 'wk' | 'yr';
const SECONDS: Record<TimeUnit, number> = { s: 1, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31536000 };
const TIME_WORDS: Record<string, TimeUnit> = {
  second: 's', seconds: 's', sec: 's', secs: 's',
  minute: 'min', minutes: 'min', min: 'min', mins: 'min',
  hour: 'h', hours: 'h', hr: 'h', hrs: 'h',
  day: 'd', days: 'd', week: 'wk', weeks: 'wk', year: 'yr', years: 'yr',
};
const TIME_SAY: Record<TimeUnit, [string, string]> = {
  s: ['second', 'seconds'], min: ['minute', 'minutes'], h: ['hour', 'hours'],
  d: ['day', 'days'], wk: ['week', 'weeks'], yr: ['year', 'years'],
};
const timeName = (u: TimeUnit, n: number): string => TIME_SAY[u][Math.abs(n - 1) < 1e-9 ? 0 : 1];

/** Time to time, or null (including a time to a weight, a distance or a volume). */
function timeAnswer(amount: number, fromWord: string, toWord: string, shape: 'is' | 'in'): string | null {
  const from = TIME_WORDS[fromWord.trim()], to = TIME_WORDS[toWord.trim()];
  if (!from || !to) return null;
  const v = amount * SECONDS[from] / SECONDS[to];
  if (shape === 'is') return `${roundResult(amount)} ${timeName(from, amount)} is ${roundResult(v)} ${timeName(to, v)}.`;
  return `${roundResult(v)} ${timeName(to, v)} in ${amount === 1 ? 'a' : roundResult(amount)} ${timeName(from, amount)}.`;
}

// litres, for voice only: a litre is 1000 millilitres, so a litre converts through millilitres to any kitchen unit.
const LITRE_WORDS = ['l', 'litre', 'litres', 'liter', 'liters'];
const litreName = (n: number): string => (Math.abs(n - 1) < 1e-9 ? 'litre' : 'litres');

/** A litre to a kitchen unit, or the other way round, or null (litre to litre, or a litre to a weight, distance or time). */
function litreAnswer(amount: number, fromWord: string, toWord: string, shape: 'is' | 'in'): string | null {
  const fromL = LITRE_WORDS.includes(fromWord.trim()), toL = LITRE_WORDS.includes(toWord.trim());
  if (fromL === toL) return null;
  const other = unitOf(fromL ? toWord : fromWord);
  if (!other) return null;
  const ml = fromL ? convert(amount * 1000, 'ml', other) : convert(amount, other, 'ml');
  if (ml === null || !Number.isFinite(ml)) return null;
  const v = fromL ? ml : ml / 1000;   // the wanted amount: in the kitchen unit, or in litres when a litre is wanted
  const fromName = fromL ? litreName(amount) : name(other, amount);
  const toName = toL ? litreName(v) : name(other, v);
  if (shape === 'is') return `${roundResult(amount)} ${fromName} is ${roundResult(v)} ${toName}.`;
  return `${roundResult(v)} ${toName} in ${amount === 1 ? 'a' : roundResult(amount)} ${fromName}.`;
}

function answer(amount: number, fromWord: string, toWord: string, shape: 'is' | 'in'): string | null {
  if (!Number.isFinite(amount)) return null;
  const from = unitOf(fromWord), to = unitOf(toWord);
  if (!from || !to) return litreAnswer(amount, fromWord, toWord, shape) ?? weightAnswer(amount, fromWord, toWord, shape) ?? distanceAnswer(amount, fromWord, toWord, shape) ?? timeAnswer(amount, fromWord, toWord, shape);
  const v = convert(amount, from, to);
  if (v === null) return null;
  if (shape === 'is') return `${roundResult(amount)} ${name(from, amount)} is ${roundResult(v)} ${name(to, v)}.`;
  // "how many": the wanted unit first, then the given one
  return `${roundResult(v)} ${name(to, v)} in ${amount === 1 ? 'a' : roundResult(amount)} ${name(from, amount)}.`;
}
