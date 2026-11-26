// The Weather app, laid out on the same grid as the Claude page. Everything is tappable:
//   an hour in the strip → that hour      a day in the week → that day     the big temperature → °F / °C
//   the critter → a hop and a tip          the place name → pick a different city (saved on the server)
import { esc, getJson, params, postJson, replay, report, store } from '../../../core/web/dom.ts';
import { localDate, localHour, whenText } from '../../../core/web/format.ts';
import { inkSay } from '../../../core/web/ink.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import type { LocationUpdate, Place, PlacesResponse, Units, Weather, WeatherOk } from '../api.ts';
import { manifest } from '../manifest.ts';
import { appSettingsChanged, registerAppSettings } from '../../../core/web/app-settings.ts';
import { critterSpeak, notify, openApp } from '../../../core/web/system.ts';
import { WMO, advice, icon, isCold, isWindy, kindOf, weatherScene } from './art.ts';
import { airLine, pollenLine } from './air.ts';

type Selection = { t: 'now' } | { t: 'hour'; i: number; strip: number | null } | { t: 'day'; d: number };

const BACK_TO_NOW_MS = 120e3;      // a picked hour or day stays put for two minutes, then the page goes back to now
const TAP_KEY = 'weather.hint.units';   // the "tap for °C" hint goes once the big temperature has been tapped
const REFRESH_MS = 10 * 60e3, RETRY_MS = 60e3;
const STALE_MS = 25 * 60e3;        // older than this and the header says the forecast is out of date
const DAYS = 7, COLS = 12, STEP = 2; // the week list; the hourly strip is twelve columns, two hours apart
const QUIPS = ['I checked the sky for you.', 'Weather report, at your service!', 'I love a good forecast.', 'Beep boop, meteorology!'];

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);
let wx: Weather = { status: 'loading' };
let wxAt = 0;
let offline = false;                 // the last refresh failed; still showing the forecast we had
let pcDown = false;                  // the tablet could not reach the PC on the last refresh
let sel: Selection = { t: 'now' };
let selTimer: number | undefined, retryTimer: number | undefined;
let tipIndex = 0;

const isOk = (w: Weather): w is WeatherOk => w.status === 'ok';
const r = Math.round;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const deg = (t: number) => `${r(t)}°`;

// ---------- what to show for the current selection ----------
interface View {
  kicker: string;
  temp: number; lo?: number;
  code: number; day: boolean;
  facts: string;                        // under the big number
  lead: string; rest: string;           // the sentence: bold lead, grey continuation
  note: string;                         // bottom of the left column
  cond: string; condSub: string;        // centre, above the critter
  windy: boolean;
  hours: number[]; hoursTitle: string; firstIsNow: boolean;
  tips: string[];
  alert: string;                        // the one thing to know soon ("Rain from 3 PM."), set in clay
}

function dayName(w: WeatherOk, d: number, long = false): string {
  if (d === 0) return 'Today';
  if (d === 1 && long) return 'Tomorrow';
  return localDate(w.daily.time[d]).toLocaleDateString([], { weekday: long ? 'long' : 'short' });
}

/** Hourly indexes for a whole day: midnight to 10 PM, two hours apart. */
function dayHours(w: WeatherOk, d: number): number[] {
  const start = w.hourly.time.indexOf(`${w.daily.time[d]}T00:00`);
  return start < 0 ? [] : Array.from({ length: COLS }, (_, j) => start + j * STEP).filter(i => i < w.hourly.time.length);
}

function nowIndex(w: WeatherOk): number {
  const i = w.hourly.time.indexOf(`${w.current.time.slice(0, 13)}:00`);
  return i < 0 ? 0 : i;
}

/** Rain, snow or storms in the next twelve hours, as one line. Nothing when it's already wet out. */
function soonLine(w: WeatherOk): string {
  const h = w.hourly, i0 = nowIndex(w);
  if (['rain', 'drizzle', 'snow', 'storm'].includes(kindOf(w.current.weather_code))) return '';
  for (let i = i0 + 1; i < Math.min(h.time.length, i0 + 13); i++) {
    const k = kindOf(h.weather_code[i]), pp = h.precipitation_probability[i] ?? 0;
    if (k === 'storm') return `Thunderstorms from ${localHour(h.time[i])}.`;
    if (pp >= 60 && (k === 'rain' || k === 'drizzle' || k === 'snow')) return `${k === 'snow' ? 'Snow' : 'Rain'} from ${localHour(h.time[i])}.`;
  }
  return '';
}

