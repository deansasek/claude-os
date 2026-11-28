// Top headlines by voice: "what's the news", "read me the headlines". Pure (no DOM, no fetch), so Node tests it
// (test/voice-news.test.ts). voice-commands.ts reads GET /api/news/feed and says the first few titles.

/** The phrase asks for the headlines (the caller has already cleaned it). "News" alone is left to the open-app step. */
export function newsWord(t: string): boolean {
  return /^(?:what(?:'s| is) (?:the |in the )?news|what(?:'s| is) in the news|read (?:me )?(?:the )?headlines|news headlines|top headlines)$/.test(t);
}

/** The first three titles, said in a line: "Top headlines: A; B; and C." Trailing punctuation is not doubled. */
export function newsSay(titles: string[]): string {
  const top = titles.slice(0, 3).map(s => s.trim().replace(/[.!?]+$/, '')).filter(Boolean);
  const words = top.length === 1 ? top[0] : `${top.slice(0, -1).join('; ')}; and ${top[top.length - 1]}`;
  return `Top headlines: ${words}.`;
}
