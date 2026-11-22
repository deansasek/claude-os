// App settings, the iOS way: each app describes its own settings here, and the Settings app lists every
// app under "Apps" and draws its rows. Apps call `registerAppSettings` from `mount`.
//
//   registerAppSettings({
//     app: 'weather', name: 'Weather', icon, blurb: 'Units and location',
//     rows: () => [
//       { kind: 'choice', id: 'units', title: 'Temperature', options: [{ value: 'celsius', label: '°C' }, …],
//         get: () => units, set: v => setUnits(v) },
//       { kind: 'switch', id: 'chime', title: 'Chime on the hour', get: () => on, set: v => … },
//       { kind: 'action', id: 'place', title: 'Location', value: () => 'Example town', label: 'Change', run: () => … },
//     ],
//   });
//
// `rows` is a function so values are always current; call `appSettingsChanged()` after changing something
// from inside the app so an open Settings page repaints.

interface RowBase { id: string; title: string; detail?: string }
interface ChoiceRow extends RowBase {
  kind: 'choice';
  options: { value: string; label: string }[];
  get(): string;
  set(v: string): void | Promise<void>;
}
interface SwitchRow extends RowBase { kind: 'switch'; get(): boolean; set(v: boolean): void | Promise<void> }
interface ActionRow extends RowBase { kind: 'action'; label: string; value?(): string; run(): void }
interface InfoRow extends RowBase { kind: 'info'; value(): string }
export type SettingRow = ChoiceRow | SwitchRow | ActionRow | InfoRow;

interface AppSettings {
  app: string;            // the app's id
  name: string;
  icon: string;           // rail icon markup
  blurb?: string;         // one line under the app's name in the list
  rows(): SettingRow[];
}

const registry = new Map<string, AppSettings>();
const listeners: (() => void)[] = [];

export function registerAppSettings(s: AppSettings): void {
  registry.set(s.app, s);
  appSettingsChanged();
}

/** Every app that has settings, in registration (rail) order. */
export const appSettings = (): AppSettings[] => [...registry.values()];

export function onAppSettingsChange(fn: () => void): void { listeners.push(fn); }
export function appSettingsChanged(): void { listeners.forEach(f => { try { f(); } catch { /* ignore */ } }); }
