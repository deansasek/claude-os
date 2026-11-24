// The Radio app: internet radio from Radio Browser, as a media player. Favourites and recently played sit in a row
// on the left. The player bar along the bottom has the station, a title line, play/pause, previous and next through
// Favourites, a sleep timer, the volume and a way to the station page. Stop sits on the station page. The catalogue (right) searches with filters and browses Top stations,
// Genres, Countries and Languages (through the hub, /api/radio/stations and /api/radio/catalogue); a station card opens
// the station's own page. Favourites, recently played and the volume are kept on this tablet (the store helper).
// Only https streams play. One audio element plays everything. The station on the air shows under the rail icon,
// and it keeps playing when the app closes.
import { esc, getJson, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { device, onVolume } from '../../../core/web/device.ts';
import { quietVolumeHud } from '../../../core/web/system.ts';
import { setMediaActions, setNowPlaying } from '../../../core/web/media.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import type { Facet, FacetsResult, Station, StationsResult, TitleResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { BITRATES, CODECS, type FacetKind, NO_FILTERS, type SearchFilters, addRecent, addSearch, browsePick, nextChoice } from './catalogue.ts';
import {
  type PlayState, SLEEP_CHOICES, barModel, failMessage, initial, sleepEnd, sleepLeft, stationHue, stepFavourite, titleLine, volumeFrom,
  volumeFromDevice,
} from './player.ts';
import { httpsUrl, playable, playableStations } from './stations.ts';
import { FAV_EMPTY, TOP_COUNT, homeShelves, moreLikeThis, tileHue, topFacets, type Load, type ShelfId, type ShelfPlan } from './shelves.ts';
import { CHIPS, LANDING_ORDER, MADE_COUNT, chipShows, describe, greeting, madeForYou, type Chip } from './landing.ts';

const API = `/api/${manifest.id}`;
const FAVS_KEY = 'radio.favs';
const RECENT_KEY = 'radio.recent';
const SEARCHES_KEY = 'radio.searches';
const ICON = appIcon('radio');
const FAILED = failMessage(undefined);
const NO_DIRECTORY = 'No connection to the radio directory.';
const RADIO_DOWN = 'Radio Browser is not available. Try again.';
const FACET_NAMES: Record<FacetKind, string> = { tags: 'Genres', countries: 'Countries', languages: 'Languages' };
const BY: Record<FacetKind, string> = { tags: 'bytag', countries: 'bycountry', languages: 'bylanguage' };

const svg = (body: string, fill = false) => `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = {
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>', true),
  pause: svg('<rect x="6.5" y="5.5" width="3.6" height="13" rx="1"/><rect x="13.9" y="5.5" width="3.6" height="13" rx="1"/>', true),
  prev: svg('<path d="M6.5 6v12"/><path d="M18 6.5v11L9.5 12z" fill="currentColor"/>'),
  next: svg('<path d="M17.5 6v12"/><path d="M6 6.5v11L14.5 12z" fill="currentColor"/>'),
  vol: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.8a7.4 7.4 0 0 1 0 10.4"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>'),
  up: svg('<path d="M6 14.5l6-6 6 6"/>'),
  down: svg('<path d="M6 9.5l6 6 6-6"/>'),
  heart: (on: boolean) => svg('<path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z"/>', on),
};

/** What the catalogue shows. A station page remembers the view to go back to. */
type View =
  | { kind: 'home' }
  | { kind: 'top' }
  | { kind: 'facets'; facet: FacetKind; pick?: boolean }   // pick: choose the search's country filter
  | { kind: 'browse'; facet: FacetKind; name: string }
  | { kind: 'search' }
  | { kind: 'station'; station: Station; back: View };

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let favs: Station[] = loadList(FAVS_KEY);
let recent: Station[] = loadList(RECENT_KEY);
let view: View = { kind: 'home' };
interface Home { top: Station[]; topState: Load; genres: Facet[]; genresState: Load; countries: Facet[]; countriesState: Load }
let home: Home = { top: [], topState: 'loading', genres: [], genresState: 'loading', countries: [], countriesState: 'loading' };
let chip: Chip = 'all';                  // the landing's filter chip
let homeDone = false;                   // the shelves were asked for; a failed shelf is asked again on the next show
let list: Station[] = [];                // the stations the catalogue shows now
let facets: Facet[] = [];                // the genres, countries or languages it shows now
let listState: 'idle' | 'loading' | 'ok' | 'error' = 'idle';
let listError = '';
let listKey = '';                        // what list and facets hold, so a view loads only once
let query = '';
let filters: SearchFilters = { ...NO_FILTERS };
let countryName = '';                    // the country filter's name, for its chip
let current: Station | null = null;      // the station in the card; it stays after Stop so Play starts it again
let state: PlayState = 'off';
let message = '';                        // a short line in the card: why a station did not play
let streamTitle = '';                    // what the stream says is on (ICY metadata), while it plays
let volume = volumeFrom(null);           // the device media volume; set from the tablet on mount and by onVolume
let sleepAt: number | null = null;       // when the sleep timer stops the radio
let sleepMin = 0;                        // the sleep choice last made
let audio: HTMLAudioElement | null = null;
let seq = 0;                             // the latest catalogue load wins
let playSeq = 0;                         // the latest play wins
let titleTimer = 0;
const facetCache = new Map<FacetKind, Facet[]>();

// Browse all (Search with no query and no filter): the genres, countries and languages, the eight largest of each.
type Browse = Record<FacetKind, Facet[]>;
let browse: Browse | 'loading' | 'error' = 'loading';
let searches: string[] = loadSearches();   // the recent searches, newest first, at most six

function loadSearches(): string[] {
  try {
    const list = JSON.parse(store.get(SEARCHES_KEY) || '[]');
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

// Now playing: a view over the main view and the bar, below the header row. It is hidden until the bar opens it.
let nowOpen = false;
function openNow(): void { nowOpen = true; $('rdNp').hidden = false; render(); }
function closeNow(): void { if (!nowOpen) return; nowOpen = false; $('rdNp').hidden = true; }

// More like this: the stations of a station's first genre, asked once per genre.
const byTag = new Map<string, Station[] | 'loading' | 'error'>();

function ensureMoreLike(tag: string): void {
  if (byTag.has(tag)) return;
  byTag.set(tag, 'loading');
  getJson<StationsResult>(`${API}/catalogue?path=${encodeURIComponent(`stations/bytag/${tag}`)}`)
    .then(r => { if (r.status !== 'ok') throw new Error(r.error); byTag.set(tag, playableStations(r.stations)); })
    .catch(() => { byTag.set(tag, 'error'); })
    .finally(() => { if (view.kind === 'station') render(); });
}

function moreStation(id: string): Station | undefined {
  for (const v of byTag.values()) {
    if (Array.isArray(v)) { const hit = v.find(s => s.id === id); if (hit) return hit; }
  }
  return undefined;
}

/** The More like this shelf for a station: its first genre's stations, without the station. Hidden on error or when empty. */
function moreHtml(s: Station): string {
  const tag = s.tags?.[0];
  if (!tag) return '';
  ensureMoreLike(tag);
  const got = byTag.get(tag);
  if (got === 'error') return '';
  if (got === undefined || got === 'loading') {
    return `<section class="rd-shelf rd-more"><div class="rd-shelf-head"><h3>More like this</h3></div><div class="rd-row">${'<div class="rd-sk"></div>'.repeat(6)}</div></section>`;
  }
  const more = moreLikeThis(got, s.id);
  if (!more.length) return '';
  return `<section class="rd-shelf rd-more"><div class="rd-shelf-head"><h3>More like this</h3></div><div class="rd-row">${more.map(stationCard).join('')}</div></section>`;
}

function loadList(key: string): Station[] {
  try {
    const list = JSON.parse(store.get(key) || '[]');
    return Array.isArray(list) ? playable(list as Station[]) : [];
  } catch {
    return [];
  }
}

function saveFavs(): void { store.set(FAVS_KEY, JSON.stringify(favs)); syncMedia(); }

// The drawer's media card: the station on the air, its state line, and the buttons. Stop is always offered while a station plays.
// Next and previous need two favourites (one would replay the same station), so the card offers skip only then.
let mediaKey = '';   // the last card sent, so the drawer repaints only when it changes
function syncMedia(): void {
  const m = barModel(current, state, streamTitle, favs);
  const info = m.live ? { title: m.title, subtitle: m.subtitle, art: m.art, playing: m.playing, buffering: m.buffering } : null;
  const key = JSON.stringify([info, m.canStep]);
  if (key === mediaKey) return;
  mediaKey = key;
  setNowPlaying(info);
  setMediaActions(info ? { toggle, stop, ...(m.canStep ? { next: () => step(1), prev: () => step(-1) } : {}) } : null);
}
const isFav = (id: string): boolean => favs.some(f => f.id === id);

function find(id: string): Station | undefined {
  const page = view.kind === 'station' && view.station.id === id ? view.station : undefined;
  return favs.find(s => s.id === id) ?? recent.find(s => s.id === id) ?? list.find(s => s.id === id) ?? home.top.find(s => s.id === id)
    ?? page ?? (current?.id === id ? current : undefined) ?? moreStation(id);
}

function setState(next: PlayState): void {
  state = next;
  syncMedia();
  if (state === 'off') { streamTitle = ''; clearSleep(); }
  syncTitlePoll();
  render();
}

function fail(text: string): void {
  if (audio) release(audio);
  message = text;
  setState('off');
}

function release(a: HTMLAudioElement): void {
  a.pause();
  a.removeAttribute('src');
  a.load();
}

function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';
  a.addEventListener('waiting', () => { if (state === 'playing') setState('buffering'); });
  a.addEventListener('playing', () => { if (state !== 'off' && state !== 'paused') setState('playing'); });
  a.addEventListener('error', () => { if (state !== 'off') fail(failMessage(a.error?.code)); });
  audio = a;
  return a;
}

function play(s: Station): void {
  const url = httpsUrl(s.url);
  current = { ...s, url: url ?? s.url };
  streamTitle = '';
  if (!url) { fail('This station has no https stream, so it will not play.'); return; }
  recent = addRecent(recent, current);
  store.set(RECENT_KEY, JSON.stringify(recent));
  const a = getAudio();
  const mine = ++playSeq;
  a.src = url;
  message = '';
  setState('buffering');
  a.play().catch(() => { if (mine === playSeq && state !== 'off') fail(failMessage(a.error?.code)); });
}

function toggle(): void {
  if (state === 'playing' || state === 'buffering') {
    audio?.pause();
    setState('paused');
    return;
  }
  if (state === 'paused' && audio && current) {
    const mine = ++playSeq;
    setState('buffering');
    audio.play().then(() => { if (mine === playSeq && state === 'buffering') setState('playing'); })
      .catch(() => { if (mine === playSeq && state !== 'off') fail(FAILED); });
    return;
  }
  const s = current ?? favs[0] ?? list[0];
  if (s) play(s);
}

function step(dir: 1 | -1): void {
  const s = stepFavourite(favs, current?.id ?? null, dir);
  if (s) play(s);
}

function stop(): void {
  ++playSeq;
  if (audio) release(audio);   // Stop lets go of the stream; Pause keeps it
  message = '';
  setState('off');
}

// The slider drives the device media volume. The stream plays at full level (audio.volume stays 1).
function setVolume(v: number): void {
  volume = volumeFrom(v);
  quietVolumeHud();   // the radio slider shows the level, so the system volume HUD stays down
  try { device.setVolume('media', volume / 100); } catch { /* not on the tablet: the slider only shows the value */ }
  renderVolume();
}

// ---- the sleep timer: 15, 30 or 60 minutes, then Stop ----

function cycleSleep(): void {
  sleepMin = nextChoice<number>(SLEEP_CHOICES, sleepAt ? sleepMin : 0);
  sleepAt = sleepEnd(Date.now(), sleepMin);
  if (!sleepAt) sleepMin = 0;
  render();
}

function clearSleep(): void { sleepAt = null; sleepMin = 0; }

function tickSleep(): void {
  if (!sleepAt) return;
  if (Date.now() >= sleepAt) {
    stop();
    message = 'The sleep timer stopped the radio.';
    render();
  } else renderSleep();
}

// ---- the stream title: asked of the hub every 20 s while a station plays ----

function syncTitlePoll(): void {
  const want = state === 'playing' && !!current;
  if (want && !titleTimer) {
    void fetchTitle();
    titleTimer = window.setInterval(() => { void fetchTitle(); }, 20e3);
  } else if (!want && titleTimer) {
    clearInterval(titleTimer);
    titleTimer = 0;
  }
}

async function fetchTitle(): Promise<void> {
  const s = current;
  if (!s) return;
  try {
    const r = await getJson<TitleResult>(`${API}/title?url=${encodeURIComponent(s.url)}`);
    if (current?.id !== s.id || state === 'off') return;
    if ((r.title || '') !== streamTitle) { streamTitle = r.title || ''; syncMedia(); render(); }
  } catch { /* no title; the card says "Live radio" */ }
}

// ---- the catalogue ----

function viewKey(v: View): string {
  if (v.kind === 'home') return 'home';
  if (v.kind === 'top') return 'top';
  if (v.kind === 'facets') return `facets:${v.facet}`;
  if (v.kind === 'browse') return `browse:${v.facet}:${v.name}`;
  if (v.kind === 'search') return `search:${query}:${filters.country}:${filters.codec}:${filters.bitrate}`;
  return listKey;   // a station page keeps the list under it
}

function go(v: View): void {
  view = v;
  render();
  void load();
}

async function load(force = false): Promise<void> {
  if (view.kind === 'home') { await loadHome(force); return; }
  if (view.kind === 'search' && !isFiltering()) { await loadBrowse(); return; }
  const key = viewKey(view);
  if (view.kind === 'station' || (!force && key === listKey && listState === 'ok')) return;
  const mine = ++seq;
  listKey = key;
  listState = 'loading';
  render();
  try {
    if (view.kind === 'facets') {
      const facet = view.facet;
      let got = facetCache.get(facet);
      if (!got) {
        const r = await getJson<FacetsResult>(`${API}/catalogue?path=${facet}`);
        if (mine !== seq) return;
        if (r.status !== 'ok') throw new Error(r.error);
        got = r.facets;
        facetCache.set(facet, got);
      }
      facets = got;
    } else {
      let url: string;
      if (view.kind === 'top') url = `${API}/catalogue?path=${encodeURIComponent('stations/topvote/100')}`;
      else if (view.kind === 'browse') url = `${API}/catalogue?path=${encodeURIComponent(`stations/${BY[view.facet]}/${view.name}`)}`;
      else url = `${API}/stations?${new URLSearchParams({ q: query, country: filters.country, codec: filters.codec, bitrate: String(filters.bitrate) })}`;
      const r = await getJson<StationsResult>(url);
      if (mine !== seq) return;
      if (r.status !== 'ok') throw new Error(r.error);
      list = playableStations(r.stations);
    }
    listState = 'ok';
  } catch (e) {
    if (mine !== seq) return;
    list = [];
    facets = [];
    listState = 'error';
    listError = e instanceof TypeError || e instanceof SyntaxError ? NO_DIRECTORY : String((e as Error).message || NO_DIRECTORY);
  }
  render();
}

async function facetsOf(facet: FacetKind): Promise<Facet[]> {
  const got = facetCache.get(facet);
  if (got) return got;
  const r = await getJson<FacetsResult>(`${API}/catalogue?path=${facet}`);
  if (r.status !== 'ok') throw new Error(r.error);
  facetCache.set(facet, r.facets);
  return r.facets;
}

// The Home shelves: the top stations, the genres and the countries. Asked once; a failed shelf is asked again on the next show.
async function loadHome(force = false): Promise<void> {
  if (homeDone && !force) { render(); return; }
  homeDone = true;
  home = { ...home, topState: 'loading', genresState: 'loading', countriesState: 'loading' };
  render();
  const top = getJson<StationsResult>(`${API}/catalogue?path=${encodeURIComponent('stations/topvote/100')}`)
    .then(r => { if (r.status !== 'ok') throw new Error(r.error); return playableStations(r.stations); });
  const [t, g, c] = await Promise.allSettled([top, facetsOf('tags'), facetsOf('countries')]);
  home = {
    top: t.status === 'fulfilled' ? t.value : [], topState: t.status === 'fulfilled' ? 'ok' : 'error',
    genres: g.status === 'fulfilled' ? g.value : [], genresState: g.status === 'fulfilled' ? 'ok' : 'error',
    countries: c.status === 'fulfilled' ? c.value : [], countriesState: c.status === 'fulfilled' ? 'ok' : 'error',
  };
  render();
}

const isFiltering = (): boolean => !!(query || filters.country || filters.codec || filters.bitrate);

async function loadBrowse(): Promise<void> {
  if (browse !== 'loading' && browse !== 'error') { render(); return; }
  const [t, c, l] = await Promise.allSettled([facetsOf('tags'), facetsOf('countries'), facetsOf('languages')]);
  browse = t.status === 'fulfilled' && c.status === 'fulfilled' && l.status === 'fulfilled'
    ? { tags: t.value, countries: c.value, languages: l.value } : 'error';
  render();
}

// A query (or a filter) is remembered as a recent search; the Search view then shows results, or Browse all when empty.
function search(q: string): void {
  query = q.trim().slice(0, 60);
  if (query) { searches = addSearch(searches, query); store.set(SEARCHES_KEY, JSON.stringify(searches)); }
  go({ kind: 'search' });
}

function toggleFav(id: string): void {
  const s = find(id);
  if (!s) return;
  favs = isFav(id) ? favs.filter(f => f.id !== id) : [...favs, s];
  saveFavs();
  render();
}

function openSearch(): void {
  Keyboard.open({
    value: query, placeholder: 'Station name', done: 'Search', max: 60,
    onDone: text => { search(text); },
  });
}

function playOrToggle(s: Station): void {
  if (current?.id === s.id && state !== 'off') toggle();
  else play(s);
}

function onFilter(which: string): void {
  if (which === 'country') {
    if (filters.country) { filters = { ...filters, country: '' }; countryName = ''; search(query); }
    else go({ kind: 'facets', facet: 'countries', pick: true });
    return;
  }
  if (which === 'codec') filters = { ...filters, codec: nextChoice(CODECS as readonly string[], filters.codec) };
  if (which === 'bitrate') filters = { ...filters, bitrate: nextChoice(BITRATES as readonly number[], filters.bitrate) };
  search(query);
}

function onPageClick(ev: Event): void {
  const t = ev.target as Element;
  closeNow();   // a tap on the header tabs or a list leaves Now playing
  const d = (attr: string) => t.closest<HTMLElement>(`[data-${attr}]`)?.dataset[attr];
  const chipId = d('chip');
  if (chipId) { chip = chipId as Chip; render(); return; }
  const heart = d('heart');
  if (heart) { toggleFav(heart); return; }
  const playId = d('play');
  if (playId) { const s = find(playId); if (s) playOrToggle(s); return; }
  const open = d('open');
  if (open) {
    const s = find(open);
    if (s) go({ kind: 'station', station: s, back: view.kind === 'station' ? view.back : view });
    return;
  }
  const tab = d('tab');
  if (tab === 'search') { go({ kind: 'search' }); return; }
  if (tab) { query = ''; go(tab === 'home' ? { kind: 'home' } : tab === 'top' ? { kind: 'top' } : { kind: 'facets', facet: tab as FacetKind }); return; }
  const recent = d('q');
  if (recent) { search(recent); return; }
  if (d('clear') !== undefined) { searches = []; store.set(SEARCHES_KEY, '[]'); render(); return; }
  const showAll = d('showall');
  if (showAll) { go(showAll === 'top' ? { kind: 'top' } : { kind: 'facets', facet: showAll as FacetKind }); return; }
  const shelfKind = d('kind');
  if (shelfKind) { go({ kind: 'browse', facet: shelfKind as FacetKind, name: d('name') ?? '' }); return; }
  const facetName = d('facet');
  if (facetName !== undefined && view.kind === 'facets') {
    if (view.pick) {
      filters = { ...filters, country: t.closest<HTMLElement>('[data-code]')?.dataset.code || '' };
      countryName = filters.country ? facetName : '';
      search(query);
    } else go({ kind: 'browse', facet: view.facet, name: facetName });
    return;
  }
  const tag = d('tag');
  if (tag) { go({ kind: 'browse', facet: 'tags', name: tag }); return; }
  const filter = d('filter');
  if (filter) { onFilter(filter); return; }
  const act = d('act');
  if (act && view.kind === 'station') {
    if (act === 'play') playOrToggle(view.station);
    else if (act === 'save') toggleFav(view.station.id);
    else if (act === 'stop') stop();
  }
}

function back(): void {
  if (view.kind === 'station') { view = view.back; render(); void load(); return; }
  if (view.kind === 'browse') { go({ kind: 'facets', facet: view.facet }); return; }
  if (view.kind === 'facets' && view.pick) { go({ kind: 'search' }); return; }
  query = '';
  go({ kind: 'home' });
}

// ---- drawing ----

/** A station's logo over its colour block (the letter shows when it has no logo, or the logo fails). */
function logo(s: Station, cls: string): string {
  const img = s.favicon ? `<img src="${esc(s.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="${cls}" style="--hue:${stationHue(s.name)}" aria-hidden="true">${esc(initial(s.name))}${img}</span>`;
}

