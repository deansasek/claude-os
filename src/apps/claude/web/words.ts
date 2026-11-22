// Claude-only wording: how fast a limit is going, and what a tool call is doing.
import { whenText } from '../../../core/web/format.ts';
import type { LimitWindow } from '../api.ts';
import { wordsFor } from './tools.ts';

export interface Pace {
  frac: number;          // share of the window that has passed
  short: string;
  long: string;
  cls: 'good' | 'warn' | 'hot-t';
}

/** Compare the share of a limit used with the share of its window that has passed. */
export function pace(lim: LimitWindow | undefined, windowMs: number): Pace | null {
  if (!lim || lim.used == null || !lim.resets_at) return null;
  const now = Date.now(), reset = Date.parse(lim.resets_at);
  const remaining = Math.max(0, reset - now), elapsed = windowMs - remaining;
  const frac = Math.min(1, Math.max(0, elapsed / windowMs));
  const used = Math.min(100, Math.max(0, lim.used));
  if (used >= 100) return { frac, short: 'Limit reached', long: `Back at ${whenText(new Date(reset))}`, cls: 'hot-t' };
  if (elapsed <= 0 || used === 0) return { frac, short: 'On track', long: 'Plenty of room', cls: 'good' };
  const rate = used / elapsed, outIn = (100 - used) / rate;
  if (outIn < remaining) {
    const at = new Date(now + outIn);
    return { frac, short: `Runs out ~${whenText(at)}`, long: `Runs out ~${whenText(at)} at this rate`, cls: outIn < remaining / 2 ? 'hot-t' : 'warn' };
  }
  return { frac, short: 'On track', long: `~${Math.round(100 - (used + rate * remaining))}% left at reset`, cls: 'good' };
}

// the status line's words for a tool: the same names as the transcript and approval cards (tools.ts)
export const toolWord = (t: string | null): string => (!t ? 'Working' : wordsFor(t).doing);
