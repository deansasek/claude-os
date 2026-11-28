// "Say that again": the last answer the tablet spoke is said again (src/apps/claude/web/voice.ts keeps it).
// Pure: no DOM, so Node tests it (test/voice-repeat.test.ts). The caller has already cleaned the phrase.

/** "say that again", "repeat that", "what did you say": true when the family asks for the last answer again. */
export function repeatWord(t: string): boolean {
  return /^(?:say (?:that|it|the last (?:one|bit)) again|repeat (?:that|it|the last (?:one|bit))(?: please)?|what did you say|can you say (?:that|it) again|come again)$/.test(t);
}