const onAir = (s: Station): boolean => current?.id === s.id && state !== 'off';
const qualityLine = (s: Station): string => [s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ''].filter(Boolean).join(' · ');

/** A station card on a shelf: the art and the name open the station page; the button on the art plays or pauses. */
function stationCard(s: Station): string {
  const playing = onAir(s) && (state === 'playing' || state === 'buffering');
  const sub = s.country || qualityLine(s);
  return `<div class="rd-sc${onAir(s) ? ' on' : ''}">
    <button class="rd-sc-open" data-open="${esc(s.id)}">${logo(s, 'rd-logo rd-sc-art')}<span class="rd-sc-name">${esc(s.name)}</span><span class="rd-sc-sub">${esc(sub) || '&nbsp;'}</span></button>
    <button class="rd-sc-play" data-play="${esc(s.id)}" aria-label="${playing ? 'Pause' : 'Play'} ${esc(s.name)}">${playing ? I.pause : I.play}</button>
  </div>`;
}

/** A category tile: the name, and the station count when the shelf shows it. */
function facetTile(f: Facet, kind: FacetKind, withCount: boolean): string {
  return `<button class="rd-tile2" data-kind="${kind}" data-name="${esc(f.name)}" style="--hue:${tileHue(f.name)}"><b>${esc(f.name)}</b>${withCount ? `<span>${f.count} stations</span>` : ''}</button>`;
}

