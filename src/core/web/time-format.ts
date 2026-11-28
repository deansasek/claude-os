// The time of day as Settings → Date & time sets it: 24-hour, or the tablet's own locale when unset. Pure: no DOM or
// store, so Node tests it (test/time-format.test.ts). The callers read the setting ('os.clock24': '1' is 24-hour).

/** A formatter for the hour and minute, following the 24-hour setting (h24 is the stored value, or null when unset). */
export function hourMinuteFormat(h24: string | null | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', ...(h24 == null ? {} : { hour12: h24 !== '1' }) });
}
