// Settings → Plugins → Discover: the Anthropic plugin marketplace. Browse it, and install or remove a plugin. The PC runs
// the Claude Code CLI for that (server/market.ts); the tablet only shows what it returns. Installs add the plugin to
// every Claude session on this PC, so each one asks first.
import { esc, getJson, postJson, report } from '../../../core/web/dom.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import { MARKETPLACE, markInstalled, type MarketError, type MarketPlugin, type MarketResult, type MarketView, type PluginKind } from '../api.ts';

interface Deps { ctx: AppContext; glyph: Record<PluginKind, string>; onInstalled: () => void }
type Ask = { kind: 'install' | 'remove'; name: string };

const LIST_MAX = 200;
const ERRORS: Record<MarketError, string> = {
  no_marketplace: 'The Anthropic marketplace isn’t set up on this PC yet. In Claude Code on the PC, run: /plugin marketplace add anthropics/claude-plugins-official',
  bad_marketplace: 'That marketplace isn’t one ClaudeOS knows.',
  bad_name: 'That plugin name isn’t valid.',
  not_in_marketplace: 'That plugin isn’t in the marketplace any more. Check for updates, then try again.',
  not_installed: 'That plugin isn’t installed.',
  needs_confirm: 'It needs a setup step that has to be approved in Claude Code on this PC. Approve it there, then try again.',
  no_cli: 'Claude Code isn’t available on this PC.',
  timeout: 'It took longer than two minutes. Check Claude Code on the PC, then try again.',
  failed: 'Claude Code couldn’t finish that.',
  network: 'Check the connection to your PC, then try again.',
};

let deps!: Deps;
let mk: MarketView | null = null;
let stale = false;             // the last read failed and the list on screen is the one we had before
let loading = false;
let checking = false;          // a "Check for updates" is running
let busy: { kind: 'install' | 'remove'; name: string } | null = null;
let filter = '';
let openName: string | null = null;
let ask: Ask | null = null;
let banner: { ok: boolean; text: string } | null = null;
let sheetNote: { ok: boolean; text: string } | null = null;   // the result of the last install or removal, shown in the sheet

const $ = <T extends Element = HTMLElement>(id: string): T => deps.ctx.$<T>(id);
const find = (name: string | null): MarketPlugin | null => (name && mk ? mk.plugins.find(p => p.name === name) ?? null : null);

/** The icon by what the plugin holds: MCP servers, then skills, else the plugin glyph. */
const iconFor = (p: MarketPlugin): PluginKind =>
  (p.parts.some(x => /MCP/.test(x)) ? 'mcp' : p.parts.some(x => /skill/i.test(x)) ? 'skill' : 'plugin');

const haystack = (p: MarketPlugin): string => `${p.name} ${p.description} ${p.category} ${p.author} ${p.keywords.join(' ')}`.toLowerCase();