/** One shelf: the heading (Show all where it has one), then its row of cards. */
function shelfHtml(p: ShelfPlan): string {
  const all = p.id === 'top' ? 'top' : p.id === 'genres' ? 'tags' : 'countries';
  const head = `<div class="rd-shelf-head"><h3>${esc(p.title)}</h3>${p.showAll ? `<button class="rd-showall" data-showall="${all}">Show all</button>` : ''}</div>`;
  if (p.id === 'top' && p.error) return `<section class="rd-shelf">${head}<p class="rd-empty">${esc(p.error)}</p></section>`;
  let cards: string;
  if (p.id === 'favs') cards = favs.length ? favs.map(stationCard).join('') : `<p class="rd-dashed">${esc(FAV_EMPTY)}</p>`;
  else if (p.id === 'recent') cards = recent.map(stationCard).join('');
  else if (p.id === 'top') cards = p.loading ? '<div class="rd-sk"></div>'.repeat(6) : home.top.slice(0, TOP_COUNT).map(stationCard).join('');
  else if (p.id === 'genres') cards = topFacets(home.genres).map(f => facetTile(f, 'tags', true)).join('');
  else cards = topFacets(home.countries).map(f => facetTile(f, 'countries', false)).join('');
  return `<section class="rd-shelf">${head}<div class="rd-row${p.id === 'genres' || p.id === 'countries' ? ' rd-facets' : ''}">${cards}</div></section>`;
}

