// The composer's session controls, like the Claude desktop app's: model, effort and permission mode
// chips under the composer, their touch menus, and a ring showing how full the context window is.
//
// New sessions start with the defaults you last picked (kept on this tablet). For a session you can
// reply to, a change applies from your next reply; for one you can't (open on the PC…), the chips just
// show what its log says. There is no "Bypass permissions" here: Claude Home never offers it.
//
// Each screen with a composer has its own Controls (createControls): its own menu, anchor and callbacks, so the
// Claude app's session screen and the Browser's Claude panel can both show the chips at once. Each screen names its
// elements with an id prefix ('sv' for the Claude app, 'cl' for the Browser panel), so the ids never clash.
// The functions exported without a screen (closeMenu, initControls) act on the Claude app's own instance.
import { esc, getJson, report, store } from '../../../../core/web/dom.ts';
import { prettyModel } from '../../../../core/web/format.ts';
import { onBack } from '../../../../core/web/system.ts';
import type { ContextUse, HubEffort, HubPermission, ModelChoice, ModelList, SessionSettings } from '../../api.ts';

const EFFORT_LABEL: Record<HubEffort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };
const MODE_INFO: Record<HubPermission, [string, string]> = {
  auto: ['Auto', 'Claude runs on its own and pauses to ask if anything looks unsafe.'],
  default: ['Manual', 'Claude asks before using new tools or opening new sites.'],
  acceptEdits: ['Accept edits', 'Automatically accept all file edits'],
  plan: ['Plan', 'Create a plan before making changes'],
};
const MODE_ORDER: HubPermission[] = ['auto', 'default', 'acceptEdits', 'plan'];
const MODE_ICON: Record<HubPermission, string> = {
  auto: '<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M2.6 4 7.4 8l-4.8 4z"/><path d="M8.6 4 13.4 8l-4.8 4z"/></svg>',   // the double arrow of the Claude composer's Auto
  default: '<svg viewBox="0 0 16 16"><path d="M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7.2V4.2a1 1 0 0 1 2 0v5.3c0 2.5-1.6 4.3-4 4.3-1.7 0-2.7-.8-3.5-2.2L2.6 9.2a1 1 0 0 1 1.7-1z"/></svg>',
  acceptEdits: '<svg viewBox="0 0 16 16"><path d="M10.5 2.8 13.2 5.5 6 12.7l-3.4.7.7-3.4z"/></svg>',
  plan: '<svg viewBox="0 0 16 16"><path d="M6 4h7M6 8h7M6 12h7"/><circle cx="3" cy="4" r=".6"/><circle cx="3" cy="8" r=".6"/><circle cx="3" cy="12" r=".6"/></svg>',
};
const CHECK = '<svg class="cm-check" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>';
const CHEV = '<svg class="cm-chev" viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>';
const BACK = '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>';

/** The element ids a screen's controls use: its prefix plus a name ('sv' → svModel, svMenu...). */
const idsOf = (pre: string) => ({ ctl: `${pre}Ctl`, model: `${pre}Model`, effort: `${pre}Effort`, mode: `${pre}Mode`, ctx: `${pre}Ctx`, ctxTip: `${pre}CtxTip`, menu: `${pre}Menu` });

