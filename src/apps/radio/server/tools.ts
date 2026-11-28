// Claude's Radio tool, as one in-process MCP server (claudeos_radio) that turns.ts adds to each session.
// Read-only: the stations whose name matches a search (stations in index.ts, the same read the Radio app makes).
// It lists stations; it does not play one. Each call is an ordinary tool call, so it goes through canUseTool first.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { StationsResult } from '../api.ts';
import { stations } from './index.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

/** The radio_search reply: up to count stations, each as "Name (country, codec and bitrate, tags)". read defaults to the Radio search. */
export async function radioSearchReply({ q, count }: { q: string; count?: number }, read: (q: string) => Promise<StationsResult> = name => stations(new URLSearchParams({ q: name }))) {
  let r;
  try { r = await read(q); } catch { return text('The radio stations couldn’t be read just now. Try again in a little while.', true); }
  if (r.status === 'error') return text('The radio stations couldn’t be read just now. Try again in a little while.', true);
  if (!r.stations.length) return text(`No radio stations match “${q}”.`, true);
  const n = Math.min(count ?? 5, r.stations.length);
  return text(r.stations.slice(0, n).map(s => {
    const codec = s.codec ? (s.bitrate ? `${s.codec} ${s.bitrate} kbps` : s.codec) : '';
    const facts = [s.country, codec, ...(s.tags ?? []).slice(0, 3)].filter(Boolean).join(', ');
    return facts ? `${s.name} (${facts})` : s.name;
  }).join('\n'));
}

export const radioServer = createSdkMcpServer({
  name: 'claudeos_radio',
  version: '1.0.0',
  tools: [
    tool('radio_search',
      'Search internet radio stations on the ClaudeOS Radio app by name or genre, e.g. "jazz". Read-only: it lists stations and does not play one. '
        + 'Each comes with its country, codec, bitrate and tags. count: how many, 1 to 10 (the default is 5).',
      { q: z.string().min(1).max(60), count: z.number().int().min(1).max(10).optional() },
      (args) => radioSearchReply(args)),
  ],
});