/** A square cover on Recently played: the cover, the name below. A tap plays the station (or pauses it on air). */
function coverCard(s: Station): string {
  const playing = onAir(s) && (state === 'playing' || state === 'buffering');
  return `<button class="rd-cv${onAir(s) ? ' on' : ''}" data-play="${esc(s.id)}" aria-label="${playing ? 'Pause' : 'Play'} ${esc(s.name)}">${logo(s, 'rd-logo rd-cover rd-cv-art')}<span class="rd-cv-name">${esc(s.name)}</span></button>`;
}

/** A station row: the cover, the name and one line open the station page; the ink button plays or pauses. */
function rowCard(s: Station, cls: string, sub: string): string {
  const playing = onAir(s) && (state === 'playing' || state === 'buffering');
  return `<div class="rd-rc ${cls}${onAir(s) ? ' on' : ''}">
    <button class="rd-rc-open" data-open="${esc(s.id)}">${logo(s, 'rd-logo rd-cover rd-rc-art')}<span class="rd-rc-text"><b>${esc(s.name)}</b><span>${esc(sub) || '&nbsp;'}</span></span></button>
    <button class="rd-rc-play" data-play="${esc(s.id)}" aria-label="${playing ? 'Pause' : 'Play'} ${esc(s.name)}">${playing ? I.pause : I.play}</button>
  </div>`;
}