const rainLine = (pp: number, amt: number, unit: string) =>
  pp < 10 && amt <= 0 ? 'Dry' : `${pp}% chance of rain${amt > 0 ? `, ${amt.toFixed(unit === 'in' ? 2 : 1)} ${unit}` : ''}`;

function view(w: WeatherOk): View {
  const { current: c, hourly: h, daily: d } = w;
  const i0 = nowIndex(w);
  const nowStrip = Array.from({ length: COLS }, (_, j) => i0 + j * STEP).filter(i => i < h.time.length);
  const sunTimes = (k: number) => `Sunrise ${localHour(d.sunrise[k], true)} · Sunset ${localHour(d.sunset[k], true)}`;

  if (sel.t === 'day') {
    const k = sel.d, pp = d.precipitation_probability_max[k] ?? 0, amt = d.precipitation_sum[k] ?? 0;
    const name = dayName(w, k, true), windy = isWindy(d.wind_speed_10m_max[k], w.units);
    const tip = advice(kindOf(d.weather_code[k]), true, d.temperature_2m_max[k], w.units, pp, { windy, ahead: k > 0 });
    const diff = r(d.temperature_2m_max[k]) - r(d.temperature_2m_max[0]);
    const vsToday = k === 0 ? '' : diff === 0 ? 'About as warm as today.' : `${Math.abs(diff)}° ${diff > 0 ? 'warmer' : 'cooler'} than today.`;
    return {
      kicker: name, temp: d.temperature_2m_max[k], lo: d.temperature_2m_min[k], code: d.weather_code[k], day: true,
      facts: `${rainLine(pp, amt, w.precip_unit)} · UV ${r(d.uv_index_max[k] ?? 0)}`,
      lead: tip, rest: vsToday, note: sunTimes(k),
      cond: WMO[d.weather_code[k]] || '', condSub: `High ${deg(d.temperature_2m_max[k])} · Low ${deg(d.temperature_2m_min[k])} · Wind up to ${r(d.wind_speed_10m_max[k])} ${w.wind_unit}`,
      windy,
      hours: dayHours(w, k), hoursTitle: `${name}, hour by hour`, firstIsNow: false,
      tips: [`${name}: ${lower(tip)}`, `High of ${deg(d.temperature_2m_max[k])}, low of ${deg(d.temperature_2m_min[k])}.`, `Sunset at ${localHour(d.sunset[k], true)}.`],
      alert: '',
    };
  }
  if (sel.t === 'hour') {
    const i = sel.i, day = !!h.is_day[i], pp = h.precipitation_probability[i] ?? 0;
    const dIdx = Math.max(0, d.time.indexOf(h.time[i].slice(0, 10)));
    const when = dIdx > 0 ? `${dayName(w, dIdx, true)}, ${localHour(h.time[i])}` : `Today, ${localHour(h.time[i])}`;
    const windy = isWindy(h.wind_speed_10m[i], w.units);
    const tip = advice(kindOf(h.weather_code[i]), day, h.temperature_2m[i], w.units, pp, { windy, ahead: i !== nowIndex(w) });
    const strip = sel.strip;
    return {
      kicker: when, temp: h.temperature_2m[i], code: h.weather_code[i], day,
      facts: `Feels like ${deg(h.apparent_temperature[i])} · ${pp < 10 ? 'Dry' : `${pp}% chance of rain`}`,
      lead: tip, rest: '', note: `${dayName(w, dIdx, true)}: high ${deg(d.temperature_2m_max[dIdx])}, low ${deg(d.temperature_2m_min[dIdx])}`,
      cond: WMO[h.weather_code[i]] || '', condSub: `Wind ${r(h.wind_speed_10m[i])} ${w.wind_unit}`,
      windy,
      hours: strip == null ? nowStrip : dayHours(w, strip),
      hoursTitle: strip == null ? 'Next 24 hours' : `${dayName(w, strip, true)}, hour by hour`, firstIsNow: strip == null,
      tips: [`${when}: ${lower(tip)}`, `Feels like ${deg(h.apparent_temperature[i])}.`, `Wind ${r(h.wind_speed_10m[i])} ${w.wind_unit}.`],
      alert: '',
    };
  }
  const windy = isWindy(c.wind_speed_10m, w.units);
  const [lead, rest] = outlook(w, windy);
  return {
    kicker: 'Right now', temp: c.temperature_2m, code: c.weather_code, day: !!c.is_day,
    facts: `High ${deg(d.temperature_2m_max[0])} · Low ${deg(d.temperature_2m_min[0])} · Humidity ${r(c.relative_humidity_2m)}%`,
    lead, rest, note: sunTimes(0),
    cond: WMO[c.weather_code] || '', condSub: `Feels like ${deg(c.apparent_temperature)} · Wind ${r(c.wind_speed_10m)} ${w.wind_unit}`,
    windy,
    hours: nowStrip, hoursTitle: 'Next 24 hours', firstIsNow: true,
    tips: [lead, `High of ${deg(d.temperature_2m_max[0])} today.`, `UV index ${r(d.uv_index_max[0] ?? 0)} today.`, `Sunset at ${localHour(d.sunset[0], true)}.`],
    alert: soonLine(w),
  };
}

