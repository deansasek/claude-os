// Claude app routes (all under /api/claude/):
//   GET  usage                       limits, today's numbers, live sessions, Hub turns
//   GET  session?id=…                can the Hub reply to this session, and Claude's last words
//   POST unlock  {pin}               → short-lived token for the actions below
//   POST reply   {token, id, text, model?, effort?, mode?}   send a message to a session (resumes it through the Agent SDK)
//   POST approve {token, turn, approval, allow, mode?}   (mode: for a plan, the mode to carry on in)
//   GET  models                      models this PC's Claude Code offers (the composer's model menu)
//   POST stop    {token, turn}
//   GET  projects                    folders a new session can start in
//   GET  history?q=&folder=&before=&limit=   every past session on the PC, grouped by folder (newest first; search by title)
//   POST new     {token, project, text, voice?, model?, effort?, mode?}   start a brand-new session from the Hub (voice: asked by voice, answer is spoken)
//   GET  image?s=…&m=…&n=…            a photo a message carried, read back from the session's log
//   POST archive {token, id, archived}   hide a session from the list (or bring it back); nothing is deleted
//   POST delete  {token, id}         permanently delete a session's log and its own folders (refused while it runs)
//   POST pin     {token, session, message, on}   pin or unpin one message of a session
//   POST fork    {token, session, message}       a new session continuing from one of Claude's replies
//   POST browser/next  {token, active?}         the tablet's long poll for a browser or tablet job (browser.ts, tablet.ts); null after 15 s
//   POST browser/result {token, id, ok, data}   the tablet's answer to a browser job
import type { Binary, ServerApp } from '../../../core/server/app.ts';
import type { Usage } from '../api.ts';
import { manifest } from '../manifest.ts';
import { checkToken, unlock } from './guard.ts';
import { LIMITS, readPlan, startLimits } from './limits.ts';
import { imageBytes, liveSessions } from './sessions.ts';
import { listProjects } from './hubsessions.ts';
import { history, historyStats, refreshHistory } from './history.ts';
import { archiveSession, deleteSession, forkFrom, pinMessage } from './manage.ts';
import { finishJob, nextJob } from './browser.ts';
import { noteTabletActive } from './tablet.ts';
import { answerApproval, listModels, listTurns, sessionView, settingsFrom, startNew, startTurn, stopTurn } from './turns.ts';
import { Store } from './usage.ts';
import { photoIdsFrom } from '../../photos/server/store.ts';

const store = new Store();

/** How long a usage snapshot is reused. Usage polls come every few seconds from several screens. */
const USAGE_TTL_MS = 1500;
let usageMemo: { at: number; value: Usage } | null = null;

/**
 * The usage snapshot. It scans the session logs and the credentials file, so it is reused for
 * USAGE_TTL_MS. Pass fresh = true when the caller needs the current session state (a reply does).
 */
function usage(fresh = false): Usage {
  if (!fresh && usageMemo && Date.now() - usageMemo.at < USAGE_TTL_MS) return usageMemo.value;
  const { tokensBySession, ...s } = store.summary();
  let sessions: Usage['sessions'] = [];
  try { sessions = liveSessions(tokensBySession); } catch (e) { console.log('sessions error:', e); }
  const value: Usage = { ...s, plan: readPlan(), limits: { ...LIMITS }, sessions, turns: listTurns() };
  usageMemo = { at: Date.now(), value };
  return value;
}

const locked = { ok: false, error: 'locked_out' } as const;   // token missing or expired: unlock again

