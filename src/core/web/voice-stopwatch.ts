// Voice words for the stopwatch: "start the stopwatch" starts or resumes it, "stop the stopwatch" pauses it. Pure: no DOM,
// so Node tests it (test/voice-stopwatch.test.ts). The command handler (voice-commands.ts) asks the Clock app to do it.

/** "start the stopwatch" or "stop the stopwatch" (the caller has already cleaned the phrase), or null. */
export function stopwatchWord(t: string): 'start' | 'stop' | null {
  if (/^(?:start|resume|begin)(?: the| my)? stopwatch$/.test(t)) return 'start';
  if (/^(?:stop|pause|halt)(?: the| my)? stopwatch$/.test(t)) return 'stop';
  return null;
}