/** The week in a sentence or two, written like the anthropic.com headline: [bold lead, grey continuation]. */
function outlook(w: WeatherOk, windy: boolean): [string, string] {
  const d = w.daily, c = w.current, n = Math.min(DAYS, d.time.length);
  const lead = advice(kindOf(c.weather_code), !!c.is_day, c.temperature_2m, w.units, d.precipitation_probability_max[0] || 0, { windy });
  const parts: string[] = [];
  const wet = Array.from({ length: n - 1 }, (_, j) => j + 1).find(k => (d.precipitation_probability_max[k] ?? 0) >= 50);
  if (wet != null) parts.push(`${dayName(w, wet, true)} looks wet, ${d.precipitation_probability_max[wet]}% chance of rain.`);
  let warm = 1;
  for (let k = 2; k < n; k++) if (d.temperature_2m_max[k] > d.temperature_2m_max[warm]) warm = k;
  if (n > 1) parts.push(`Warmest ${warm === 1 ? 'tomorrow' : `on ${dayName(w, warm, true)}`} at ${deg(d.temperature_2m_max[warm])}.`);
  let coldest = 1;
  for (let k = 2; k < n; k++) if (d.temperature_2m_min[k] < d.temperature_2m_min[coldest]) coldest = k;
  if (n > 1 && isCold(d.temperature_2m_min[coldest], w.units) && parts.length < 2) {
    parts.push(`Coldest night ${coldest === 1 ? 'tomorrow' : `on ${dayName(w, coldest, true)}`}, ${deg(d.temperature_2m_min[coldest])}.`);
  }
  // keep it to what fits in three lines of the left column: add sentences while they fit
  let rest = '';
  const budget = 84 - soonLine(w).length;   // the rain-soon line, when there is one, comes first
  for (const p of parts) if (lead.length + rest.length + p.length <= budget) rest = rest ? `${rest} ${p}` : p;
  return [lead, rest];
}

