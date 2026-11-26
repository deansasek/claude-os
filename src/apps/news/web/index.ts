// The News app: a top story, one shelf per feed, and a reader sheet for one story. Stories come from /api/news/feed.
// Text is set with textContent, never innerHTML, so a feed's words cannot inject markup.
import { getJson, postJson, report } from '../../../core/web/dom.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { critterSvg } from '../../../core/web/critter-svg.ts';
import { browser, nativeHas, newsFetch } from '../../../core/web/device.ts';
import { openApp } from '../../../core/web/system.ts';
import { appSettingsChanged, registerAppSettings, type SettingRow } from '../../../core/web/app-settings.ts';
import type { NewsFeedResponse, NewsItem, NewsTopicsResponse } from '../api.ts';
import { manifest } from '../manifest.ts';
import { FEEDS } from './feeds.ts';
import { activeFeeds, isOn, type TopicChoices } from './topics.ts';
import { ago, linkFor, pictureFor, POLL_MS, readerFor, screenFor, storiesById, storyKey, type NewsScreen, type Shelf } from './screen.ts';
import { feedSource, tabletFeed, type KeyValue } from './tablet.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let loadedAt = 0;
let hasStories = false;                        // the screen currently shows stories
let stories = new Map<string, NewsItem>();     // the stories on the screen, by id, for the reader sheet
let choices: TopicChoices = {};                // the topics the owner has switched off (web/topics.ts); all on until the PC says otherwise
let topicsDirty = false;                       // a topic changed in Settings: the next time News shows, it reads the feeds again

const clockTime = (iso: string | null): string =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The story's picture: the feed's image only when screen.ts allows it, else a letter block with the source's initial. */
function media(item: NewsItem, cls: string): HTMLElement {
  const pic = pictureFor(item);
  if (pic) {
    const img = el('img', cls);
    img.src = pic;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    return img;
  }
  return el('span', `${cls} nw-letter`, item.source.charAt(0) || 'N');
}

/** The feed's name, credited on the story. With a link, it is a button that opens the original story. */
function sourceCredit(item: NewsItem): HTMLElement {
  if (!linkFor(item)) return el('span', 'nw-src', item.source);
  const b = el('button', 'nw-src nw-src-go', item.source);
  b.type = 'button';
  b.setAttribute('aria-label', `Read the original story at ${item.source}`);
  return b;
}

function hero(item: NewsItem): HTMLElement {
  const b = el('div', 'nw-hero');
  b.dataset.id = storyKey(item);
  const body = el('span', 'nw-hero-body');
  const m = el('span', 'nw-meta');
  m.append(sourceCredit(item));
  const when = ago(item.published, Date.now());
  if (when) m.append(el('span', 'nw-when', when));
  body.append(el('span', 'nw-kicker', 'Top story'), el('span', 'nw-hero-title', item.title), m);
  b.append(media(item, 'nw-hero-media'), body);
  return b;
}

// A tile opens the reader sheet. Its source name opens the original story.
function tile(item: NewsItem): HTMLElement {
  const b = el('div', 'nw-tile');
  b.dataset.id = storyKey(item);
  const top = el('span', 'nw-tile-top');
  top.append(media(item, 'nw-tile-media'), sourceCredit(item));
  b.append(top, el('span', 'nw-tile-title', item.title), el('span', 'nw-tile-when', ago(item.published, Date.now())));
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
  stories = storiesById(s);
}

function paintError(text: string): void {
  hasStories = false;
  $('nwBody').hidden = true;
  $('nwEmpty').hidden = false;
  $('nwTime').textContent = '';
  $('nwEmptyText').textContent = text;
  $('nwCrit').innerHTML = critterSvg('nw-crit-svg');   // static markup from critter-svg.ts, no feed text
}

// The saved stories live in this page's local storage. Storage can be blocked, so every access is guarded.
const savedStore: KeyValue = {
  getItem: key => { try { return localStorage.getItem(key); } catch { return null; } },
  setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* blocked or full: nothing saved */ } },
};

async function load(): Promise<void> {
  topicsDirty = false;
  let res: NewsFeedResponse | null = null;
  try {
    // on the tablet the feeds are read natively (no CORS header on the feeds), for the topics that are on;
    // otherwise the PC route answers with the topics that are on
    if (feedSource(nativeHas('newsFetch')) === 'tablet') {
      await loadTopics();
      res = tabletFeed(newsFetch, savedStore, Date.now(), activeFeeds(FEEDS, choices));
    } else {
      res = await getJson<NewsFeedResponse>('/api/news/feed');
    }
  } catch { res = null; }
  loadedAt = Date.now();
  // a failed request keeps the stories already on screen; only an empty screen shows the error
  if (!res && hasStories) return;
  const s = screenFor(res);
  if (s.state === 'error') paintError(s.text);
  else paintStories(s);
}