const landingHead = (title: string, all = ''): string =>
  `<div class="rd-shelf-head"><h3>${esc(title)}</h3>${all ? `<button class="rd-showall" data-showall="${all}">Show all</button>` : ''}</div>`;

/** One landing shelf. Recently played: square covers in a row. Made for you: two rows of tiles. Your top stations:
 *  compact rows. Genres and Countries keep their tiles. */
function landingShelf(p: ShelfPlan): string {
  if (p.hidden) return '';
  if (p.id === 'recent') return `<section class="rd-shelf">${landingHead('Recently played')}<div class="rd-row rd-cv-row">${recent.map(coverCard).join('')}</div></section>`;
  if (p.id === 'top') {
    const head = landingHead('Made for you', 'top');
    if (p.error) return `<section class="rd-shelf">${head}<p class="rd-empty">${esc(p.error)}</p></section>`;
    if (p.loading) return `<section class="rd-shelf">${head}<div class="rd-made">${'<div class="rd-sk-row"></div>'.repeat(MADE_COUNT)}</div></section>`;
    const picks = madeForYou(home.top, [...recent, ...favs]);
    if (!picks.length) return '';
    return `<section class="rd-shelf">${head}<div class="rd-made">${picks.map(s => rowCard(s, 'rd-mf', describe(s))).join('')}</div></section>`;
  }
  if (p.id === 'favs') {
    const body = favs.length ? `<div class="rd-tops">${favs.map(s => rowCard(s, 'rd-tr', s.country || describe(s))).join('')}</div>` : `<p class="rd-empty">${esc(FAV_EMPTY)}</p>`;
    return `<section class="rd-shelf">${landingHead('Your top stations')}${body}</section>`;
  }
  return shelfHtml(p);
}

