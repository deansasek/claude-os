// Claude in the mock page (no hub): the app opens with no sessions, no projects and no usage, and it cannot reach
// Claude. Every change answers "not_connected", so the page shows that nothing was sent. Reading the screens works;
// chatting does not. Chat in the mock needs its own design, so it is left for a later change. The shapes are the
// ones in ../api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { History, Usage, ModelList, Project, SessionView } from '../api.ts';

const NOT = { ok: false, error: 'not_connected' } as const;

const usage = (): Usage => ({
  now: new Date().toISOString(),
  plan: null,
  limits: { status: 'no_token', error: null, updated: null, source: null, limits: {}, list: [], breakdown: [] },
  today: { input: 0, output: 0, cache_read: 0, cache_write: 0, messages: 0, total: 0 },
  models: [],
  projects: [],
  block: null,
  peak_block: 0,
  burn_per_min: 0,
  hourly: new Array(24).fill(0),
  hourly_start: new Date().toISOString(),
  active_sessions: 0,
  sessions: [],
  turns: [],
  last_activity: null,
});

const models: ModelList = { models: [], source: 'fallback', defaultId: null };
const projects: Project[] = [];
const history = (q: string): History => ({ q, total: 0, groups: [], archived: 0 });
const session = (): SessionView => ({
  session: null, transcript: [], lastText: null, canReply: false, reason: 'not_found', turn: null,
});

defineMock({
  'GET /api/claude/usage': (): Usage => usage(),
  'GET /api/claude/models': (): ModelList => models,
  'GET /api/claude/projects': (): Project[] => projects,
  'GET /api/claude/history': ({ query }): History => history(query.get('q') ?? ''),
  'GET /api/claude/session': (): SessionView => session(),
  'GET /api/claude/image': () => ({ status: 404, body: { ok: false, error: 'No pictures in the mock page.' } }),
  'POST /api/claude/unlock': () => NOT,
  'POST /api/claude/reply': () => NOT,
  'POST /api/claude/new': () => NOT,
  'POST /api/claude/stop': () => NOT,
  'POST /api/claude/approve': () => NOT,
  'POST /api/claude/archive': () => NOT,
  'POST /api/claude/delete': () => NOT,
  'POST /api/claude/pin': () => NOT,
  'POST /api/claude/fork': () => NOT,
  'POST /api/claude/browser/next': () => NOT,
  'POST /api/claude/browser/result': () => NOT,
  'POST /api/claude/pc/wait': () => NOT,
  'POST /api/claude/pc/permission': () => NOT,
});