// ---------- painting ----------
function paintEmpty(): void {
  const st = wx.status;
  const box = $('wEmpty');
  box.classList.toggle('loading', st === 'loading');
  $('wPill').className = `live ${st === 'error' || st === 'not_found' ? 'bad' : ''}`;
  $('wPillText').textContent = st === 'loading' ? 'Loading' : st === 'error' ? 'Offline' : st === 'not_found' ? 'City not found' : 'Not set up';
  $('wEmptyTitle').textContent = st === 'loading' ? 'Checking the sky…'
    : st === 'not_found' ? 'Hmm, where’s that?'
    : st === 'error' ? (pcDown ? 'Can’t reach your PC' : 'Can’t reach the forecast')
    : 'Where are you?';
  $('wEmptyText').textContent = wx.status === 'not_found' ? `ClaudeOS couldn’t find “${wx.city}” on the map. Pick your city again and it’ll take it from there.`
    : st === 'loading' ? 'Getting the latest forecast. One moment.'
    : st === 'error' ? (pcDown ? 'The tablet can’t reach the computer running ClaudeOS. Check that it’s on and on the same network. It keeps trying every minute, or tap Try again.' : 'The forecast service didn’t answer. Check that the computer running ClaudeOS is connected to the internet. It keeps trying every minute, or tap Try again.')
    : 'Pick your city and ClaudeOS will keep an eye on the sky for you. Only the city is sent to the forecast service.';
  $('wChoose').hidden = st === 'loading' || st === 'error';
  $('wRetry').hidden = st !== 'error';
  const svg = $<SVGSVGElement>('wEmptySvg');
  const mark = st === 'loading' ? '…' : '?';
  if (svg.dataset.key !== mark) { svg.innerHTML = weatherScene('clear', true, 60, 'fahrenheit', { mark }); svg.dataset.key = mark; }
  if (st === 'no_location' || st === 'not_found') $('wPlace').textContent = 'Set city';
  $('wPlaceBtn').classList.toggle('unset', st === 'no_location' || st === 'not_found');
  // without a forecast we don't know which city it's for, so don't claim one
  $('wPlaceBtn').style.visibility = st === 'loading' || st === 'error' ? 'hidden' : '';
  ctx.header.icon.innerHTML = icon(2, true, { blob: true });
  ctx.setRail({ icon: icon(2, true), label: 'Weather' });
}

/** The days' lo–hi ranges on one shared scale, in clay that deepens toward the warm end of the scale. */
function paintWeek(w: WeatherOk): void {
  const d = w.daily, n = Math.min(DAYS, d.time.length);
  const lo = Math.min(...d.temperature_2m_min.slice(0, n)), hi = Math.max(...d.temperature_2m_max.slice(0, n));
  const span = Math.max(1, hi - lo);
  const pct = (t: number) => Math.min(100, Math.max(0, (t - lo) / span * 100));
  const tint = (t: number) => `color-mix(in oklab, var(--text) ${r(30 + pct(t) * .6)}%, var(--track))`;   // ink, not clay: clay is for attention
  $('wDays').innerHTML = Array.from({ length: n }, (_, k) => {
    const a = d.temperature_2m_min[k], b = d.temperature_2m_max[k], pp = d.precipitation_probability_max[k] ?? 0;
    const on = (sel.t === 'day' && sel.d === k) || (sel.t === 'hour' && sel.strip === k);
    const now = k === 0 ? `<b style="left:${pct(w.current.temperature_2m).toFixed(1)}%"></b>` : '';
    return `<button class="drow${on ? ' sel' : ''}" data-d="${k}" aria-label="${esc(dayName(w, k, true))}">`
      + `<span class="dn">${dayName(w, k)}</span>${icon(d.weather_code[k], true)}`
      + `<span class="pp num">${pp >= 20 ? `${pp}%` : ''}</span><span class="lo num">${deg(a)}</span>`
      + `<span class="tbar"><i style="left:${pct(a).toFixed(1)}%;width:${Math.max(0, pct(b) - pct(a)).toFixed(1)}%;`
      + `background:linear-gradient(90deg, ${tint(a)}, ${tint(b)})"></i>${now}</span>`
      + `<span class="hi num">${deg(b)}</span></button>`;
  }).join('');
}

/** A smooth curve through points (Catmull-Rom as cubic Béziers), not overshooting much at the ends. */
function curve(pts: [number, number][]): string {
  const f = (n: number) => n.toFixed(1);
  let s = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    s += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return s;
}

