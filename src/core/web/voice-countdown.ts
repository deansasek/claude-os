// "How many days until Christmas" by voice. Pure: no DOM, no fetch, so Node tests it (test/voice-countdown.test.ts).
// Only Christmas for now. The count is calendar days: 0 on 25 December, and next year's Christmas once this one has passed.

/** The phrase is a Christmas countdown question (the caller has already cleaned it), or false. */
export function countdownWord(t: string): boolean {
  return /^(?:how many (?:more )?(?:days|sleeps)(?: left)? (?:until|till|til|'til|to|before) christmas(?: day)?|how long (?:is it )?(?:until|till|til|'til|to) christmas(?: day)?|is it christmas(?: day)? yet|(?:days|sleeps)(?: left)? (?:until|till|til|'til) christmas(?: day)?)$/.test(t);
}

/** Calendar days from today until the next 25 December (0 on the day itself). */
export function daysUntilChristmas(now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(today.getFullYear(), 11, 25);
  if (target < today) target = new Date(today.getFullYear() + 1, 11, 25);
  return Math.round((target.getTime() - today.getTime()) / 864e5);
}

/** What the voice says: the count, "It's Christmas today!" on the day, and the day word for one day. */
export function christmasSay(now: Date, sleeps = false): string {
  const n = daysUntilChristmas(now);
  if (n === 0) return 'It’s Christmas today!';
  if (n === 1) return sleeps ? 'One more sleep until Christmas.' : 'Christmas is tomorrow.';
  return sleeps ? `${n} sleeps until Christmas.` : `${n} days until Christmas.`;
}
