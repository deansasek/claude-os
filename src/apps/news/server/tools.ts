// Claude's News tools, as one in-process MCP server (claudeos_news) that turns.ts adds to each session.
// Read-only: the headlines from the feeds the family has switched on (newsFeed, the same read the News app uses),
// and which News topics are on or off (topicsView, the same list as Settings).
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { newsFeed } from './news.ts';
import { topicsView } from './topics.ts';

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

/** The news_topics reply: each News topic and whether it is on, so Claude can say which are switched off. read defaults to topicsView. */
export function newsTopicsReply(read: () => { topics: { name: string; on: boolean }[] } = () => topicsView()) {
  let r;
  try { r = read(); } catch { return text('The news topics couldn’t be read just now. Try again in a little while.', true); }
  if (!r.topics.length) return text('There are no News topics.', true);
  return text(r.topics.map(t => `${t.name}: ${t.on ? 'on' : 'off'}`).join('\n'));
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
    tool('news_topics',
      'List the News topics on the ClaudeOS tablet (the news sources the family can switch on or off in Settings), each with whether it is on. '
        + 'Read-only. Use it when there are no headlines, to say which topics are switched off.',
      {},
      async () => newsTopicsReply()),
  ],
});