// ---------- opening the original story ----------
function closeSheet(): void { $('nwSheet').hidden = true; }

function showLink(link: string): void {
  $('nwSheetLink').textContent = link;
  $('nwSheetLink').hidden = false;
}

/** Sends the link to the Browser app. Returns false when the Browser app cannot take it here. */
function openLink(link: string): boolean {
  const sent = browser.openUrl(link);
  report(sent ? 'news-read' : 'news-read-unavailable');
  if (sent) { closeSheet(); openApp('browser'); }
  return sent;
}

/** A source name tap: open the original story, or show the reader with the link as text when the Browser app cannot take it. */
function openOriginal(id: string): void {
  const item = stories.get(id);
  const link = item ? linkFor(item) : null;
  if (!link || openLink(link)) return;
  openStory(id);
  showLink(link);
}

// ---------- the reader sheet ----------
function openStory(id: string): void {
  const item = stories.get(id);
  if (!item) return;
  const r = readerFor(item, Date.now());
  $('nwSheetSrc').textContent = r.source;
  $('nwSheetTime').textContent = r.when;
  $('nwSheetTitle').textContent = item.title;
  $('nwSheetDesc').textContent = r.description;
  const act = $('nwSheetAct');
  act.replaceChildren();
  $('nwSheetLink').hidden = true;
  // a story without an http or https link gets no Read button
  if (r.link) {
    const link = r.link;
    const read = el('button', 'nw-read', `Read at ${item.source}`);
    read.type = 'button';
    read.addEventListener('click', () => { if (!openLink(link)) showLink(link); });
    act.append(read);
  }
  $('nwSheet').hidden = false;
  report('news-story');
}

// ---------- topics: Settings > Apps > News ----------
/** Reads which topics are on from the PC. A failed read keeps the choices already known. */
async function loadTopics(): Promise<void> {
  try {
    const r = await getJson<NewsTopicsResponse>('/api/news/topics');
    choices = Object.fromEntries(r.topics.map(t => [t.id, t.on]));
    appSettingsChanged();
  } catch { /* keep the choices already known */ }
}

/** Saves one topic on or off on the PC. Throws when the PC does not save it, so Settings shows the error. */
async function saveTopic(id: string, on: boolean): Promise<void> {
  const r = await postJson<{ ok: boolean }>('/api/news/topics', { id, on });
  if (!r.ok) throw new Error('ClaudeOS could not save that topic. Check the computer is connected, then try again.');
  choices[id] = on;
  topicsDirty = true;
  appSettingsChanged();
}

/** Settings → Apps → News: one switch per topic. Every topic starts on. */
function registerSettings(): void {
  registerAppSettings({
    app: manifest.id, name: manifest.name, icon: appIcon('news'), blurb: 'Which news topics the screen shows',
    rows: (): SettingRow[] => FEEDS.map((f): SettingRow => ({
      kind: 'switch', id: `topic-${f.id}`, title: f.name, detail: 'Shows its shelf on News.',
      get: () => isOn(choices, f.id),
      set: v => saveTopic(f.id, v),
    })),
  });
}

// ---------- wiring ----------
function mount(context: AppContext): void {
  ctx = context;
  registerSettings();
  void loadTopics();
  const pick = (e: Event) => {
    const t = e.target as Element;
    const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;
    if (t.closest('.nw-src-go')) openOriginal(id);
    else openStory(id);
  };
  $('nwHead').addEventListener('click', pick);
  $('nwShelves').addEventListener('click', pick);
  $('nwSheet').addEventListener('click', e => {
    if (e.target === $('nwSheet') || (e.target as Element).closest('[data-close]')) closeSheet();
  });
  $('nwRetry').addEventListener('click', () => { report('news-retry'); void load(); });
  void load();
}

// The feed is asked for at most every POLL_MS, and only while News is on screen: the timer starts on show and stops on hide.
let pollTimer = 0;
function startPolling(): void {
  if (!pollTimer) pollTimer = window.setInterval(() => void load(), POLL_MS);
}
function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = 0;
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('news'),
  mount,
  onShow() {
    startPolling();
    if (topicsDirty || Date.now() - loadedAt >= POLL_MS) void load();
  },
  onHide() { stopPolling(); closeSheet(); },
  onClose() { stopPolling(); closeSheet(); },
};
export default app;
