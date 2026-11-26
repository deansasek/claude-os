// The mock for the page with no PC hub: under ?device=mock, /api calls that the hub does not answer get the mock's
// reply (mock-api.ts). The page's own files load from the same place as before, so a static build of the page
// (npm run build:page) boots Home with no hub. A real hub answer (any 2xx) always wins, so the mock never hides
// the hub's data. Imported first in main.web.ts, so the wrapper is in place before any app asks for data.
import { answerMock, defineMock, hasMock, isApiPath } from './mock-api.ts';

// The core routes every page calls at start-up. Home needs these; the apps' own routes come with their mocks.
defineMock({
  'GET /api/core/version': () => ({ version: 1 }),      // a fixed version: the page never reloads
  'POST /api/core/log': () => ({ ok: true }),
  'POST /api/core/tap': () => ({ ok: true }),
  'GET /api/settings/welcome': () => ({ done: true }),  // the welcome is not shown again
});

if (/[?&]device=mock\b/.test(location.search)) {
  const real = window.fetch.bind(window);
  const bodyOf = (body: BodyInit | null | undefined): unknown => {
    if (typeof body !== 'string') return null;
    try { return JSON.parse(body) as unknown; } catch { return body; }
  };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, location.href);
    if (!isApiPath(url.pathname)) return real(input, init);
    const method = (init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    let res: Response | null = null;
    try { res = await real(input, init); } catch { res = null; }   // no hub: the request could not connect
    if (res?.ok) return res;
    if (res && !hasMock(method, url.pathname)) return res;         // the hub's own answer, and no mock for it
    const reply = answerMock(method, url.pathname, bodyOf(init?.body), url.search);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
}