function renderShelves(): void {
  const on = view.kind === 'home';
  $('rdShelves').hidden = !on;
  $('rdSearch').hidden = on;   // Home opens on the greeting; the Search tab has the field
  if (!on) return;
  const plan = homeShelves({
    favs: favs.length, recent: recent.length,
    top: home.topState, topCount: home.top.length,
    genres: home.genresState, genreCount: home.genres.length,
    countries: home.countriesState, countryCount: home.countries.length,
  });
  const byId = new Map<ShelfId, ShelfPlan>(plan.map(p => [p.id, p]));
  const chips = CHIPS.map(([id, label]) => `<button class="rd-fchip${chip === id ? ' on' : ''}" data-chip="${id}" aria-pressed="${chip === id}">${label}</button>`).join('');
  const shelves = LANDING_ORDER.filter(id => chipShows(chip, id)).map(id => landingShelf(byId.get(id)!)).join('');
  const empty = chip === 'recent' ? 'Stations you play show here.' : 'Nothing here yet.';
  setHtml($('rdShelves'), `<h2 class="rd-greet">${greeting(new Date().getHours())}</h2><div class="rd-chips">${chips}</div>`
    + (shelves || `<p class="rd-empty">${empty}</p>`));
}

function tile(s: Station): string {
  const sub = [s.country, qualityLine(s)].filter(Boolean).join(' · ');
  return `<button class="rd-tile${onAir(s) ? ' on' : ''}" data-open="${esc(s.id)}">${logo(s, 'rd-logo')}<span class="rd-tile-text"><b>${esc(s.name)}</b><span>${esc(sub) || '&nbsp;'}</span></span></button>`;
}

function facetCard(f: Facet): string {
  return `<button class="rd-facet" data-facet="${esc(f.name)}" data-code="${esc(f.code)}"><b>${esc(f.name)}</b><span>${f.count}</span></button>`;
}

