// The Radio app: internet radio from Radio Browser, as a media player. Favourites sit in a row along the top; the
// now-playing card (left) has the station, a title line, play/pause, previous and next through Favourites, Stop and
// the volume; the search and its results (through the hub, /api/radio/stations) are on the right. Favourites and the
// volume are kept on this tablet (the store helper). Only https streams play. One audio element plays everything.
// The station on the air shows under the rail icon, and it keeps playing when the app closes.
import { esc, getJson, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import type { Station, StationsResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { type PlayState, initial, railLabel, stationHue, stepFavourite, titleLine, volumeFrom } from './player.ts';
import { httpsUrl, playable, playableStations } from './stations.ts';

const API = `/api/${manifest.id}`;
const FAVS_KEY = 'radio.favs';
const VOL_KEY = 'radio.volume';
const ICON = appIcon('radio');
const FAILED = 'This station didn\'t play. Try another.';

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

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let favs: Station[] = loadFavs();
let results: Station[] = [];
let resultsState: 'loading' | 'ok' | 'error' = 'loading';
let resultsError = '';
let query = '';
let current: Station | null = null;   // the station in the card; it stays after Stop so Play starts it again
let state: PlayState = 'off';
let message = '';                     // a short line in the card: why a station did not play
let volume = volumeFrom(store.get(VOL_KEY));
let audio: HTMLAudioElement | null = null;
let seq = 0;                          // the latest search wins
let playSeq = 0;                      // the latest play wins

function loadFavs(): Station[] {
  try {
    const list = JSON.parse(store.get(FAVS_KEY) || '[]');
    return Array.isArray(list) ? playable(list as Station[]) : [];
  } catch {
    return [];
  }
}

function saveFavs(): void { store.set(FAVS_KEY, JSON.stringify(favs)); }
const isFav = (id: string): boolean => favs.some(f => f.id === id);

function find(id: string): Station | undefined {
  return favs.find(s => s.id === id) ?? results.find(s => s.id === id) ?? (current?.id === id ? current : undefined);
}

function setState(next: PlayState): void {
  state = next;
  ctx.setRail({ label: railLabel(current, state, manifest.name) });   // the glance: the station on the air
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
  a.addEventListener('error', () => { if (state !== 'off') fail(FAILED); });
  audio = a;
  return a;
}

function play(s: Station): void {
  const url = httpsUrl(s.url);
  current = { ...s, url: url ?? s.url };
  if (!url) { fail('This station has no https stream, so it will not play.'); return; }
  const a = getAudio();
  const mine = ++playSeq;
  a.src = url;
  message = '';
  setState('buffering');
  a.play().catch(() => { if (mine === playSeq && state !== 'off') fail(FAILED); });
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
  const s = current ?? favs[0] ?? results[0];
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
  favs = isFav(id) ? favs.filter(f => f.id !== id) : [...favs, s];
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
  const heart = t.closest<HTMLElement>('[data-heart]')?.dataset.heart;
  if (heart) { toggleFav(heart); return; }
  const id = t.closest<HTMLElement>('[data-play]')?.dataset.play;
  const s = id ? find(id) : undefined;
  if (!s) return;
  if (current?.id === s.id && state !== 'off') toggle();
  else play(s);
}

const art = (s: Station, cls: string): string =>
  `<span class="${cls}" style="--hue:${stationHue(s.name)}" aria-hidden="true">${esc(initial(s.name))}</span>`;

function favCard(s: Station): string {
  const on = current?.id === s.id && state !== 'off';
  return `<button class="rd-fav${on ? ' on' : ''}" data-play="${esc(s.id)}">${art(s, 'rd-chip')}<span class="rd-fav-name">${esc(s.name)}</span></button>`;
}

function resultCard(s: Station): string {
  const on = current?.id === s.id && state !== 'off';
  const fav = isFav(s.id);
  return `<div class="rd-card${on ? ' on' : ''}">
    <button class="rd-card-play" data-play="${esc(s.id)}">${art(s, 'rd-chip')}<span class="rd-card-text"><b>${esc(s.name)}</b><span>${esc(s.country) || '&nbsp;'}</span></span></button>
    <button class="rd-heart${fav ? ' on' : ''}" data-heart="${esc(s.id)}" aria-label="${fav ? 'Remove from Favourites' : 'Add to Favourites'}" aria-pressed="${fav}">${I.heart(fav)}</button>
  </div>`;
}

function renderVolume(): void {
  const input = $<HTMLInputElement>('rdVol');
  if (document.activeElement !== input) input.value = String(volume);
  input.style.setProperty('--p', `${volume}%`);
  $('rdVolV').textContent = String(volume);
  $('rdVolIc').innerHTML = volume === 0 ? I.mute : I.vol;
}

function render(): void {
  const s = current;
  const live = state !== 'off';
  $('rdNow').classList.toggle('live', live);
  $('rdNow').classList.toggle('buffering', state === 'buffering');
  const artEl = $('rdArt');
  artEl.textContent = s ? initial(s.name) : '';
  artEl.style.setProperty('--hue', String(s ? stationHue(s.name) : 30));
  artEl.classList.toggle('blank', !s);
  if (!s) artEl.innerHTML = ICON;
  $('rdKick').textContent = live ? 'On air' : 'Radio';
  $('rdName').textContent = s ? s.name : 'Nothing playing';
  $('rdTitle').textContent = titleLine(!!s, state);
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
  $<HTMLButtonElement>('rdToggle').disabled = !s && !favs.length && !results.length;
  $<HTMLButtonElement>('rdPrev').disabled = !favs.length;
  $<HTMLButtonElement>('rdNext').disabled = !favs.length;
  $<HTMLButtonElement>('rdStop').disabled = !live;

  $('rdFavs').innerHTML = favs.map(favCard).join('');
  $('rdFavs').hidden = !favs.length;
  $('rdFavsEmpty').hidden = favs.length > 0;

  $('rdQuery').textContent = query || 'Search stations';
  $('rdQuery').classList.toggle('set', !!query);
  $('rdResHead').textContent = query ? `Results for “${query}”` : 'Most voted stations';
  let emptyText = '';
  if (resultsState === 'loading') emptyText = 'Looking for stations…';
  else if (resultsState === 'error') emptyText = resultsError || 'The radio directory did not answer.';
  else if (!results.length) emptyText = query ? `No stations match “${query}”. Try another name.` : 'No stations found.';
  $('rdRes').innerHTML = resultsState === 'ok' ? results.map(resultCard).join('') : '';
  $('rdResEmpty').textContent = emptyText;
  $('rdResEmpty').hidden = !emptyText;
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
    $('rdNowFav').addEventListener('click', () => { if (current) toggleFav(current.id); });
    $('rdVol').addEventListener('input', ev => setVolume(Number((ev.target as HTMLInputElement).value)));
    $('rdFavs').addEventListener('click', onListClick);
    $('rdRes').addEventListener('click', onListClick);
    renderVolume();
    render();
  },
  onShow() {
    // the first visit, or a search that failed, loads the most-voted stations again
    if (resultsState !== 'ok') void search(query);
  },
};
export default app;
