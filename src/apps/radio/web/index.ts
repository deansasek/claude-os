// The Radio app: internet radio from Radio Browser. Search by name, or see the most-voted stations (through the hub,
// /api/radio/stations). Tap a station to play it; the star keeps it in Favourites on this tablet (the store helper).
// Only https streams play. The station on the air shows under the rail icon, and it keeps playing when the app closes.
import { esc, getJson, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import type { Station, StationsResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { httpsUrl, playable, playableStations } from './stations.ts';

const API = `/api/${manifest.id}`;
const FAVS_KEY = 'radio.favs';
const ICON = appIcon('radio');
const STAR = (on: boolean) => `<svg viewBox="0 0 20 20" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 14.1l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z"/></svg>`;

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let favs: Station[] = loadFavs();
let results: Station[] = [];
let resultsState: 'loading' | 'ok' | 'error' = 'loading';
let resultsError = '';
let query = '';
let playing: Station | null = null;
let message = '';                  // a line under the search: an error or a note
let audio: HTMLAudioElement | null = null;
let seq = 0;                       // the latest search wins

function loadFavs(): Station[] {
  try {
    const list = JSON.parse(store.get(FAVS_KEY) || '[]');
    return Array.isArray(list) ? playable(list as Station[]) : [];
  } catch {
    return [];
  }
}

function saveFavs(): void { store.set(FAVS_KEY, JSON.stringify(favs)); }

function find(id: string): Station | undefined {
  return favs.find(s => s.id === id) ?? results.find(s => s.id === id);
}

function setPlaying(s: Station | null): void {
  playing = s;
  ctx.setRail({ label: s ? s.name : '' });   // the glance: the station on the air
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('error', () => {
      if (!playing) return;
      message = 'That station stopped. Try another.';
      setPlaying(null);
      render();
    });
  }
  return audio;
}

function play(s: Station): void {
  const url = httpsUrl(s.url);
  if (!url) {
    message = 'This station has no https stream, so it will not play.';
    render();
    return;
  }
  const a = getAudio();
  a.src = url;
  setPlaying({ ...s, url });
  message = '';
  render();
  a.play().catch(() => {
    if (playing?.id !== s.id) return;
    message = 'The station would not start. Try another.';
    setPlaying(null);
    render();
  });
}

function stop(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  setPlaying(null);
  render();
}

async function search(q: string): Promise<void> {
  query = q.trim().slice(0, 60);
  const mine = ++seq;
  resultsState = 'loading';
  render();
  try {
    const r = await getJson<StationsResult>(`${API}/stations?q=${encodeURIComponent(query)}`);
    if (mine !== seq) return;
    if (r.status === 'ok') {
      results = playableStations(r.stations);
      resultsState = 'ok';
    } else {
      results = [];
      resultsState = 'error';
      resultsError = r.error;
    }
  } catch {
    if (mine !== seq) return;
    results = [];
    resultsState = 'error';
    resultsError = 'No connection to the radio directory.';
  }
  render();
}

function toggleFav(id: string): void {
  const s = find(id);
  if (!s) return;
  favs = favs.some(f => f.id === id) ? favs.filter(f => f.id !== id) : [...favs, s];
  saveFavs();
  render();
}

function openSearch(): void {
  Keyboard.open({
    value: query, placeholder: 'Station name', done: 'Search', max: 60,
    onDone: text => { void search(text); },
  });
}

function onListClick(ev: Event): void {
  const t = ev.target as Element;
  const star = t.closest<HTMLElement>('[data-star]')?.dataset.star;
  if (star) { toggleFav(star); return; }
  const id = t.closest<HTMLElement>('[data-play]')?.dataset.play;
  const s = id ? find(id) : undefined;
  if (s) play(s);
}

function row(s: Station): string {
  const on = playing?.id === s.id;
  const fav = favs.some(f => f.id === s.id);
  const sub = [s.country, s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ''].filter(Boolean).join(' · ');
  return `<li class="rd-row${on ? ' on' : ''}">
    <button class="rd-play" data-play="${esc(s.id)}"><span class="rd-name">${esc(s.name)}</span><span class="rd-sub">${esc(sub) || '&nbsp;'}</span>${on ? '<span class="rd-live">Playing</span>' : ''}</button>
    <button class="rd-star${fav ? ' on' : ''}" data-star="${esc(s.id)}" aria-label="${fav ? 'Remove from Favourites' : 'Add to Favourites'}" aria-pressed="${fav}">${STAR(fav)}</button>
  </li>`;
}

function render(): void {
  $('rdNow').hidden = !playing;
  if (playing) $('rdNowName').textContent = playing.name;
  $('rdQuery').textContent = query || 'Search stations';
  $('rdMsg').hidden = !message;
  $('rdMsg').textContent = message;
  $('rdFavs').innerHTML = favs.map(row).join('');
  $('rdFavsEmpty').hidden = favs.length > 0;
  $('rdResHead').textContent = query ? `Results for “${query}”` : 'Most voted stations';
  let emptyText = '';
  if (resultsState === 'loading') emptyText = 'Looking for stations…';
  else if (resultsState === 'error') emptyText = resultsError || 'The radio directory did not answer.';
  else if (!results.length) emptyText = query ? `No stations match “${query}”. Try another name.` : 'No stations found.';
  $('rdRes').innerHTML = resultsState === 'ok' ? results.map(row).join('') : '';
  $('rdResEmpty').textContent = emptyText;
  $('rdResEmpty').hidden = !emptyText;
}

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    $('rdSearch').addEventListener('click', openSearch);
    $('rdStop').addEventListener('click', stop);
    $('rdFavs').addEventListener('click', onListClick);
    $('rdRes').addEventListener('click', onListClick);
    render();
  },
  onShow() {
    // the first visit, or a search that failed, loads the most-voted stations again
    if (resultsState !== 'ok') void search(query);
  },
};
export default app;