function stationPage(s: Station): string {
  const live = onAir(s);
  const fav = isFav(s.id);
  const place = [s.country, s.language].filter(Boolean).join(' · ');
  const now = live ? titleLine(true, state, streamTitle) : '';
  const tags = (s.tags ?? []).map(t => `<button class="rd-pill" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  const playLabel = live && state !== 'paused' ? 'Pause' : 'Play';
  const details = [place, qualityLine(s)].filter(Boolean).map(line => `<p class="rd-st-meta">${esc(line)}</p>`).join('');
  // in order: the logo and name, the details, the stream title, Play and Save (one row), then the genres
  return `<div class="rd-station">
    <div class="rd-st-top">${logo(s, 'rd-logo')}<h2 class="rd-st-name">${esc(s.name)}</h2></div>
    ${details ? `<div class="rd-st-details">${details}</div>` : ''}
    ${now ? `<p class="rd-st-desc">${esc(now)}</p>` : ''}
    <div class="rd-st-actions">
      <button class="rd-cta" data-act="play">${playLabel}</button>
      <button class="rd-cta ghost${fav ? ' on' : ''}" data-act="save" aria-pressed="${fav}">${fav ? 'Saved' : 'Save'}</button>
      ${live ? '<button class="rd-cta ghost" data-act="stop">Stop</button>' : ''}
    </div>
    ${tags ? `<div class="rd-tags">${tags}</div>` : ''}
    ${moreHtml(s)}
  </div>`;
}

/** Set innerHTML only when it changed, so logos are not loaded again on every state change. */
function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function renderVolume(): void {
  for (const [slider, icon] of [['rdVol', 'rdVolIc'], ['rdNpVol', 'rdNpVolIc']] as const) {
    const input = $<HTMLInputElement>(slider);
    if (document.activeElement !== input) input.value = String(volume);
    input.style.setProperty('--p', `${volume}%`);
    $(icon).innerHTML = volume === 0 ? I.mute : I.vol;
  }
}

function renderSleep(): void {
  for (const b of [$<HTMLButtonElement>('rdSleep'), $<HTMLButtonElement>('rdNpSleep')]) {
    b.textContent = sleepAt ? `Sleep ${sleepLeft(sleepAt, Date.now())} min` : 'Sleep';
    b.classList.toggle('on', !!sleepAt);
    b.setAttribute('aria-label', sleepAt ? `Sleep timer: ${sleepLeft(sleepAt, Date.now())} minutes left. Tap to change.` : 'Sleep timer: off. Tap for 15 minutes.');
    b.disabled = state === 'off';
  }
}

/** The first match, large: its art, its name and line, and Play and Save. */
function topResult(s: Station): string {
  const playing = onAir(s) && (state === 'playing' || state === 'buffering');
  const fav = isFav(s.id);
  const sub = [s.country, qualityLine(s)].filter(Boolean).join(' · ');
  return `<div class="rd-top">${logo(s, 'rd-logo rd-top-art')}<div class="rd-top-text"><b>${esc(s.name)}</b><span>${esc(sub) || '&nbsp;'}</span></div>
    <div class="rd-top-act"><button class="rd-cta" data-play="${esc(s.id)}">${playing ? 'Pause' : 'Play'}</button><button class="rd-cta ghost${fav ? ' on' : ''}" data-heart="${esc(s.id)}" aria-pressed="${fav}">${fav ? 'Saved' : 'Save'}</button></div></div>`;
}

/** The recent searches as chips, and a Clear. Empty when there are none. */
function recentHtml(): string {
  if (!searches.length) return '';
  return `<div class="rd-recent">${searches.map(q => `<button class="rd-pill" data-q="${esc(q)}">${esc(q)}</button>`).join('')}<button class="rd-pill rd-clear" data-clear="1">Clear</button></div>`;
}

/** Browse all: a heading and four columns of tiles per kind; the last tile opens the whole list. */
function browseHtml(b: Browse): string {
  const sections: [FacetKind, string, string][] = [['tags', 'Genres', 'All genres'], ['countries', 'Countries', 'All countries'], ['languages', 'Languages', 'All languages']];
  return sections.map(([kind, title, all]) => `<h3 class="rd-browse-head">${title}</h3><div class="rd-grid rd-browse-grid">${browsePick(b[kind]).map(f =>
    `<button class="rd-tile2" data-kind="${kind}" data-name="${esc(f.name)}" style="--hue:${tileHue(f.name)}"><b>${esc(f.name)}</b><span>${f.count} stations</span></button>`).join('')}<button class="rd-tile2 rd-all" data-showall="${kind}"><b>${all}</b></button></div>`).join('');
}

function renderCatalogue(): void {
  const isHome = view.kind === 'home';
  const tabOf = isHome ? 'home' : view.kind === 'search' ? 'search' : '';
  for (const b of $('rdTabs').querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tabOf);
  $('rdBack').hidden = isHome;
  $('rdBarRow').hidden = isHome;
  $('rdRes').hidden = isHome;

  let head = 'Top stations';
  if (view.kind === 'facets') head = view.pick ? 'Pick a country' : FACET_NAMES[view.facet];
  else if (view.kind === 'browse') head = view.facet === 'tags' ? view.name[0].toUpperCase() + view.name.slice(1) : view.name;
  else if (view.kind === 'search') head = !isFiltering() ? 'Browse all' : query ? `Results for “${query}”` : 'Filtered stations';
  else if (view.kind === 'station') head = 'Station';
  $('rdResHead').textContent = head;

  const showFilters = view.kind === 'search';
  $('rdFilters').hidden = !showFilters;
  if (showFilters) {
    setHtml($('rdFilters'), [
      `<button class="rd-pill${filters.country ? ' on' : ''}" data-filter="country">${esc(filters.country ? countryName || filters.country : 'Any country')}</button>`,
      `<button class="rd-pill${filters.codec ? ' on' : ''}" data-filter="codec">${filters.codec || 'Any format'}</button>`,
      `<button class="rd-pill${filters.bitrate ? ' on' : ''}" data-filter="bitrate">${filters.bitrate ? `${filters.bitrate}+ kbit/s` : 'Any quality'}</button>`,
    ].join(''));
  }

  let html = '';
  let emptyText = '';
  if (isHome) { setHtml($('rdRes'), ''); $('rdResEmpty').hidden = true; return; }
  if (view.kind === 'station') html = stationPage(view.station);
  else if (view.kind === 'search' && !isFiltering()) {
    if (browse === 'loading') emptyText = 'Looking for stations…';
    else if (browse === 'error') emptyText = RADIO_DOWN;
    else html = recentHtml() + browseHtml(browse);
  }
  else if (view.kind === 'search' && listState === 'loading') html = `<div class="rd-grid rd-station-grid">${'<div class="rd-sk-row"></div>'.repeat(6)}</div>`;
  else if (listState === 'loading' || listState === 'idle') emptyText = 'Looking for stations…';
  else if (listState === 'error') emptyText = RADIO_DOWN;
  else if (view.kind === 'facets') {
    html = facets.length ? `<div class="rd-grid rd-facet-grid">${facets.map(facetCard).join('')}</div>` : '';
    if (!facets.length) emptyText = 'The directory sent no list.';
  } else {
    html = list.length ? `${view.kind === 'search' ? topResult(list[0]) : ''}<div class="rd-grid rd-station-grid">${list.map(tile).join('')}</div>` : '';
    if (!list.length) emptyText = view.kind === 'search' ? 'No stations match. Try fewer words.' : 'No stations found.';
  }
  setHtml($('rdRes'), html);
  $('rdResEmpty').textContent = emptyText;
  $('rdResEmpty').hidden = !emptyText;
}

/** One upcoming Favourite in the Now playing list: its logo and name. A tap plays it. */
function upCard(s: Station): string {
  return `<button class="rd-np-up" data-play="${esc(s.id)}" aria-label="Play ${esc(s.name)}">${logo(s, 'rd-logo rd-np-up-art')}<span class="rd-np-up-name">${esc(s.name)}</span></button>`;
}

/** The Now playing view: the art, the name and state, the transport and the volume, and what plays next in Favourites. */
function renderNow(): void {
  if (!nowOpen) return;
  const s = current;
  const m = barModel(s, state, streamTitle, favs);
  const art = $('rdNpArt');
  art.style.setProperty('--hue', String(s ? stationHue(s.name) : 30));
  art.classList.toggle('blank', !s);
  setHtml(art, s ? `${esc(initial(s.name))}${s.favicon ? `<img src="${esc(s.favicon)}" alt="" referrerpolicy="no-referrer">` : ''}` : ICON);
  $('rdNpName').textContent = m.title;
  $('rdNpState').textContent = m.subtitle;
  $('rdNpDetails').textContent = s ? [s.country, s.language, qualityLine(s)].filter(Boolean).join(' · ') : '';
  $('rdNpKick').classList.toggle('live', m.live);
  $('rdNpKick').classList.toggle('buffering', state === 'buffering');
  const fav = $('rdNpFav');
  fav.hidden = !s;
  if (s) {
    const on = isFav(s.id);
    fav.innerHTML = I.heart(on);
    fav.classList.toggle('on', on);
    fav.setAttribute('aria-pressed', String(on));
    fav.setAttribute('aria-label', on ? 'Remove from Favourites' : 'Add to Favourites');
  }
  const toggleBtn = $<HTMLButtonElement>('rdNpToggle');
  toggleBtn.innerHTML = m.playing ? I.pause : I.play;
  toggleBtn.setAttribute('aria-label', m.playing ? 'Pause' : 'Play');
  toggleBtn.disabled = !s && !favs.length && !list.length;
  $<HTMLButtonElement>('rdNpPrev').disabled = !m.canStep;
  $<HTMLButtonElement>('rdNpNext').disabled = !m.canStep;
  $<HTMLButtonElement>('rdNpStop').disabled = !m.live;
  $('rdNpUpNext').hidden = !m.canStep;
  if (m.canStep) {
    // the favourites in stepFavourite's order, from the one after the station on air; that station is left out
    const at = s ? favs.findIndex(f => f.id === s.id) : -1;
    const next = favs.map((_, i) => favs[(at + 1 + i) % favs.length]).filter(f => f.id !== s?.id);
    setHtml($('rdNpNextList'), next.map(upCard).join(''));
  }
}

function render(): void {
  const s = current;
  const live = state !== 'off';
  $('rdNow').classList.toggle('live', live);
  $('rdNow').classList.toggle('buffering', state === 'buffering');
  const artEl = $('rdArt');
  artEl.style.setProperty('--hue', String(s ? stationHue(s.name) : 30));
  artEl.classList.toggle('blank', !s);
  setHtml(artEl, s ? `${esc(initial(s.name))}${s.favicon ? `<img src="${esc(s.favicon)}" alt="" referrerpolicy="no-referrer">` : ''}` : ICON);
  $<HTMLButtonElement>('rdArtBtn').disabled = !s;
  $('rdName').textContent = s ? s.name : 'Nothing playing';
  $('rdTitle').textContent = titleLine(!!s, state, streamTitle);
  $('rdMsg').hidden = !message;
  $('rdMsg').textContent = message;
  const heart = $('rdNowFav');
  heart.hidden = !s;
  if (s) {
    const fav = isFav(s.id);
    heart.innerHTML = I.heart(fav);
    heart.classList.toggle('on', fav);
    heart.setAttribute('aria-pressed', String(fav));
    heart.setAttribute('aria-label', fav ? 'Remove from Favourites' : 'Add to Favourites');
  }
  const playingNow = state === 'playing' || state === 'buffering';
  $('rdLive').hidden = !playingNow;
  $('rdToggle').innerHTML = playingNow ? I.pause : I.play;
  $('rdToggle').setAttribute('aria-label', playingNow ? 'Pause' : 'Play');
  $<HTMLButtonElement>('rdToggle').disabled = !s && !favs.length && !list.length;
  $<HTMLButtonElement>('rdPrev').disabled = !favs.length;
  $<HTMLButtonElement>('rdNext').disabled = !favs.length;
  renderSleep();

  renderShelves();

  $('rdQuery').textContent = query || 'Search stations';
  $('rdQuery').classList.toggle('set', !!query);
  renderCatalogue();
  renderNow();
}

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    // a routine's "play the last station" step: the most recent station plays (routines/web/run.ts)
    addEventListener('hub:radio-last', () => { if (recent[0]) play(recent[0]); });
    $('rdPrev').innerHTML = I.prev;
    $('rdNext').innerHTML = I.next;
    $('rdSearchIc').innerHTML = I.search;
    $('rdSearch').addEventListener('click', openSearch);
    $('rdToggle').addEventListener('click', toggle);
    $('rdPrev').addEventListener('click', () => step(-1));
    $('rdNext').addEventListener('click', () => step(1));
    $('rdSleep').addEventListener('click', cycleSleep);
    $('rdBack').addEventListener('click', back);
    $('rdNowFav').addEventListener('click', () => { if (current) toggleFav(current.id); });

    $('rdArtBtn').addEventListener('click', openNow);
    $('rdNowText').addEventListener('click', openNow);
    $('rdExpand').innerHTML = I.up;
    $('rdExpand').addEventListener('click', openNow);
    $('rdNpClose').innerHTML = I.down;
    $('rdNpPrev').innerHTML = I.prev;
    $('rdNpNext').innerHTML = I.next;
    $('rdNpClose').addEventListener('click', closeNow);
    $('rdNpToggle').addEventListener('click', toggle);
    $('rdNpPrev').addEventListener('click', () => step(-1));
    $('rdNpNext').addEventListener('click', () => step(1));
    $('rdNpStop').addEventListener('click', stop);
    $('rdNpSleep').addEventListener('click', cycleSleep);
    $('rdNpFav').addEventListener('click', () => { if (current) toggleFav(current.id); });
    $('rdNpVol').addEventListener('input', ev => setVolume(Number((ev.target as HTMLInputElement).value)));
    $('rdNpNextList').addEventListener('click', ev => {
      const id = (ev.target as Element).closest<HTMLElement>('[data-play]')?.dataset.play;
      const s = id ? find(id) : undefined;
      if (s) play(s);
    });
    $('rdVol').addEventListener('input', ev => setVolume(Number((ev.target as HTMLInputElement).value)));
    for (const id of ['rdShelves', 'rdTabs', 'rdFilters', 'rdRes']) $(id).addEventListener('click', onPageClick);
    // a logo that does not load is removed, so the station's letter shows instead (error does not bubble: capture it)
    for (const id of ['rdShelves', 'rdRes', 'rdNow']) {
      $(id).addEventListener('error', ev => {
        const t = ev.target as Element;
        if (t instanceof HTMLImageElement) t.remove();
      }, true);
    }
    setInterval(tickSleep, 15e3);
    try {
      const v = volumeFromDevice(device.volume().media);
      if (v !== null) volume = v;
    } catch { /* not on the tablet */ }
    onVolume(level => { const v = volumeFromDevice(level); if (v !== null) { volume = v; renderVolume(); } });
    renderVolume();
    render();
  },
  onShow() {
    // the first visit, or a load that failed, asks the directory again
    if (view.kind === 'home') void loadHome(home.topState === 'error' || home.genresState === 'error' || home.countriesState === 'error');
    else if (listState !== 'ok') void load(true);
  },
};
export default app;