/** The hourly strip: tappable columns (icon, time, rain chance) under one temperature curve. */
function paintHours(w: WeatherOk, v: View): void {
  const h = w.hourly, box = $('wHours');
  const selI = sel.t === 'hour' ? sel.i : -1;
  box.innerHTML = v.hours.map((i, j) => {
    const pp = h.precipitation_probability[i] ?? 0;
    const newDay = j > 0 && h.time[i].slice(0, 10) !== h.time[v.hours[j - 1]].slice(0, 10);
    const label = j === 0 && v.firstIsNow ? '<b>Now</b>'
      : newDay ? `<b>${localDate(h.time[i].slice(0, 10)).toLocaleDateString([], { weekday: 'short' })}</b> ${localHour(h.time[i])}`
      : localHour(h.time[i]);
    return `<button class="hcol${i === selI ? ' sel' : ''}" data-i="${i}"><span class="hsp"></span>${icon(h.weather_code[i], !!h.is_day[i])}`
      + `<span class="ht num">${label}</span><span class="hp num">${pp >= 20 ? `${pp}%` : ''}</span></button>`;
  }).join('');

  // the chart sits over the empty top of the columns
  const W = box.clientWidth, sp = box.querySelector<HTMLElement>('.hsp');
  const H = sp?.offsetHeight || 0;
  if (!W || H < 30 || !v.hours.length) return;
  const n = v.hours.length, cw = W / COLS;
  const temps = v.hours.map(i => h.temperature_2m[i]);
  const tMin = Math.min(...temps), tMax = Math.max(...temps);
  const range = Math.max(tMax - tMin, w.units === 'celsius' ? 4 : 8);   // a flat day should look flat
  const pad = (range - (tMax - tMin)) / 2;
  const barMax = Math.min(24, H * .3), top = 24, bottom = H - 10;
  const y = (t: number) => bottom - (t - tMin + pad) / range * (bottom - top);
  const pts = temps.map((t, j) => [cw * (j + .5), y(t)] as [number, number]);
  const line = curve(pts);
  const area = `${line}L${pts[n - 1][0].toFixed(1)} ${H}L${pts[0][0].toFixed(1)} ${H}Z`;

  let bars = '', marks = '', labels = '', days = '';
  v.hours.forEach((i, j) => {
    const pp = h.precipitation_probability[i] ?? 0, [x, py] = pts[j], on = i === selI;
    if (pp >= 5) {
      const bh = Math.max(3, pp / 100 * barMax);
      bars += `<rect x="${(x - 9).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="18" height="${bh.toFixed(1)}" rx="3"/>`;
    }
    marks += on
      ? `<circle cx="${x.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="var(--text)" stroke="var(--card)" stroke-width="2"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="var(--ic-bg, var(--bg))" stroke="var(--text)" stroke-width="2"/>`;
    labels += `<text class="htemp${selI >= 0 && !on ? ' dim' : ''}" x="${x.toFixed(1)}" y="${(py - 11).toFixed(1)}">${deg(temps[j])}</text>`;
    if (j > 0 && h.time[i].slice(0, 10) !== h.time[v.hours[j - 1]].slice(0, 10)) {
      const dx = (cw * j).toFixed(1);
      days += `<line x1="${dx}" y1="4" x2="${dx}" y2="${H + 46}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>`;
    }
  });
  box.insertAdjacentHTML('beforeend', `<svg class="hchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs><linearGradient id="wArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--text)" stop-opacity=".10"/><stop offset="1" stop-color="var(--text)" stop-opacity="0"/></linearGradient></defs>
      ${days}<g fill="var(--blue)" opacity=".35">${bars}</g>
      <path d="${area}" fill="url(#wArea)"/>
      <path d="${line}" fill="none" stroke="var(--text)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${marks}${labels}</svg>`);
}

