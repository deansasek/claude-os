// The conversation in the Sessions screen, drawn like a Claude Code session in the desktop app:
// your messages as bubbles on the right, Claude's words as plain text, tool steps folded.
// Tap a message and a small row opens under it (copy, fork, pin, read aloud, and how long ago); the row
// is drawn here, what the buttons do is in reply.ts. Pure HTML builders; the screen owns the element and the scrolling.
import { esc, SPARK_SHAPE } from '../../../../core/web/dom.ts';
import { markdown } from '../../../../core/web/markdown.ts';
import type { SessionView, TranscriptEntry } from '../../api.ts';
import { quickChips } from './quick-chips.ts';

export const SPARK = '<svg viewBox="-50 -50 100 100" class="m-spark"><g fill="var(--clay)" class="spark-rays"></g></svg>';
export const SPARK_RAYS = SPARK_SHAPE;   // the shared Claude spark (core/web/dom.ts)

/** What the message rows need from the screen: which row is open, what is being read aloud, is voice there. */
export interface MsgUi { open: string | null; speaking: string | null; voice: boolean; now: number; hint?: string | null }

/** The one-time hint under a reply, until the first tap on any message (reply.ts: claude.hint.msgActions). */
const MSG_HINT = '<div class="m-hint">Tap a message for copy, pin and more</div>';

const lines = (s: string) => esc(s).replace(/\n/g, '<br>');
const timeOf = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
export const openGroups = new Set<string>();     // tool runs the user has expanded
export const openClips = new Set<string>();      // long messages the user has expanded
const GAP_MS = 10 * 60e3;                        // show the time when a conversation picks up after a pause

/** A message's key on the screen: its log id, or its place in the transcript when it has none. */
export const msgKey = (e: TranscriptEntry, i: number): string => e.id || `i${i}`;

/** "Just now", "2 minutes ago", "3 hours ago", then the day and time. */
export function relAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const m = Math.round((now - at) / 60e3);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeOf(iso)}`;
}

const ICON = {
  copy: '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6"/><path d="M3 10.5V3.6C3 2.7 3.7 2 4.6 2H10"/></svg>',
  fork: '<svg viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 5v6M4 9c0-2 1.5-3 6.5-3"/></svg>',
  pin: '<svg viewBox="0 0 16 16"><path d="M6 2.5h4l-.6 4 2 2.2v1H4.6v-1l2-2.2zM8 9.7V14"/></svg>',
  speak: '<svg viewBox="0 0 16 16"><path d="M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5z"/><path d="M10.5 5.8a3 3 0 0 1 0 4.4M12.6 3.8a5.6 5.6 0 0 1 0 8.4"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.4"/></svg>',
};

/** The row under an open message: copy · fork (replies only) · pin · read aloud (where voice is) · how long ago. */
function actsHtml(e: TranscriptEntry, key: string, ui: MsgUi): string {
  const btn = (act: string, label: string, icon: string, on = false) =>
    `<button class="m-act${on ? ' on' : ''}" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}">${icon}</button>`;
  const reading = ui.speaking === key;
  return `<div class="m-acts">`
    + btn('copy', 'Copy', ICON.copy)
    + (e.kind === 'assistant' && e.id ? btn('fork', 'Fork from here', ICON.fork) : '')
    + (e.id ? btn('pin', e.pinned ? 'Unpin' : 'Pin', ICON.pin, !!e.pinned) : '')
    + (ui.voice ? btn('speak', reading ? 'Stop reading' : 'Read aloud', reading ? ICON.stop : ICON.speak, reading) : '')
    + `<span class="m-when" data-when="${esc(key)}">${esc(relAgo(e.at, ui.now))}</span></div>`;
}

function toolRow(e: TranscriptEntry): string {
  const showDetail = e.detail && e.text === 'Ran a command';
  return `<div class="m-tool"><i></i><b>${esc(e.text)}</b>${showDetail ? `<code>${esc(e.detail!)}</code>` : ''}</div>`;
}

/** Group the transcript: runs of 3+ tool calls fold into one tappable line. */
export function transcriptHtml(entries: TranscriptEntry[], active: boolean, ui: MsgUi = { open: null, speaking: null, voice: false, now: Date.now() }): string {
  let html = '', prevAt = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], at = e.at ? Date.parse(e.at) : 0;
    if (at && (!prevAt || at - prevAt > GAP_MS)) html += `<div class="m-time">${esc(timeOf(e.at))}</div>`;
    if (at) prevAt = at;
    if (e.kind === 'tool') {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].kind === 'tool') j++;
      const run = entries.slice(i, j + 1);
      const id = `g${i}-${e.at}`;
      const last = j === entries.length - 1;
      if (run.length < 3) html += run.map(toolRow).join('');
      else if (openGroups.has(id) || (last && active)) {
        html += `<div class="m-group open" data-group="${esc(id)}"><i></i><span>Hide ${run.length} steps</span></div>` + run.map(toolRow).join('');
      } else {
        html += `<div class="m-group" data-group="${esc(id)}"><i></i><span><b>${run.length} steps</b> · ${esc(run[run.length - 1].text)}</span><em>Show</em></div>`;
      }
      const lastAt = run[run.length - 1].at;
      if (lastAt) prevAt = Date.parse(lastAt);
      i = j;
      continue;
    }
    const key = msgKey(e, i);
    const acts = ui.open === key ? actsHtml(e, key, ui) : '';
    const wrap = `<div class="m-msg${e.pinned ? ' pinned' : ''}" data-msg="${esc(key)}">`;
    if (e.kind === 'user') {
      const long = e.text.length > 420 || e.text.split('\n').length > 7, id = `u-${e.at}`;
      const clip = long && !openClips.has(id);
      // photos sent with the message: thumbnails (a tap opens them full size, see reply.ts)
      const photos = e.images?.length
        ? `<div class="m-photos">${e.images.map(u => `<button class="m-photo" data-photo="${esc(u)}" aria-label="Photo, tap to see it larger"><img loading="lazy" src="${esc(u)}" alt="" onerror="this.closest('.m-photo').classList.add('gone')"></button>`).join('')}</div>`
        : '';
      html += `${wrap}<div class="m-user"><div class="${clip ? 'clip' : ''}" ${long ? `data-clip="${esc(id)}"` : ''}>${photos}${e.text ? lines(e.text) : ''}</div></div>${acts}</div>`;
    } else if (e.kind === 'assistant') html += `${wrap}<div class="m-asst">${markdown(e.text)}</div>${acts}${ui.hint === key && !acts ? MSG_HINT : ''}</div>`;
    else html += `<div class="m-note">${esc(e.text)}</div>`;
  }
  return html;
}

/** Quick replies that fit what Claude just said. [label, what gets sent] */
export function quickReplies(v: SessionView): [string, string][] {
  const last = [...v.transcript].reverse().find(e => e.kind === 'assistant' || e.kind === 'user');
  return quickChips(last?.kind === 'assistant' ? last.text : '');
}
