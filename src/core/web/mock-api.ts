// The mock layer for the page with no PC hub (the static build, or ?device=mock on a plain file server). An app
// describes the /api routes it answers with defineMock; answerMock finds the reply for one request. A route with
// no mock answers 404, which the app already reads as "not there" (the PIN, the welcome, the profile).
// Pure: no window or fetch here, so the test can run it in Node. mock.ts wires it to fetch.

/** What a mock route returns: a plain object (sent as JSON, status 200), or { status, body } for another status. */
export interface MockReply { status: number; body: unknown }

/** One route's answer. `body` is the request body as parsed JSON (or null). */
export type MockHandler = (req: { path: string; body: unknown; query: URLSearchParams }) => unknown;

/** A table of routes, keyed by "METHOD /api/<id>/<path>" (for example "GET /api/core/version"). */
export type MockTable = Record<string, MockHandler>;

const tables: MockTable[] = [];

/** Register an app's mock routes. Returns the table, so the app can keep a typed reference to it. */
export function defineMock<T extends MockTable>(table: T): T {
  tables.push(table);
  return table;
}

/** The reply for one request. `path` is the URL path without the query string; `search` is the query string, with or without its ?. */
export function answerMock(method: string, path: string, body: unknown = null, search = ''): MockReply {
  const key = `${method.toUpperCase()} ${path}`;
  for (const t of tables) {
    const h = t[key];
    if (!h) continue;
    const out = h({ path, body, query: new URLSearchParams(search) });
    if (out && typeof out === 'object' && 'status' in out && 'body' in out) return out as MockReply;
    return { status: 200, body: out };
  }
  return { status: 404, body: { ok: false, error: 'no mock for ' + key } };
}

/** Is there a mock route for this request? */
export function hasMock(method: string, path: string): boolean {
  const key = `${method.toUpperCase()} ${path}`;
  return tables.some(t => key in t);
}

/** Does this URL belong to the API (so the mock answers it)? */
export const isApiPath = (url: string): boolean => url.startsWith('/api/');
