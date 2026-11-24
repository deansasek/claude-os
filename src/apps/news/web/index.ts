// The News app: a top story, one shelf per feed, and a reader sheet for one story. Stories come from /api/news/feed.
// Text is set with textContent, never innerHTML, so a feed's words cannot inject markup.
import { getJson, report } from '../../../core/web/dom.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { critterSvg } from '../../../core/web/critter-svg.ts';
import { browser } from '../../../core/web/device.ts';
import { openApp } from '../../../core/web/system.ts';
import type { NewsFeedResponse, NewsItem } from '../api.ts';
import { manifest } from '../manifest.ts';
import { ago, linkFor, screenFor, type NewsScreen, type Shelf } from './screen.ts';

const REFRESH_MS = 10 * 60e3;    // while the page is on screen
const SHOWN_MS = 5 * 60e3;       // coming back to the page after this long refreshes it

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let loadedAt = 0;
let hasStories = false;                        // the screen currently shows stories
let stories = new Map<string, NewsItem>();     // the stories on the screen, by id, for the reader sheet

const clockTime = (iso: string | null): string =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The top story's picture: the feed's image when it gave one, else a letter block with the source's initial. */
function media(item: NewsItem, cls: string): HTMLElement {
  if (item.image) {
    const img = el('img', cls);
    img.src = item.image;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    return img;
  }
  return el('span', `${cls} nw-letter`, item.source.charAt(0) || 'N');
}

function hero(item: NewsItem): HTMLElement {
  const b = el('button', 'nw-hero');
  b.type = 'button';
  b.dataset.id = item.id;
  const body = el('span', 'nw-hero-body');
  const m = el('span', 'nw-meta');
  m.append(el('span', 'nw-src', item.source));
  const when = ago(item.published, Date.now());
  if (when) m.append(el('span', 'nw-when', when));
  body.append(el('span', 'nw-kicker', 'Top story'), el('span', 'nw-hero-title', item.title), m);
  b.append(media(item, 'nw-hero-media'), body);
  return b;
}

function tile(item: NewsItem): HTMLElement {
  const b = el('button', 'nw-tile');
  b.type = 'button';
  b.dataset.id = item.id;
  b.append(el('span', 'nw-tile-title', item.title), el('span', 'nw-tile-when', ago(item.published, Date.now())));
  return b;
}

function shelf(s: Shelf): HTMLElement {
  const sec = el('section', 'nw-shelf');
  const head = el('div', 'nw-shelf-head');
  head.append(el('h3', '', s.name));
  if (s.stale) {
    // a saved shelf says when its feed was last fetched (the route gives one time for all feeds)
    const t = clockTime(s.when);
    head.append(el('span', 'nw-saved', t ? `Saved, fetched ${t}` : 'Saved stories'));
  }
  const row = el('div', 'nw-row');
  for (const item of s.stories) row.append(tile(item));
  sec.append(head, row);
  return sec;
}

function paintStories(s: Extract<NewsScreen, { state: 'stories' }>): void {
  hasStories = true;
  $('nwEmpty').hidden = true;
  $('nwBody').hidden = false;
  $('nwTime').textContent = s.updated ? `Updated ${clockTime(s.updated)}` : '';
  $('nwNotes').replaceChildren(...s.notes.map(n => el('p', 'nw-note', n.text)));
  $('nwNotes').hidden = !s.notes.length;
  $('nwHead').replaceChildren(hero(s.headline));
  $('nwShelves').replaceChildren(...s.shelves.map(shelf));
  stories = new Map([s.headline, ...s.shelves.flatMap(x => x.stories)].map(i => [i.id, i] as const));
}

function paintError(text: string): void {
  hasStories = false;
  $('nwBody').hidden = true;
  $('nwEmpty').hidden = false;
  $('nwTime').textContent = '';
  $('nwEmptyText').textContent = text;
  $('nwCrit').innerHTML = critterSvg('nw-crit-svg');   // static markup from critter-svg.ts, no feed text
}

async function load(): Promise<void> {
  let res: NewsFeedResponse | null = null;
  try { res = await getJson<NewsFeedResponse>('/api/news/feed'); } catch { res = null; }
  loadedAt = Date.now();
  // a failed request keeps the stories already on screen; only an empty screen shows the error
  if (!res && hasStories) return;
  const s = screenFor(res);
  if (s.state === 'error') paintError(s.text);
  else paintStories(s);
}

// ---------- the reader sheet ----------
function closeSheet(): void { $('nwSheet').hidden = true; }

function openStory(id: string): void {
  const item = stories.get(id);
  if (!item) return;
  const link = linkFor(item);
  $('nwSheetSrc').textContent = item.source;
  $('nwSheetTime').textContent = ago(item.published, Date.now());
  $('nwSheetTitle').textContent = item.title;
  $('nwSheetDesc').textContent = item.description || 'The feed gave no summary for this story.';
  const act = $('nwSheetAct');
  act.replaceChildren();
  $('nwSheetLink').hidden = true;
  // a story without an http or https link gets no Read button
  if (link) {
    const read = el('button', 'nw-read', `Read at ${item.source}`);
    read.type = 'button';
    read.addEventListener('click', () => {
      const sent = browser.openUrl(link);
      report(sent ? 'news-read' : 'news-read-unavailable');
      if (sent) { closeSheet(); openApp('browser'); return; }
      // the Browser app can't take the link here: show it as text so it can be copied
      $('nwSheetLink').textContent = link;
      $('nwSheetLink').hidden = false;
    });
    act.append(read);
  }
  $('nwSheet').hidden = false;
  report('news-story');
}

// ---------- wiring ----------
function mount(context: AppContext): void {
  ctx = context;
  const pick = (e: Event) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-id]');
    if (b) openStory(b.dataset.id!);
  };
  $('nwHead').addEventListener('click', pick);
  $('nwShelves').addEventListener('click', pick);
  $('nwSheet').addEventListener('click', e => {
    if (e.target === $('nwSheet') || (e.target as Element).closest('[data-close]')) closeSheet();
  });
  $('nwRetry').addEventListener('click', () => { report('news-retry'); void load(); });
  void load();
  // every 10 minutes while the page is on screen
  setInterval(() => { if (ctx.isVisible()) void load(); }, REFRESH_MS);
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('news'),
  mount,
  onShow() { if (Date.now() - loadedAt > SHOWN_MS) void load(); },
  onHide() { closeSheet(); },
  onClose() { closeSheet(); },
};
export default app;
