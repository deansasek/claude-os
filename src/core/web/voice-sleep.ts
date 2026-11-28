// Voice words for the clock screen: "go to sleep" shows the ambient clock, as the Control Center's Rest now tile does.
// Pure: no DOM, so Node tests it (test/voice-sleep.test.ts). The command handler (voice-commands.ts) calls sleep().

/** A phrase that shows the clock screen, or false. The caller has already cleaned the phrase. */
export function sleepWord(t: string): boolean {
  return /^(?:go to sleep|show the clock screen|clock screen|rest now)$/.test(t);
}
