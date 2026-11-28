// The time of day as Settings → Date & time sets it: 24-hour, or the tablet's own locale when unset. Pure: no DOM or
// store, so Node tests it (test/time-format.test.ts). The callers read the setting ('os.clock24': '1' is 24-hour).

/** A formatter for the hour and minute, following the 24-hour setting (h24 is the stored value, or null when unset). */
export function hourMinuteFormat(h24: string | null | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', ...(h24 == null ? {} : { hour12: h24 !== '1' }) });
}

/** A day and time for a note, as Settings → Date & time sets the hour: "28 Nov, 3:05 PM", or "28 Nov, 15:05" on 24-hour. */
export function dayTimeText(d: Date, h24: string | null | undefined): string {
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${hourMinuteFormat(h24).format(d)}`;
}