function renderWx(): void {
  const picking = $('wPick').classList.contains('on');
  $('wx').style.display = isOk(wx) && !picking ? '' : 'none';
  $('wEmpty').style.display = isOk(wx) || picking ? 'none' : '';
  if (!isOk(wx)) { paintEmpty(); return; }
  const w = wx, v = view(w), c = w.current;
  const updated = new Date(w.updated);
  const stale = offline || Date.now() - updated.getTime() > STALE_MS;

  // header
  $('wPill').className = `live ${stale ? 'bad' : 'ok'}`;
  $('wPillText').textContent = stale ? `Offline · ${whenText(updated)}` : `Updated ${whenText(updated)}`;
  $('wPlace').textContent = w.place || 'Your city';
  $('wPlaceBtn').classList.remove('unset');
  $('wPlaceBtn').style.visibility = '';
  ctx.header.icon.innerHTML = icon(c.weather_code, !!c.is_day, { blob: true });

  // left: the big number and the sentence
  $('wKick').textContent = v.kicker;
  $('wBack').hidden = sel.t === 'now';
  const unit = w.units === 'celsius' ? 'C' : 'F';
  // the unit always shows (tapping the number switches it), then the day's low when there is one
  $('wTemp').innerHTML = `${deg(v.temp)}<small>${unit}</small>${v.lo != null ? `<small class="lo">/ ${deg(v.lo)}</small>` : ''}`;
  const tapHint = $('wTapHint');
  tapHint.hidden = store.get(TAP_KEY) === '1';
  tapHint.textContent = `tap for °${w.units === 'celsius' ? 'F' : 'C'}`;
  $('wFacts').textContent = v.facts;
  $('wSummary').innerHTML = `${v.alert ? `<span class="alert">${esc(v.alert)}</span> ` : ''}${esc(v.lead)}${v.rest ? ` <em>${esc(v.rest)}</em>` : ''}`;
  $('wNote').textContent = v.note;
  // air and pollen are current conditions: the lines stay out when the API sent no value
  const air = airLine(w.air), pollen = pollenLine(w.air);
  $('wAir').textContent = air;
  $('wAir').hidden = !air;
  $('wPollen').textContent = pollen;
  $('wPollen').hidden = !pollen;

  // centre: the condition and the critter
  $('wCondIcon').innerHTML = icon(v.code, v.day, { blob: true });
  $('wCond').textContent = v.cond;
  $('wCondSub').textContent = v.condSub;
  const k = kindOf(v.code), key = `${k}|${v.day}|${r(v.temp)}|${w.units}|${v.windy}`;
  const svg = $<SVGSVGElement>('wSvg');
  if (svg.dataset.key !== key) { svg.innerHTML = weatherScene(k, v.day, r(v.temp), w.units, { windy: v.windy }); svg.dataset.key = key; }

  // right: the week; bottom: the hours
  paintWeek(w);
  $('wHoursTitle').textContent = v.hoursTitle;
  $('wSrc').textContent = 'Forecast from Open-Meteo';
  paintHours(w, v);

  ctx.setRail({ icon: icon(c.weather_code, !!c.is_day), label: deg(c.temperature_2m) });
}

function select(s: Selection): void {
  sel = s;
  tipIndex = 0;
  clearTimeout(selTimer);
  if (s.t !== 'now') selTimer = window.setTimeout(() => select({ t: 'now' }), BACK_TO_NOW_MS);
  renderWx();
}

async function loadWx(): Promise<void> {
  clearTimeout(retryTimer);
  try {
    const loc = params.get('lat') ? `?${new URLSearchParams({ lat: params.get('lat')!, lon: params.get('lon') || '0', place: params.get('place') || 'Preview' })}` : '';
    const next = await getJson<Weather>(`/api/weather/forecast${loc}`);
    pcDown = false;
    if (next.status === 'error' && isOk(wx)) offline = true;   // keep the forecast we have
    else { wx = next; offline = false; }
    // design previews: ?wxdemo=<WMO code>[&night][&windy], ?wxstate=loading|error|offline|not_found|no_location
    const demo = params.get('wxdemo');
    if (demo && isOk(wx)) {
      wx.current.weather_code = +demo; wx.current.is_day = params.has('night') ? 0 : 1;
      if (params.has('windy')) wx.current.wind_speed_10m = 50;
    }
    const st = params.get('wxstate');
    if (st === 'offline') offline = isOk(wx);
    else if (st === 'not_found') wx = { status: 'not_found', city: 'Atlantis' };
    else if (st === 'loading' || st === 'error' || st === 'no_location') wx = { status: st };
  } catch {
    pcDown = true;
    if (isOk(wx)) offline = true; else wx = { status: 'error' };
  }
  wxAt = Date.now();
  if (offline || wx.status === 'error') retryTimer = window.setTimeout(loadWx, RETRY_MS);
  renderWx();
}

/** The PC answered but did not save the place or unit (the PC is up; this is not a network failure). */
class NotSaved extends Error {}

async function sendLocation(body: LocationUpdate): Promise<void> {
  const d = await postJson<Weather>('/api/weather/location', body);
  // the PC answered, so it is up; an error below comes from the forecast service, not the PC
  pcDown = false;
  // the PC did not save it: throw, so the caller reverts the unit and says so
  if (d.status === 'error' && d.saved === false) throw new NotSaved(d.error ?? 'not saved');
  if (d.status === 'ok' || d.status === 'no_location') { wx = d; wxAt = Date.now(); offline = false; }
  // the place or units were saved, but the forecast failed: show that, and read it again soon (as loadWx does)
  else if (d.status === 'error') { wx = d; wxAt = Date.now(); offline = false; clearTimeout(retryTimer); retryTimer = window.setTimeout(loadWx, RETRY_MS); }
}