// ---------- the model list ----------
const FALLBACK: ModelList = {
  source: 'fallback', defaultId: null,
  models: [['claude-opus-5-5', 'Opus 5.5'], ['claude-fable-5-2', 'Fable 5.2'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']]
    .map(([id, label]) => ({ id, label, description: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] as HubEffort[], auto: true, main: true })),
};
let list: ModelList = FALLBACK;
let loading: Promise<void> | null = null;
/** Every screen's controls, told when the model list arrives (their menus show the real models then). */
const listeners = new Set<() => void>();

export function loadModels(): Promise<void> {
  if (list.source === 'sdk') return Promise.resolve();
  loading ||= getJson<ModelList>('/api/claude/models')
    .then(l => { if (l?.models?.length) { list = l; listeners.forEach(f => f()); } })
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
}
const modelOf = (id: string | null): ModelChoice | undefined => list.models.find(m => m.id === (id || list.defaultId));
const modelLabel = (id: string | null): string => {
  const m = modelOf(id);
  return m ? m.label : id ? prettyModel(id.replace(/\[1m\]$/i, '')) : 'Default model';
};

// ---------- what each session runs with ----------
const KEY = { model: 'claude.new.model', effort: 'claude.new.effort', mode: 'claude.new.mode' };
const MODES = new Set<string>(MODE_ORDER);
/** The defaults for a new session: what you last picked here. Manual until you pick something else. */
export function newDefaults(): SessionSettings {
  const mode = store.get(KEY.mode);
  return {
    model: store.get(KEY.model) || null,
    effort: (store.get(KEY.effort) as HubEffort) || null,
    mode: mode && MODES.has(mode) ? mode as HubPermission : 'default',
  };
}
/** Model list for Settings → Apps → Claude (loaded from the SDK when possible). */
export const modelChoices = (): ModelChoice[] => list.models;

// "Hey Claude" can use its own model / effort / mode; '' (unset) means "same as new sessions".
const VKEY = { model: 'claude.voice.model', effort: 'claude.voice.effort', mode: 'claude.voice.mode' };
export const voicePref = (k: keyof SessionSettings): string => store.get(VKEY[k]) || '';
export const setVoicePref = (k: keyof SessionSettings, v: string): void => store.set(VKEY[k], v || null);
export const newPref = (k: keyof SessionSettings): string => store.get(KEY[k]) || '';
export const setNewPref = (k: keyof SessionSettings, v: string): void => store.set(KEY[k], v || null);
/** The folder new sessions start in (Settings → Sessions); '' means the most recent one. */
const FOLDER_KEY = 'claude.new.folder';
export const newFolderPref = (): string => store.get(FOLDER_KEY) || '';
export const setNewFolderPref = (id: string): void => store.set(FOLDER_KEY, id || null);
/** What a spoken "Hey Claude" request runs with. */
export function voiceDefaults(): SessionSettings {
  const base = newDefaults();
  const m = voicePref('model'), e = voicePref('effort'), p = voicePref('mode');
  return {
    model: m === '' ? base.model : m === 'default' ? null : m,
    effort: e === '' ? base.effort : e === 'default' ? null : e as HubEffort,
    mode: p && MODES.has(p) ? p as HubPermission : base.mode,
  };
}

const overrides = new Map<string, Partial<SessionSettings>>();   // picked here for a session, applied with your next reply

/** What a session runs with: what you've picked for it here, over what its log says. */
export function settingsFor(id: string, logged: SessionSettings | undefined): SessionSettings {
  const o = overrides.get(id) || {};
  // once the log has caught up with a pick, the pick isn't needed any more
  if (logged) for (const k of Object.keys(o) as (keyof SessionSettings)[]) if (logged[k] === o[k]) delete o[k];
  const base: SessionSettings = logged || { model: null, effort: null, mode: null };
  return { ...base, ...o };
}
/** What to send with a reply to this session (only what you changed here). */
export const wantFor = (id: string): Partial<SessionSettings> => ({ ...(overrides.get(id) || {}) });

// ---------- painting the chips ----------
export interface ControlsView { settings: SessionSettings; context: ContextUse | null; interactive: boolean; show: boolean }
const tokens = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const ctxText = (c: ContextUse) => `${Math.min(100, Math.round((c.used / c.window) * 100))}% of context used · ${tokens(c.used)} / ${tokens(c.window)}`;
/** The context each screen's ring last showed (per screen, so two screens never share one). */
const ringCtx = new WeakMap<ParentNode, ContextUse | null>();

export function paintControls(root: ParentNode, v: ControlsView, pre = 'sv'): void {
  const I = idsOf(pre);
  const el = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const s = v.settings;
  const box = el(I.ctl);
  box.hidden = !v.show;
  box.classList.toggle('ro', !v.interactive);
  const model = modelOf(s.model);
  // the label sits in a span: the chip is 44px tall for touch, and the span carries the ellipsis (app.css .cp-pick)
  el(I.model).innerHTML = `<span>${esc(modelLabel(s.model))}</span>`;
  const effortless = !!model && model.efforts.length === 0;
  el(I.effort).hidden = effortless || (!v.interactive && !s.effort);
  el(I.effort).innerHTML = `<span>${esc(s.effort ? EFFORT_LABEL[s.effort] : 'Medium')}</span>`;   // the default effort reads as Medium
  const mode = s.mode || 'default';
  el(I.mode).innerHTML = `${MODE_ICON[mode]}<span>${esc(MODE_INFO[mode][0])}</span>`;
  for (const id of [I.model, I.effort, I.mode]) {
    const b = el<HTMLButtonElement>(id);
    b.disabled = !v.interactive;
    b.setAttribute('aria-haspopup', v.interactive ? 'menu' : 'false');
  }
  // the context ring
  ringCtx.set(root, v.context);
  const ring = el(I.ctx);
  ring.hidden = !v.context;
  if (v.context) {
    const f = Math.max(0, Math.min(1, v.context.used / v.context.window));
    const arc = ring.querySelector<SVGCircleElement>('.arc')!;
    arc.style.strokeDasharray = `${(f * 43.98).toFixed(2)} 43.98`;   // 2πr, r = 7
    ring.classList.toggle('warn', f >= 0.85);
    ring.title = ctxText(v.context);
    ring.setAttribute('aria-label', ctxText(v.context));
    if (!el(I.ctxTip).hidden) el(I.ctxTip).textContent = ctxText(v.context);
  } else el(I.ctxTip).hidden = true;
}

// ---------- the menus ----------
type Page = 'model' | 'effort' | 'more' | 'mode';
interface MenuHost { sv: HTMLElement; menu: HTMLElement; current: () => SessionSettings; pick: (change: Partial<SessionSettings>) => void }

const row = (attrs: string, label: string, on: boolean, extra = '', sub = '') =>
  `<button class="cm-row${on ? ' on' : ''}" ${attrs}>${extra}<span class="cm-text"><span class="cm-label">${esc(label)}</span>${sub ? `<span class="cm-sub">${esc(sub)}</span>` : ''}</span>${on ? CHECK : ''}</button>`;

function pageHtml(p: Page, host: MenuHost): string {
  const s = host.current();
  const current = modelOf(s.model)?.id || s.model;
  if (p === 'model') {
    const main = list.models.filter(m => m.main), more = list.models.filter(m => !m.main);
    const shown = main.length ? main : list.models.slice(0, 4);
    const m = modelOf(s.model);
    const efforts = m ? m.efforts : FALLBACK.models[0].efforts;
    let html = shown.map(x => row(`data-model="${esc(x.id)}"`, x.label, x.id === current, '', x.description)).join('');
    if (current && !shown.some(x => x.id === current) && !more.some(x => x.id === current)) html += row(`data-model="${esc(current)}"`, modelLabel(current), true);
    html += '<div class="cm-sep"></div>';
    if (efforts.length) html += `<button class="cm-row nav" data-page="effort"><span class="cm-text"><span class="cm-label">Effort</span></span><span class="cm-val">${esc(s.effort ? EFFORT_LABEL[s.effort] : 'Default')}</span>${CHEV}</button>`;
    if (more.length) html += `<button class="cm-row nav" data-page="more"><span class="cm-text"><span class="cm-label">More models</span></span>${CHEV}</button>`;
    return html;
  }
  if (p === 'more') {
    return `<button class="cm-head" data-page="model">${BACK}More models</button>`
      + list.models.filter(m => !m.main).map(x => row(`data-model="${esc(x.id)}"`, x.label, x.id === current, '', x.description)).join('');
  }
  if (p === 'effort') {
    const efforts = modelOf(s.model)?.efforts || FALLBACK.models[0].efforts;
    return `<button class="cm-head" data-page="model">${BACK}Effort</button>`
      + '<div class="cm-note">Higher effort means more thorough responses, but takes longer and uses your limits faster.</div>'
      + row('data-effort=""', 'Default', !s.effort, '', 'What the model uses unless told otherwise')
      + efforts.map(e => row(`data-effort="${e}"`, EFFORT_LABEL[e], s.effort === e, '', e === 'medium' ? 'Recommended' : '')).join('');
  }
  const autoOk = modelOf(s.model)?.auto !== false;
  const mode = s.mode || 'default';
  return '<div class="cm-title label">Permission mode</div>' + MODE_ORDER.map(m =>
    (m === 'auto' && !autoOk) ? '' : row(`data-mode="${m}"`, MODE_INFO[m][0], mode === m, `<span class="cm-ic">${MODE_ICON[m]}</span>`, MODE_INFO[m][1])).join('');
}

/** One screen's chips and menus. Create one per screen that shows the composer chips. */
export class Controls {
  private host: MenuHost | null = null;
  private openPage: Page | null = null;
  private anchor: HTMLElement | null = null;
  private onModels = (): void => {};

  private place(): void {
    if (!this.host || !this.anchor || !this.openPage) return;
    const { sv, menu } = this.host;
    const sr = sv.getBoundingClientRect(), ar = this.anchor.getBoundingClientRect();
    const k = sr.width / (sv.offsetWidth || sr.width) || 1;   // the stage may be scaled to fit the screen
    const right = (sr.right - ar.right) / k, bottom = (sr.bottom - ar.top) / k + 6;
    menu.style.right = `${Math.max(8, right - 6)}px`;
    menu.style.bottom = `${bottom}px`;
    menu.style.maxHeight = `${Math.max(160, (ar.top - sr.top) / k - 18)}px`;
  }

  private show(p: Page): void {
    if (!this.host) return;
    this.openPage = p;
    this.host.menu.innerHTML = pageHtml(p, this.host);
    this.host.menu.dataset.page = p;
    this.host.menu.hidden = false;
    this.place();
  }

  closeMenu(): void {
    this.openPage = null; this.anchor = null;
    if (this.host) this.host.menu.hidden = true;
  }
  private menuOpen(): boolean { return this.openPage != null; }

  private toggle(from: HTMLElement, p: Page): void {
    if (this.openPage && this.anchor === from) { this.closeMenu(); return; }
    this.anchor = from;
    this.show(p);
    report(`menu-${p}`);
  }

  /** Wire the chips and the menu. `pick` gets each change; `current` says what's showing now. */
  init(root: ParentNode, sv: HTMLElement, current: () => SessionSettings, pick: (c: Partial<SessionSettings>) => void, changed: () => void, pre = 'sv'): void {
    const I = idsOf(pre);
    const el = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    this.host = { sv, menu: el(I.menu), current, pick };
    const host = this.host;
    // Back: the model / effort / mode menu closes first (it is above the session)
    onBack(() => { if (!this.menuOpen()) return false; this.closeMenu(); return true; }, 20);
    this.onModels = changed;
    listeners.add(this.onModels);
    el(I.model).addEventListener('click', () => this.toggle(el(I.model), 'model'));
    el(I.effort).addEventListener('click', () => this.toggle(el(I.effort), 'effort'));
    el(I.mode).addEventListener('click', () => this.toggle(el(I.mode), 'mode'));
    el(I.ctx).addEventListener('click', () => {
      const tip = el(I.ctxTip);
      const c = ringCtx.get(root);
      if (!c) return;
      tip.textContent = ctxText(c);
      tip.hidden = !tip.hidden;
      if (!tip.hidden) window.setTimeout(() => { tip.hidden = true; }, 5000);
    });
    host.menu.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLElement>('button');
      if (!b) return;
      const d = b.dataset;
      if (d.page) { this.show(d.page as Page); return; }
      if (d.model !== undefined) {
        const m = list.models.find(x => x.id === d.model);
        const s = current();
        const change: Partial<SessionSettings> = { model: d.model };
        if (s.effort && m && !m.efforts.includes(s.effort)) change.effort = null;           // that model can't run that effort
        if (s.mode === 'auto' && m && !m.auto) change.mode = 'default';                     // nor Auto mode
        pick(change); report('pick-model'); this.closeMenu(); return;
      }
      if (d.effort !== undefined) { pick({ effort: (d.effort || null) as HubEffort | null }); report('pick-effort'); this.closeMenu(); return; }
      if (d.mode) { pick({ mode: d.mode as HubPermission }); report('pick-mode'); this.closeMenu(); }
    });
    // tap anywhere else to close
    document.addEventListener('pointerdown', e => {
      if (!this.openPage) return;
      const t = e.target as Element;
      if (host.menu.contains(t) || this.anchor?.contains(t)) return;
      this.closeMenu();
    }, true);
    window.addEventListener('resize', () => this.place());
  }
}

/** The Claude app's session screen's controls (the default instance, ids 'sv…'). */
const main = new Controls();
export function closeMenu(): void { main.closeMenu(); }
export function initControls(root: ParentNode, sv: HTMLElement, current: () => SessionSettings, pick: (c: Partial<SessionSettings>) => void, changed: () => void): void {
  main.init(root, sv, current, pick, changed);
}
/** A new set of controls for another screen (the Browser's Claude panel, ids 'cl…'). */
export function createControls(): Controls { return new Controls(); }

/** Remember a pick: as the new-session default, or for this session's next reply. */
export function remember(sessionId: string | null, change: Partial<SessionSettings>): void {
  if (!sessionId) {
    for (const k of Object.keys(change) as (keyof SessionSettings)[]) store.set(KEY[k], (change[k] as string | null) || null);
    return;
  }
  overrides.set(sessionId, { ...(overrides.get(sessionId) || {}), ...change });
}