/** The photos a message carries (photoIds from the Photos and Camera apps); a bad list is sent as none. */
const photoIdsOf = (body: Record<string, unknown>): string[] => photoIdsFrom(body.photoIds) ?? [];

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'usage', handle: () => usage() },
    { method: 'GET', path: 'session', handle: ({ query }) => { usage(); return sessionView(query.get('id') || ''); } },
    { method: 'POST', path: 'unlock', handle: ({ body, from }) => unlock(body.pin, from) },
    {
      method: 'POST', path: 'reply', handle: ({ body, from }) => {
        if (!checkToken(body.token)) return locked;
        usage(true);   // refresh what we know about sessions before checking this one
        return startTurn(String(body.id || ''), String(body.text || ''), from, settingsFrom(body), photoIdsOf(body));
      },
    },
    // Claude control (server/browser.ts): the tablet takes the browser jobs sessions ask for, and answers them
    // (the same relay carries the tablet tools' jobs, server/tablet.ts; each poll says how many timers and alarms are on)
    {
      method: 'POST', path: 'browser/next', handle: ({ body }) => {
        if (!checkToken(body.token)) return locked;
        noteTabletActive(body.active);
        return nextJob().then(job => ({ ok: true, job }));
      },
    },
    {
      method: 'POST', path: 'browser/result', handle: ({ body }) => {
        if (!checkToken(body.token)) return locked;
        finishJob(String(body.id || ''), body.ok === true, String(body.data ?? ''));
        return { ok: true };
      },
    },
    {
      method: 'POST', path: 'approve', handle: ({ body, from }) =>
        checkToken(body.token) ? answerApproval(String(body.turn), String(body.approval), body.allow === true, from, body.mode) : locked,
    },
    { method: 'GET', path: 'models', handle: listModels },
    { method: 'GET', path: 'projects', handle: listProjects },
    {
      method: 'GET', path: 'history', handle: ({ query }) => history({
        q: query.get('q') || '', folder: query.get('folder') || undefined,
        before: query.get('before') || undefined, limit: Number(query.get('limit')) || undefined,
        archived: query.get('archived') === '1',
      }),
    },
    {
      // one photo a message carried, read back from the session's log (GET: the page's <img> needs no PIN)
      method: 'GET', path: 'image', handle: ({ query }): Binary | { ok: false; error: string } => {
        const img = imageBytes(query.get('s') || '', query.get('m') || '', Number(query.get('n')) || 0);
        if (!img) return { binary: true, status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('not found') };
        return { binary: true, contentType: img.type, body: img.data };
      },
    },
    { method: 'POST', path: 'archive', handle: ({ body, from }) => checkToken(body.token) ? archiveSession(String(body.id || ''), body.archived === true, from) : locked },
    { method: 'POST', path: 'delete', handle: ({ body, from }) => checkToken(body.token) ? deleteSession(String(body.id || ''), from) : locked },
    { method: 'POST', path: 'pin', handle: ({ body, from }) => checkToken(body.token) ? pinMessage(String(body.session || ''), String(body.message || ''), body.on === true, from) : locked },
    { method: 'POST', path: 'fork', handle: ({ body, from }) => checkToken(body.token) ? forkFrom(String(body.session || ''), String(body.message || ''), from) : locked },
    {
      method: 'POST', path: 'new', handle: async ({ body, from }) => {
        if (!checkToken(body.token)) return locked;
        const r = await startNew(String(body.project || ''), String(body.text || ''), from, body.voice === true, settingsFrom(body), photoIdsOf(body));
        usage(true);   // pick up the new session's log straight away
        return r;
      },
    },
    { method: 'POST', path: 'stop', handle: ({ body, from }) => checkToken(body.token) ? stopTurn(String(body.turn), from) : locked },
  ],
  start() {
    const t = Date.now();
    console.log(`claude: indexed ${store.scan()} replies in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    setInterval(() => { try { store.scan(); } catch (e) { console.log('scan error:', e); } }, 15e3);
    startLimits();
    const h = Date.now();   // index every past session in the background (counts only; nothing from the logs is printed)
    refreshHistory().then(() => console.log(`claude: indexed ${historyStats.files} session logs in ${((Date.now() - h) / 1000).toFixed(1)}s`), () => {});
  },
};
export default app;
