// The Browser app's state: tabs, history, bookmarks, downloads, site permissions, quick links, the search engine.
// Everything saved lives in the page's store (localStorage) except the pages themselves, which are native WebViews
// on the tablet (see BrowserView.java). The shared `S` object is what index.ts and panels.ts both read and change.
//
// Saved: browser.tabs (tabs + active), browser.history (last 1000), browser.bookmarks, browser.downloads (last 100),
// browser.perms (per site: camera, microphone, location), browser.quick, browser.engine.
import { store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';

/** A tab: its page's address ('' for the new-tab page). `past` holds the pages Home left behind, for Back (newest last). */
export interface Tab { id: string; url: string; title: string; icon: string; priv?: boolean; desk?: boolean; past?: string[] }
export const MAX_PAST = 10;
export interface Visit { url: string; title: string; at: number }
export interface Bookmark { url: string; title: string; at: number }
export interface Quick { title: string; url: string }
export type Engine = 'duckduckgo' | 'google' | 'bing';
export type PermKind = 'camera' | 'microphone' | 'geolocation';
export const PERM_KINDS: PermKind[] = ['camera', 'microphone', 'geolocation'];
export const PERM_LABEL: Record<PermKind, string> = { camera: 'Camera', microphone: 'Microphone', geolocation: 'Location' };
/** One download: id is the DownloadManager id (0 for a picture saved through MediaStore); uri opens and shares it. */
export interface Dl { id: number; uri: string; name: string; mime: string; bytes: number; total: number; state: 'running' | 'done' | 'failed' | 'gone'; at: number; message?: string }
export type Perms = Record<string, Partial<Record<PermKind, 'allow' | 'deny'>>>;

export const ENGINES: Record<Engine, { label: string; q: string }> = {
  duckduckgo: { label: 'DuckDuckGo', q: 'https://duckduckgo.com/?q=' },
  google: { label: 'Google', q: 'https://www.google.com/search?q=' },
  bing: { label: 'Bing', q: 'https://www.bing.com/search?q=' },
};
export const DEFAULT_QUICK: Quick[] = [
  { title: 'Claude', url: 'https://claude.ai' },
  { title: 'Anthropic', url: 'https://www.anthropic.com' },
  { title: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { title: 'BBC Weather', url: 'https://www.bbc.co.uk/weather' },
];
export const K = {
  tabs: 'browser.tabs', history: 'browser.history', quick: 'browser.quick', engine: 'browser.engine', header: 'browser.header',
  bookmarks: 'browser.bookmarks', downloads: 'browser.downloads', perms: 'browser.perms',
};
const MAX_HISTORY = 1000;
export const MAX_TABS = 8, MAX_QUICK = 12, MAX_DL = 100, MAX_BOOK = 300;

/** Live state of each tab's page (not saved). */
export interface Live {
  progress: number; loading: boolean; back: boolean; fwd: boolean;
  error: { title: string; body: string; retry: boolean } | null;   // retry: a second try may work (not for a refused site)
  find: { q: string; count: number; index: number };
  zoom: number;          // percent, 100 = fitted
  thumb: string;         // a small picture of the page, for the tab overview
}

export const S = {
  tabs: [] as Tab[],
  active: '',
  history: [] as Visit[],
  bookmarks: [] as Bookmark[],
  downloads: [] as Dl[],
  quick: [] as Quick[],
  perms: {} as Perms,
  engine: 'duckduckgo' as Engine,
  live: new Map<string, Live>(),
};

export function readJson<T>(k: string, fb: T): T {
  try { const v = JSON.parse(store.get(k) || 'null') as T | null; return v ?? fb; } catch { return fb; }
}
export function save(k: string, v: unknown): void { store.set(k, JSON.stringify(v)); }

export const newId = (): string => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function liveOf(id: string): Live {
  let l = S.live.get(id);
  if (!l) {
    l = { progress: 0, loading: false, back: false, fwd: false, error: null, find: { q: '', count: 0, index: 0 }, zoom: 100, thumb: '' };
    S.live.set(id, l);
  }
  return l;
}

export const cur = (): Tab => S.tabs.find(t => t.id === S.active) || S.tabs[0];

/** Claude's browser_open and browser_back (claude/web/browser-relay.ts), run by the Browser app's own functions
 *  (index.ts provides them when it mounts). Each answers with a plain sentence. */
export interface BrowserControl {
  open(text: string): Promise<{ ok: boolean; data: string }>;
  back(): Promise<{ ok: boolean; data: string }>;
}
let control: BrowserControl | null = null;
export function provideControl(c: BrowserControl): void { control = c; }
export const getControl = (): BrowserControl | null => control;

export function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/** Top-level domains that make "word.word" an address; anything else with a dot ("node.js", "file.pdf") searches. */
const TLDS = new Set(['com', 'org', 'net', 'io', 'dev', 'app', 'ai', 'co', 'uk', 'us', 'ca', 'de', 'edu', 'gov', 'me', 'tv', 'gg', 'xyz', 'info']);
/** The home network and this tablet: localhost, *.local, *.lan, *.home, home.arpa, 127.x, 169.254.x, 10.x, 192.168.x, 172.16-31.x. */
const LOCAL_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|([a-z0-9-]+\.)+(local|lan|home|home\.arpa))$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOTTED = /^([a-z0-9-]+\.)+([a-z]{2,})$/;

/** What the address bar's text means: `url` is the page to open (a search when `search` is true). `alt` is set when
 *  it is unclear, so the suggestions can offer "Go to …" as well as the search. */
export interface Reading { url: string; search: boolean; alt?: string }

/** Local and public addresses: an explicit http:// or https:// is kept as typed. Local hosts try http, public ones https.
 *  A dotted word counts as an address with a known TLD, a port or a path; otherwise it searches. */
/** Quick-search shortcuts: the prefix typed before a search. */
const SHORTCUTS: Record<string, string> = {
  w: 'https://en.wikipedia.org/w/index.php?search=',
  yt: 'https://www.youtube.com/results?search_query=',
  maps: 'https://www.google.com/maps/search/',
  gh: 'https://github.com/search?q=',
  r: 'https://www.reddit.com/search/?q=',
  am: 'https://www.amazon.com/s?k=',
};

export function reading(text: string, eng: Engine = S.engine): Reading {
  const t = text.trim();
  if (!t) return { url: '', search: false };
  if (/^https?:\/\//i.test(t)) return { url: t, search: false };
  // quick-search shortcuts: "w cats" searches Wikipedia, "yt lofi" YouTube, and so on (a shortcut, then a space, then the search)
  const sc = /^(\S+)\s+(.+)$/.exec(t);
  const site = sc ? SHORTCUTS[sc[1].toLowerCase()] : undefined;
  if (sc && site) return { url: site + encodeURIComponent(sc[2].trim()), search: true };
  const search: Reading = { url: ENGINES[eng].q + encodeURIComponent(t), search: true };
  if (/\s/.test(t)) return search;
  const m = /^([^/?#:]+)(:\d+)?([/?#]\S*)?$/.exec(t);
  if (!m) return search;
  const h = m[1].toLowerCase();
  if (LOCAL_HOST.test(h)) return { url: 'http://' + t, search: false };
  if (IPV4.test(h)) return { url: 'https://' + t, search: false };
  if (!DOTTED.test(h)) return search;
  if (TLDS.has(h.slice(h.lastIndexOf('.') + 1)) || m[2] || m[3]) return { url: 'https://' + t, search: false };
  return { ...search, alt: 'https://' + t };
}

/** What you typed → a URL: an address (https:// added, http:// for local hosts), anything else a search. */
export function resolveInput(text: string, eng: Engine = S.engine): string {
  return reading(text, eng).url;
}

export function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** A day heading for lists: Today, Yesterday, or a date. */
export function dayOf(at: number): string {
  const d = new Date(at), n = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, n)) return 'Today';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function size(bytes: number): string {
  if (!bytes || bytes < 1) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function saveTabs(): void { save(K.tabs, { tabs: S.tabs, active: S.active }); }
export function saveHistory(): void { save(K.history, S.history); }
export function saveBookmarks(): void { save(K.bookmarks, S.bookmarks); }
export function saveDownloads(): void { save(K.downloads, S.downloads); }
export function savePerms(): void { save(K.perms, S.perms); }
export function saveQuick(): void { save(K.quick, S.quick); }

/** Records a visit (not for private tabs; the caller checks). Same page twice in a row updates it. */
export function visit(url: string, title: string): void {
  if (!/^https?:/.test(url)) return;
  if (S.history[0] && S.history[0].url === url) { if (title) S.history[0].title = title; S.history[0].at = Date.now(); }
  else S.history.unshift({ url, title, at: Date.now() });
  S.history = S.history.slice(0, MAX_HISTORY);
  saveHistory();
}

export function isBookmarked(url: string): boolean { return S.bookmarks.some(b => b.url === url); }

export function dlByKey(id: number, uri: string): Dl | undefined {
  return S.downloads.find(d => (id > 0 && d.id === id) || (!!uri && d.uri === uri));
}

// ---------- icons (24-unit, stroke) ----------
const svg = (body: string, sw = 1.7) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const I = {
  app: appIcon('browser'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  mask: svg('<path d="M4 9.5c0-1.7 1.3-3 3-3h10c1.7 0 3 1.3 3 3V15a4 4 0 0 1-4 4h-1.3l-1.9-2.2h-1.6L10.3 19H8a4 4 0 0 1-4-4z"/><circle cx="8.8" cy="12.6" r=".8"/><circle cx="15.2" cy="12.6" r=".8"/>'),
  star: svg('<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z"/>'),
  find: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  reader: svg('<path d="M5 5.5h6a3 3 0 0 1 3 3V19a2 2 0 0 0-2-2H5z"/><path d="M19 5.5h-6"/><path d="M19 5.5V17h-6"/>'),
  share: svg('<path d="M12 4v11M8 8l4-4 4 4"/><path d="M6 12v6.5h12V12"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  desktop: svg('<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>'),
  zoomIn: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>'),
  bookmark: svg('<path d="M7 4.5h10v15l-5-3.4-5 3.4z"/>'),
  history: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
  download: svg('<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19.5h14"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  file: svg('<path d="M7 3.5h7l4.5 4.5V20a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4.5"/>'),
  camera: svg('<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3V19H4z"/><circle cx="12" cy="13.2" r="3.2"/>'),
  photo: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l4.5-4 3.5 3 2.5-2 4.5 4"/>'),
  mic: svg('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>'),
  pin: svg('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  open: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-2.6 2.8-3.8 5.5-3.8 8.5s1.2 5.7 3.8 8.5M12 3.5c2.6 2.8 3.8 5.5 3.8 8.5s-1.2 5.7-3.8 8.5"/>'),
  sheet: svg('<path d="M4 6.5h16M4 12h16M4 17.5h10"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>'),
  lock: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.2" width="8" height="5.8" rx="1.4"/><path d="M4.8 6.2V4.6a2.2 2.2 0 0 1 4.4 0v1.6"/></svg>',
  globeSm: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-1.8 1.7-2.7 3.7-2.7 6s.9 4.3 2.7 6M8 2c1.8 1.7 2.7 3.7 2.7 6s-.9 4.3-2.7 6"/></svg>',
  xSm: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  clockSm: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg>',
  searchSm: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.5 3.5"/></svg>',
  reload: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 10a5.5 5.5 0 1 1-1.8-4.1"/><path d="M14.5 3v3.5H11"/></svg>',
  stop: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>',
};