function whenText(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function row(p: MarketPlugin): string {
  return `<div class="st-row st-plug st-mk-row">
    <button class="st-plug-open hit" data-mk="${esc(p.name)}">
      <span class="st-app-ic">${deps.glyph[iconFor(p)]}</span>
      <div class="st-txt"><b>${esc(p.name)}</b><span>${esc(p.description || p.category || 'A Claude Code plugin.')}</span></div>
      ${p.installed ? '<em class="st-mk-badge">Installed</em>' : ''}
    </button></div>`;
}

function paintBanner(): void {
  const b = $('stMkBanner');
  b.hidden = !banner;
  b.className = `st-mk-banner${banner?.ok ? ' ok' : banner ? ' err' : ''}`;
  b.textContent = banner?.text ?? '';
}

/** The Discover list, its banner and its note. Called whenever the view changes. */
export function paintMarket(): void {
  const list = $('stMkList'), note = $('stPlugNote');
  $('stMkFindV').textContent = filter.trim() || 'Search';
  ($('stMkRefresh') as HTMLButtonElement).disabled = loading || checking || busy !== null;
  paintBanner();
  if (!mk) {
    list.innerHTML = `<div class="st-empty">${loading ? 'Reading the Anthropic marketplace…' : 'Couldn’t reach your PC to read the marketplace. Check the connection, then check again.'}</div>`;
    note.textContent = loading ? 'This can take a moment.' : 'Check the connection to your PC, then try again.';
  } else if (mk.error) {
    list.innerHTML = `<div class="st-empty">${esc(ERRORS.no_marketplace)}</div>`;
    note.textContent = 'Plugins from the Anthropic marketplace show here once it’s set up on the PC.';
  } else {
    const q = filter.trim().toLowerCase();
    const all = mk.plugins.filter(p => !q || haystack(p).includes(q));
    list.innerHTML = all.length
      ? all.slice(0, LIST_MAX).map(row).join('') + (all.length > LIST_MAX ? `<p class="st-note-line">Showing ${LIST_MAX} of ${all.length}. Search to narrow it down.</p>` : '')
      : `<div class="st-empty">${q ? 'Nothing matches that.' : 'The marketplace has no plugins right now.'}</div>`;
    const when = whenText(mk.updatedAt);
    const lead = stale ? 'Couldn’t reach your PC, so this list may be out of date. ' : '';
    note.textContent = `${lead}${when ? `Last updated ${when}. ` : ''}Installing adds a plugin to every Claude session on this PC.`;
  }
  if (openName) paintSheet();
}

function paintSheet(): void {
  const p = find(openName);
  if (!p) { $('stMkSheet').hidden = true; openName = null; return; }
  const installing = busy?.name === p.name && busy.kind === 'install';
  const removing = busy?.name === p.name && busy.kind === 'remove';
  $('stMkIc').innerHTML = deps.glyph[iconFor(p)];
  $('stMkTitle').textContent = p.name;
  $('stMkSub').textContent = [p.author && `By ${p.author}`, p.version && `Version ${p.version}`].filter(Boolean).join(' · ') || 'Anthropic marketplace';
  $('stMkDesc').textContent = p.description || 'A Claude Code plugin.';
  const facts = [
    p.parts.length && `Includes: ${p.parts.join(' · ')}`,
    p.category && `Category: ${p.category}`,
    p.keywords.length && `Keywords: ${p.keywords.join(', ')}`,
    p.from && `Downloaded from ${p.from}`,
    p.homepage && `Homepage: ${p.homepage}`,
    'Source: Anthropic plugin marketplace',
  ].filter(Boolean) as string[];
  $('stMkFacts').innerHTML = facts.map(f => `<li>${esc(f)}</li>`).join('');
  const status = $('stMkStatus');
  if (installing) status.textContent = 'Installing… this can take a minute.';
  else if (removing) status.textContent = 'Removing…';
  else if (sheetNote) status.textContent = sheetNote.text;
  else status.textContent = p.installed
    ? 'Installed on this PC. It’s available in your Claude sessions.'
    : 'Not installed. Install it to use it in your Claude sessions.';
  status.classList.toggle('st-err', !!sheetNote && !sheetNote.ok);
  const install = $('stMkInstall') as HTMLButtonElement, remove = $('stMkRemove') as HTMLButtonElement;
  install.hidden = p.installed;
  install.disabled = busy !== null;
  install.textContent = installing ? 'Installing…' : 'Install';
  remove.hidden = !p.installed;
  remove.disabled = busy !== null;
  remove.textContent = removing ? 'Removing…' : 'Remove';
  $('stMkSheet').hidden = false;
}

function openSheet(name: string): void {
  openName = name;
  sheetNote = null;
  paintSheet();
}

function closeSheet(): void {
  openName = null;
  sheetNote = null;
  $('stMkSheet').hidden = true;
}

/** Fetch the marketplace listing from the PC. Returns true when the list was read. A failed read keeps the list we had, marked stale. */
// the listing read gives up on a PC that does not answer, so the loading flag clears and Discover can be read again
const MARKET_TIMEOUT_MS = 20e3;
async function loadMarket(): Promise<boolean> {
  if (loading) return false;
  loading = true;
  paintMarket();
  let read = false;
  try { mk = await getJson<MarketView>('/api/settings/plugins/market', MARKET_TIMEOUT_MS); stale = false; read = true; }
  catch { stale = mk !== null; }   // keep what we had
  finally { loading = false; }
  paintMarket();
  return read;
}

/** Entering the Discover tab: fetch once, then show what we have. */
export function enterMarket(): void {
  if (!mk && !loading) void loadMarket();
  else paintMarket();
}

const resultText = (kind: 'install' | 'remove', name: string, r: MarketResult): string => {
  if (r.ok) return kind === 'install' ? `${name} is installed. It’s available in your Claude sessions now.` : `${name} is removed.`;
  const detail = r.output.split('\n').filter(Boolean).pop() ?? '';
  const base = ERRORS[r.error ?? 'failed'];
  return detail && r.error === 'failed' ? `${base} ${detail.slice(0, 140)}` : base;
};

// an install, remove or update check runs the Claude CLI on the PC for up to 120 s (server/market.ts), so the tablet waits longer than that
const CHANGE_TIMEOUT_MS = 150e3;
async function post(path: string, body: unknown): Promise<MarketResult> {
  try { return await postJson<MarketResult>(`/api/settings/plugins/market/${path}`, body, CHANGE_TIMEOUT_MS); }
  catch { return { ok: false, error: 'network', output: '' }; }
}

async function runChange(kind: 'install' | 'remove', name: string): Promise<void> {
  busy = { kind, name };
  banner = null;
  sheetNote = null;
  paintMarket();
  const r = await post(kind === 'install' ? 'install' : 'uninstall', { name, marketplace: MARKETPLACE });
  busy = null;
  const text = resultText(kind, name, r);
  banner = { ok: r.ok, text };
  sheetNote = { ok: r.ok, text };
  if (r.ok) report(`settings:plugins:market:${kind}`);
  if (r.ok && mk) mk = markInstalled(mk, name, kind === 'install');   // the badge and buttons follow the result, even if the reload fails
  await loadMarket();   // the installed badge and the sheet's buttons follow the PC
  if (r.ok) deps.onInstalled();
}

function askFirst(kind: 'install' | 'remove', name: string): void {
  ask = { kind, name };
  const install = kind === 'install';
  $('stMkConfirmTitle').textContent = install ? `Install ${name}?` : `Remove ${name}?`;
  $('stMkConfirmText').textContent = install
    ? 'It’ll be available in all your Claude sessions on this PC.'
    : 'It’s taken off this PC’s Claude Code, so your Claude sessions stop using it. Its saved data is removed too.';
  const yes = $('stMkConfirmYes');
  yes.textContent = install ? 'Install' : 'Remove';
  $('stMkConfirm').hidden = false;
}

async function checkForUpdates(): Promise<void> {
  if (checking || busy !== null) return;
  checking = true;
  banner = null;
  paintMarket();
  const r = await post('refresh', {});
  checking = false;
  const reloaded = await loadMarket();
  banner = !r.ok
    ? { ok: false, text: `Couldn’t check for updates. ${ERRORS[r.error ?? 'failed']}` }
    : reloaded
      ? { ok: true, text: 'Checked for updates.' }
      : { ok: false, text: 'Checked, but couldn’t reload the list. Check the connection, then try again.' };
  paintMarket();
}

/** Wiring: the Discover list, its search, the detail sheet, and the confirm sheet. */
export function initMarket(d: Deps): void {
  deps = d;
  $('stMkList').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mk]');
    if (b) openSheet(b.dataset.mk!);
  });
  $('stMkFind').addEventListener('click', () => Keyboard.open({
    value: filter, placeholder: 'Search', autoCap: false, max: 40,
    onChange: text => { filter = text; paintMarket(); },
    onDone: text => { filter = text.trim(); paintMarket(); },
  }));
  $('stMkRefresh').addEventListener('click', () => void checkForUpdates());
  $('stMkInstall').addEventListener('click', () => { if (openName) askFirst('install', openName); });
  $('stMkRemove').addEventListener('click', () => { if (openName) askFirst('remove', openName); });
  $('stMkClose').addEventListener('click', closeSheet);
  $('stMkSheet').addEventListener('click', e => { if (e.target === $('stMkSheet')) closeSheet(); });
  $('stMkConfirmNo').addEventListener('click', () => { ask = null; $('stMkConfirm').hidden = true; });
  $('stMkConfirmYes').addEventListener('click', () => {
    const a = ask;
    ask = null;
    $('stMkConfirm').hidden = true;
    if (a) void runChange(a.kind, a.name);
  });
}
