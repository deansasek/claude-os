// Light/dark: ?theme=system|time|light|dark sets the default; Settings > Appearance (and the control
// centre's Appearance tile) sets the mode; tapping the logo flips it for this screen.
import { params, report, store } from './dom.ts';

type Theme = 'light' | 'dark';
// a mode picked in Settings wins over the URL's ?theme=
let MODE = (store.get('themeMode') || params.get('theme') || 'system').toLowerCase();
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
let override = store.get('themeOverride') as Theme | null;

function autoDark(): boolean {
  if (MODE === 'dark' || MODE === 'light') return MODE === 'dark';
  if (MODE === 'time') { const h = new Date().getHours(); return h >= 19 || h < 7; }
  return darkMQ.matches;
}

export type ThemeMode = 'light' | 'dark' | 'time' | 'system';
/** What Settings shows as chosen: a one-off logo tap counts as that colour. */
export const themeMode = (): ThemeMode => (override || MODE) as ThemeMode;
export function setThemeMode(m: ThemeMode): void {
  MODE = m; override = null;
  store.set('themeMode', m); store.set('themeOverride', null);
  apply();
}

export const currentTheme = (): Theme => (document.documentElement.dataset.theme as Theme) || 'light';

function apply(): void {
  const want: Theme = override || (autoDark() ? 'dark' : 'light');
  if (document.documentElement.dataset.theme !== want) document.documentElement.dataset.theme = want;
}

export function toggleTheme(source: string): void {
  override = currentTheme() === 'dark' ? 'light' : 'dark';
  if (override === (autoDark() ? 'dark' : 'light')) override = null;   // back to automatic
  store.set('themeOverride', override);
  apply();
  report(source);
}

export function initTheme(): void {
  apply();
  darkMQ.addEventListener?.('change', apply);
  setInterval(apply, 60e3);
}
