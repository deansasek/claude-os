// The Radio app: internet radio from Radio Browser, as a media player. Favourites and recently played sit in rows
// along the top; the now-playing card (left) has the station, a title line, play/pause, previous and next through
// Favourites, a sleep timer, Stop and the volume. The catalogue (right) searches with filters and browses Top stations,
// Genres, Countries and Languages (through the hub, /api/radio/stations and /api/radio/catalogue); a station card opens
// the station's own page. Favourites, recently played and the volume are kept on this tablet (the store helper).
// Only https streams play. One audio element plays everything. The station on the air shows under the rail icon,
// and it keeps playing when the app closes.
import { esc, getJson, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import type { Facet, FacetsResult, Station, StationsResult, TitleResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { BITRATES, CODECS, type FacetKind, NO_FILTERS, type SearchFilters, addRecent, nextChoice } from './catalogue.ts';
import {
  type PlayState, SLEEP_CHOICES, failMessage, initial, railLabel, sleepEnd, sleepLeft, stationHue, stepFavourite, titleLine, volumeFrom,
} from './player.ts';
import { httpsUrl, playable, playableStations } from './stations.ts';

const API = `/api/${manifest.id}`;
const FAVS_KEY = 'radio.favs';
const RECENT_KEY = 'radio.recent';
const VOL_KEY = 'radio.volume';
const ICON = appIcon('radio');
const FAILED = failMessage(undefined);
const NO_DIRECTORY = 'No connection to the radio directory.';
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
  heart: (on: boolean) => svg('<path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z"/>', on),
};

/** What the catalogue shows. A station page remembers the view to go back to. */
type View =
  | { kind: 'top' }
  | { kind: 'facets'; facet: FacetKind; pick?: boolean }   // pick: choose the search's country filter
  | { kind: 'browse'; facet: FacetKind; name: string }
  | { kind: 'search' }
  | { kind: 'station'; station: Station; back: View };

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let favs: Station[] = loadList(FAVS_KEY);
let recent: Station[] = loadList(RECENT_KEY);
let view: View = { kind: 'top' };
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
let volume = volumeFrom(store.get(VOL_KEY));
let sleepAt: number | null = null;       // when the sleep timer stops the radio
let sleepMin = 0;                        // the sleep choice last made
let audio: HTMLAudioElement | null = null;
let seq = 0;                             // the latest catalogue load wins
let playSeq = 0;                         // the latest play wins
let titleTimer = 0;
const facetCache = new Map<FacetKind, Facet[]>();

function loadList(key: string): Station[] {
  try {
    const list = JSON.parse(store.get(key) || '[]');
    return Array.isArray(list) ? playable(list as Station[]) : [];
  } catch {
    return [];
  }
}

function saveFavs(): void { store.set(FAVS_KEY, JSON.stringify(favs)); }
const isFav = (id: string): boolean => favs.some(f => f.id === id);

function find(id: string): Station | undefined {
  const page = view.kind === 'station' && view.station.id === id ? view.station : undefined;
  return favs.find(s => s.id === id) ?? recent.find(s => s.id === id) ?? list.find(s => s.id === id)
    ?? page ?? (current?.id === id ? current : undefined);
}

function setState(next: PlayState): void {
  state = next;
  ctx.setRail({ label: railLabel(current, state, manifest.name) });   // the glance: the station on the air
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
  a.volume = volume / 100;
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

function setVolume(v: number): void {
  volume = volumeFrom(v);
  store.set(VOL_KEY, String(volume));
  if (audio) audio.volume = volume / 100;
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
    if ((r.title || '') !== streamTitle) { streamTitle = r.title || ''; render(); }
  } catch { /* no title; the card says "Live radio" */ }
}

// ---- the catalogue ----

function viewKey(v: View): string {
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

function search(q: string): void {
  query = q.trim().slice(0, 60);
  go(query || filters.country || filters.codec || filters.bitrate ? { kind: 'search' } : { kind: 'top' });
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
  const d = (attr: string) => t.closest<HTMLElement>(`[data-${attr}]`)?.dataset[attr];
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
  if (tab) { query = ''; go(tab === 'top' ? { kind: 'top' } : { kind: 'facets', facet: tab as FacetKind }); return; }
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
  }
}

function back(): void {
  if (view.kind === 'station') { view = view.back; render(); void load(); return; }
  if (view.kind === 'browse') { go({ kind: 'facets', facet: view.facet }); return; }
  if (view.kind === 'facets' && view.pick) { go({ kind: 'search' }); return; }
  query = '';
  go({ kind: 'top' });
}

// ---- drawing ----

/** A station's logo over its colour block (the letter shows when it has no logo, or the logo fails). */
function logo(s: Station, cls: string): string {
  const img = s.favicon ? `<img src="${esc(s.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="${cls}" style="--hue:${stationHue(s.name)}" aria-hidden="true">${esc(initial(s.name))}${img}</span>`;
}

const onAir = (s: Station): boolean => current?.id === s.id && state !== 'off';
const qualityLine = (s: Station): string => [s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ''].filter(Boolean).join(' · ');

function favCard(s: Station): string {
  return `<button class="rd-fav${onAir(s) ? ' on' : ''}" data-play="${esc(s.id)}">${logo(s, 'rd-chip')}<span class="rd-fav-name">${esc(s.name)}</span></button>`;
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
  return `<div class="rd-station">
    <div class="rd-st-top">${logo(s, 'rd-logo')}<div class="rd-st-text">
      <h2 class="rd-st-name">${esc(s.name)}</h2>
      ${place ? `<p class="rd-st-meta">${esc(place)}</p>` : ''}
      ${qualityLine(s) ? `<p class="rd-st-meta">${esc(qualityLine(s))}</p>` : ''}
    </div></div>
    ${now ? `<p class="rd-st-now">${esc(now)}</p>` : ''}
    ${tags ? `<div class="rd-tags">${tags}</div>` : ''}
    <div class="rd-st-actions">
      <button class="rd-cta" data-act="play">${playLabel}</button>
      <button class="rd-cta ghost${fav ? ' on' : ''}" data-act="save" aria-pressed="${fav}">${fav ? 'Saved' : 'Save'}</button>
    </div>
  </div>`;
}

/** Set innerHTML only when it changed, so logos are not loaded again on every state change. */
function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function renderVolume(): void {
  const input = $<HTMLInputElement>('rdVol');
  if (document.activeElement !== input) input.value = String(volume);
  input.style.setProperty('--p', `${volume}%`);
  $('rdVolV').textContent = String(volume);
  $('rdVolIc').innerHTML = volume === 0 ? I.mute : I.vol;
}

function renderSleep(): void {
  const b = $<HTMLButtonElement>('rdSleep');
  b.textContent = sleepAt ? `Sleep ${sleepLeft(sleepAt, Date.now())} min` : 'Sleep';
  b.classList.toggle('on', !!sleepAt);
  b.setAttribute('aria-label', sleepAt ? `Sleep timer: ${sleepLeft(sleepAt, Date.now())} minutes left. Tap to change.` : 'Sleep timer: off. Tap for 15 minutes.');
  b.disabled = state === 'off';
}

function renderCatalogue(): void {
  const tabOf = view.kind === 'top' ? 'top' : view.kind === 'facets' || view.kind === 'browse' ? view.facet : '';
  for (const b of $('rdTabs').querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tabOf);
  $('rdBack').hidden = view.kind === 'top' || (view.kind === 'facets' && !view.pick);

  let head = 'Top stations';
  if (view.kind === 'facets') head = view.pick ? 'Pick a country' : FACET_NAMES[view.facet];
  else if (view.kind === 'browse') head = view.facet === 'tags' ? view.name[0].toUpperCase() + view.name.slice(1) : view.name;
  else if (view.kind === 'search') head = query ? `Results for “${query}”` : 'Filtered stations';
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
  if (view.kind === 'station') html = stationPage(view.station);
  else if (listState === 'loading' || listState === 'idle') emptyText = 'Looking for stations…';
  else if (listState === 'error') emptyText = listError || 'The radio directory did not answer.';
  else if (view.kind === 'facets') {
    html = facets.length ? `<div class="rd-grid">${facets.map(facetCard).join('')}</div>` : '';
    if (!facets.length) emptyText = 'The directory sent no list.';
  } else {
    html = list.length ? `<div class="rd-grid">${list.map(tile).join('')}</div>` : '';
    if (!list.length) emptyText = view.kind === 'search' ? 'No stations match. Try another name or fewer filters.' : 'No stations found.';
  }
  setHtml($('rdRes'), html);
  $('rdResEmpty').textContent = emptyText;
  $('rdResEmpty').hidden = !emptyText;
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
  $('rdKick').textContent = live ? 'On air' : 'Radio';
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
  $('rdToggle').innerHTML = playingNow ? I.pause : I.play;
  $('rdToggle').setAttribute('aria-label', playingNow ? 'Pause' : 'Play');
  $<HTMLButtonElement>('rdToggle').disabled = !s && !favs.length && !list.length;
  $<HTMLButtonElement>('rdPrev').disabled = !favs.length;
  $<HTMLButtonElement>('rdNext').disabled = !favs.length;
  $<HTMLButtonElement>('rdStop').disabled = !live;
  renderSleep();

  setHtml($('rdFavs'), favs.map(favCard).join(''));
  $('rdFavs').hidden = !favs.length;
  $('rdFavsEmpty').hidden = favs.length > 0;
  setHtml($('rdRecent'), recent.map(favCard).join(''));
  $('rdRecent').hidden = !recent.length;
  $('rdRecentEmpty').hidden = recent.length > 0;

  $('rdQuery').textContent = query || 'Search stations';
  $('rdQuery').classList.toggle('set', !!query);
  renderCatalogue();
}

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    $('rdPrev').innerHTML = I.prev;
    $('rdNext').innerHTML = I.next;
    $('rdSearchIc').innerHTML = I.search;
    $('rdSearch').addEventListener('click', openSearch);
    $('rdToggle').addEventListener('click', toggle);
    $('rdPrev').addEventListener('click', () => step(-1));
    $('rdNext').addEventListener('click', () => step(1));
    $('rdStop').addEventListener('click', stop);
    $('rdSleep').addEventListener('click', cycleSleep);
    $('rdBack').addEventListener('click', back);
    $('rdNowFav').addEventListener('click', () => { if (current) toggleFav(current.id); });
    $('rdArtBtn').addEventListener('click', () => {
      if (current) go({ kind: 'station', station: current, back: view.kind === 'station' ? view.back : view });
    });
    $('rdVol').addEventListener('input', ev => setVolume(Number((ev.target as HTMLInputElement).value)));
    for (const id of ['rdFavs', 'rdRecent', 'rdTabs', 'rdFilters', 'rdRes']) $(id).addEventListener('click', onPageClick);
    // a logo that does not load is removed, so the station's letter shows instead
    $('rdNow').parentElement!.parentElement!.addEventListener('error', ev => {
      const t = ev.target as Element;
      if (t instanceof HTMLImageElement) t.remove();
    }, true);
    setInterval(tickSleep, 15e3);
    renderVolume();
    render();
  },
  onShow() {
    // the first visit, or a load that failed, asks the directory again
    if (listState !== 'ok') void load(true);
  },
};
export default app;
