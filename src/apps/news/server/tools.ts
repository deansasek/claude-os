// Claude's News tool, as one in-process MCP server (claudeos_news) that turns.ts adds to each session.
// Read-only: the headlines from the feeds the family has switched on (newsFeed, the same read the News app uses).
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { newsFeed } from './news.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

/** The news_headlines reply: up to count stories, newest first, each as "source: title". read defaults to newsFeed. */
export async function newsHeadlines({ count }: { count?: number }, read: typeof newsFeed = newsFeed) {
  let r;
  try { r = await read(); } catch { return text('The news couldn’t be read just now. Try again in a little while.', true); }
  const items = r.items ?? [];
  if (!items.length) return text('No headlines are in the news right now. The news topics may all be switched off in Settings.', true);
  const n = Math.min(count ?? 5, items.length);
  return text(items.slice(0, n).map(i => `${i.source}: ${i.title}`).join('\n'));
}

export const newsServer = createSdkMcpServer({
  name: 'claudeos_news',
  version: '1.0.0',
  tools: [
    tool('news_headlines',
      'Read the top headlines from the News app on the ClaudeOS tablet: the stories from the feeds the family has switched on, newest first, '
        + 'each with its source. Read-only. count: how many, 1 to 10 (the default is 5).',
      { count: z.number().int().min(1).max(10).optional() },
      (args) => newsHeadlines(args)),
  ],
});