// ---------- city picker (uses the shared keyboard) ----------
let pickUnits: Units = 'fahrenheit';
let places: Place[] = [];
let retryPick: (() => void) | null = null;
let searchTimer: number | undefined, searchSeq = 0;

function paintUnits(): void {
  $('wUnits').querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', b.dataset.u === pickUnits));
}

function paintPlaces(hint = '', retry: (() => void) | null = null): void {
  retryPick = retry;
  $('wRes').innerHTML = places.length
    ? places.slice(0, 6).map((p, i) => `<button data-i="${i}">${esc(p.name)}<span>${esc([p.region, p.country].filter(Boolean).join(', '))}</span></button>`).join('')
    : `<div class="hint">${hint}</div>${retry ? '<button data-retry="1">Try again</button>' : ''}`;
}

async function searchPlaces(q: string): Promise<void> {
  const seq = ++searchSeq;
  try {
    const res = await getJson<PlacesResponse>(`/api/weather/places?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;   // a newer search already started
    places = res.results || [];
    paintPlaces(res.status === 'ok'
      ? `Nothing called <em>${esc(q)}</em> yet. Check the spelling, or try a bigger town nearby.`
      : 'City search can’t reach the forecast service right now. Try again in a moment.', res.status === 'ok' ? null : () => void searchPlaces(q));
  } catch {
    if (seq === searchSeq) { places = []; paintPlaces('City search can’t reach ClaudeOS’s server right now. Try again in a moment.', () => void searchPlaces(q)); }
  }
}

async function choosePlace(p: Place): Promise<void> {
  places = [];
  paintPlaces(`Saving <em>${esc(p.name)}</em>…`);
  try {
    await sendLocation({ lat: p.lat, lon: p.lon, place: p.name, units: pickUnits });
    report('location');
  } catch (err) {
    if (err instanceof NotSaved) { paintPlaces(`Your PC couldn’t save <em>${esc(p.name)}</em>. Try again.`, () => void choosePlace(p)); return; }
    pcDown = true;
    paintPlaces(`Couldn’t reach your PC, so <em>${esc(p.name)}</em> isn’t saved. Try again.`, () => void choosePlace(p));
    return;
  }
  sel = { t: 'now' };
  Keyboard.close('chosen');
  appSettingsChanged();
  dispatchEvent(new CustomEvent('hub:weather'));   // Home and the ambient screen show the new place at once
}

function openPicker(): void {
  pickUnits = isOk(wx) ? wx.units : pickUnits;
  paintUnits();
  places = [];
  paintPlaces('Start typing your city. Only the city you pick is sent to the forecast service.');
  $('wPick').classList.add('on');
  renderWx();
  Keyboard.open({
    placeholder: 'Search for a city', done: 'Search', autoCap: true, max: 40,
    onChange: q => {
      clearTimeout(searchTimer);
      if (q.trim().length < 2) { places = []; searchSeq++; paintPlaces('Start typing your city.'); return; }
      if (!places.length) paintPlaces('Searching…');
      searchTimer = window.setTimeout(() => searchPlaces(q.trim()), 350);
    },
    onDone: () => {
      if (places[0]) { void choosePlace(places[0]); return false; }
    },
    onClose: () => { $('wPick').classList.remove('on'); renderWx(); },
  });
}

async function setUnits(u: Units): Promise<void> {
  const prev = pickUnits;
  pickUnits = u;
  paintUnits();
  // Save the unit even when no forecast is loaded (no city yet, or an error): the PC keeps it in meter-config.json.
  try { await sendLocation({ units: u }); dispatchEvent(new CustomEvent('hub:weather')); }   // Home and the ambient screen show the new unit at once
  catch (err) {
    const notSaved = err instanceof NotSaved;
    if (!notSaved) pcDown = true;
    notify(notSaved
      ? { title: 'Couldn’t save', body: 'Your PC couldn’t save the new temperature unit. Try again.', app: 'weather' }
      : { title: 'Couldn’t reach your PC', body: 'The new temperature unit isn’t saved. Try again.', app: 'weather' }, false);
    report('wx-units-failed'); pickUnits = prev; paintUnits();
  }
  renderWx();
  appSettingsChanged();   // Settings → Apps → Weather shows the new units
}

// ---------- wiring ----------
/** Settings → Apps → Weather. */
function registerSettings(): void {
  registerAppSettings({
    app: manifest.id, name: manifest.name, icon: app.icon, blurb: 'Temperature units and your location',
    rows: () => [
      {
        kind: 'choice', id: 'units', title: 'Temperature', detail: 'Used everywhere ClaudeOS shows the weather.',
        options: [{ value: 'celsius', label: '°C' }, { value: 'fahrenheit', label: '°F' }],
        get: () => (isOk(wx) ? wx.units : pickUnits),
        set: async v => { await setUnits(v as Units); },
      },
      {
        kind: 'action', id: 'place', title: 'Location', detail: 'Only the city you pick is sent to the forecast service.',
        value: () => (isOk(wx) && wx.place) || 'Not set', label: 'Change',
        run: () => { openApp(manifest.id); openPicker(); },
      },
      { kind: 'info', id: 'source', title: 'Forecast', value: () => 'Open-Meteo' },
    ],
  });
}

function mount(context: AppContext): void {
  ctx = context;
  registerSettings();
  $('wHours').addEventListener('click', e => {
    const col = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (!col || !isOk(wx)) return;
    const i = +col.dataset.i!;
    const strip = sel.t === 'day' ? sel.d : sel.t === 'hour' ? sel.strip : null;
    select(sel.t === 'hour' && sel.i === i ? (strip == null ? { t: 'now' } : { t: 'day', d: strip }) : { t: 'hour', i, strip });
    report('wx-hour');
  });
  $('wDays').addEventListener('click', e => {
    const row = (e.target as Element).closest<HTMLElement>('[data-d]');
    if (!row) return;
    const d = +row.dataset.d!;
    select(sel.t === 'day' && sel.d === d ? { t: 'now' } : { t: 'day', d });
    report('wx-day');
  });
  $('wBack').addEventListener('click', () => { select({ t: 'now' }); report('wx-now'); });
  $('wTemp').addEventListener('click', () => {
    if (!isOk(wx)) return;
    store.set(TAP_KEY, '1');
    $('wTapHint').hidden = true;
    void setUnits(wx.units === 'fahrenheit' ? 'celsius' : 'fahrenheit');
    report('wx-units');
  });
  $('wScene').addEventListener('click', () => {
    replay($('wScene'), 'hop');
    if (isOk(wx)) {
      const lines = [...view(wx).tips, QUIPS[Math.floor(Math.random() * QUIPS.length)]];
      const line = lines[tipIndex++ % lines.length];
      inkSay($('wSay'), line);
      critterSpeak(line);
    }
    report('weather-critter');
  });
  $('wRes').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (b?.dataset.retry) { retryPick?.(); return; }
    if (b) void choosePlace(places[+b.dataset.i!]);
  });
  $('wUnits').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (b) void setUnits(b.dataset.u as Units);
  });
  $('wPlaceBtn').addEventListener('click', () => { openPicker(); report('place'); });
  $('wChoose').addEventListener('click', () => { openPicker(); report('choose-city'); });
  $('wRetry').addEventListener('click', () => { wx = { status: 'loading' }; renderWx(); void loadWx(); report('wx-retry'); });
  // the strip is drawn to the stage's real size, which changes when the screen does
  let raf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderWx); });

  renderWx();
  void loadWx();
  // every 10 minutes while the page is on screen; coming back to it refreshes an old forecast (onShow)
  setInterval(() => { if (ctx.isVisible()) void loadWx(); }, REFRESH_MS);
}

const app: HubApp = {
  ...manifest,
  icon: icon(2, true),
  mount,
  onShow() { if (Date.now() - wxAt > 5 * 60e3) void loadWx(); else renderWx(); },
  onHide() { if (sel.t !== 'now') select({ t: 'now' }); },
  onClose() { if (sel.t !== 'now') select({ t: 'now' }); },   // closed in the app switcher: back to now
};
export default app;
