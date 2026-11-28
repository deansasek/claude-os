// Voice words for the stopwatch: "start the stopwatch" starts or resumes it, "stop the stopwatch" pauses it, "how long is the
// stopwatch" reads its time, "reset the stopwatch" clears it. Pure: no DOM, so Node tests it (test/voice-stopwatch.test.ts).
// The command handler (voice-commands.ts) asks the Clock app to do it.

export type StopwatchWord = 'start' | 'stop' | 'time' | 'reset';

/** A stopwatch phrase (the caller has already cleaned it), or null. */
export function stopwatchWord(t: string): StopwatchWord | null {
  if (/^(?:start|resume|begin)(?: the| my)? stopwatch$/.test(t)) return 'start';
  if (/^(?:stop|pause|halt)(?: the| my)? stopwatch$/.test(t)) return 'stop';
  if (/^(?:how long (?:is|has) (?:the|my) stopwatch(?: been (?:running|going))?|stopwatch time)$/.test(t)) return 'time';
  if (/^(?:reset|clear) (?:the |my )?stopwatch$/.test(t)) return 'reset';
  return null;
}
