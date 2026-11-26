// Settings → Plugins: what Claude can use in the sessions ClaudeOS runs (connectors, MCP servers, skills, plugins).
// The list comes from the PC (GET /api/settings/plugins). Switches, adds and removes go back to it. Secrets never
// reach the tablet: env values and headers are only ever shown as a count.
import { esc, getJson, postJson, report } from '../../../core/web/dom.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import { removeRefusal, toggleRefusal, type PluginItem, type PluginKind, type PluginsView } from '../api.ts';
import { enterMarket, initMarket, paintMarket } from './market.ts';

type Tab = 'all' | PluginKind | 'discover';   // 'discover': the Anthropic marketplace (market.ts), in place of the list
type Field = 'name' | 'command' | 'args' | 'url' | 'env' | 'headers' | 'folder';
interface Draft { type: 'stdio' | 'http' | 'sse'; text: Record<Field, string> }
interface Deps { ctx: AppContext; confirm: (title: string, text: string, yes: string, onYes: () => void) => void }

const svg = (d: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const CHEV = svg('<path d="M13 9l7 7-7 7"/>');
/** One generic glyph per kind (no brand marks). */
const GLYPH: Record<PluginKind, string> = {
  connector: svg('<path d="M13 19l-2.5 2.5a4 4 0 0 1-5.7-5.7L9 11.5a4 4 0 0 1 5.7 0M19 13l2.5-2.5a4 4 0 0 1 5.7 5.7L21 20.5a4 4 0 0 1-5.7 0M12 20l8-8"/>'),
  mcp: svg('<path d="M11 4v7M21 4v7M7 11h18v3a9 9 0 0 1-18 0zM16 23v5"/>'),
  skill: svg('<path d="M8 6.5A2.5 2.5 0 0 1 10.5 4H25v19H10.5A2.5 2.5 0 0 0 8 25.5zM8 25.5A2.5 2.5 0 0 0 10.5 28H25"/>'),
  plugin: svg('<path d="M13 6h3.5a2.5 2.5 0 1 1 5 0H25v5.5a2.5 2.5 0 1 1 0 5V26h-5.5a2.5 2.5 0 1 0-5 0H7v-5.5a2.5 2.5 0 1 0 0-5V6z"/>'),
};
const KIND_NAME: Record<PluginKind, string> = { connector: 'Connectors', mcp: 'MCP servers', skill: 'Skills', plugin: 'Plugins' };
const KINDS: PluginKind[] = ['connector', 'mcp', 'skill', 'plugin'];
const FIELDS: Record<Field, { label: string; hint: string; placeholder: string; max: number }> = {
  name: { label: 'Name', hint: 'Letters, numbers, - and _ only. Shown in this list.', placeholder: 'For example notes', max: 40 },
  command: { label: 'Command', hint: 'The program to run, for example npx or node.', placeholder: 'npx', max: 300 },
  args: { label: 'Arguments', hint: 'Separated by spaces. Put a value with spaces in "quotes".', placeholder: '-y @example/server', max: 400 },
  url: { label: 'Address', hint: 'The https:// address of the server.', placeholder: 'https://example.com/mcp', max: 300 },
  env: { label: 'Environment variables', hint: 'KEY=value; KEY=value. Values stay on this PC and are never shown again.', placeholder: 'NAME=value; OTHER=value', max: 600 },
  headers: { label: 'Headers', hint: 'Name=value; Name=value. Values stay on this PC and are never shown again.', placeholder: 'Authorization=value', max: 600 },
  folder: { label: 'Folder', hint: 'The folder with the plugin in it, for example one copied to this PC.', placeholder: 'C:\\Users\\you\\my-plugin', max: 300 },
};
const ERRORS: Record<string, string> = {
  bad_name: 'Use letters, numbers, - and _ for the name (up to 40 characters).',
  name_taken: 'Another server already has that name.',
  bad_command: 'Enter the command to run.',
  bad_url: 'The address should start with https:// or http://.',
  bad_pairs: 'Use KEY=value pairs separated by semicolons.',
  bad_type: 'Choose how the server connects.',
  no_such_folder: 'That folder isn’t on this PC.',
  not_a_plugin: 'That folder doesn’t hold a plugin: it needs a .claude-plugin/plugin.json, or skills, commands or agents.',
  too_many: 'That is as many as ClaudeOS keeps. Remove one first.',
};

let deps!: Deps;
let view: PluginsView | null = null;
let loading = false;
let tab: Tab = 'all';
let filter = '';
let openKey: string | null = null;
let addMode: 'mcp' | 'folder' = 'mcp';
const blankDraft = (): Draft => ({ type: 'stdio', text: { name: '', command: '', args: '', url: '', env: '', headers: '', folder: '' } });
let draft: Draft = blankDraft();

const $ = <T extends Element = HTMLElement>(id: string): T => deps.ctx.$<T>(id);

const titleOf = (i: PluginItem): string => (i.kind === 'connector' ? i.name.replace(/^claude\.ai\s+/, '') : i.name);
/** Connectors and servers that need the user: a sign-in, or a failure. */
const needsAttention = (i: PluginItem): boolean => i.on && (i.kind === 'connector' || i.kind === 'mcp') && (i.status === 'needs-auth' || i.status === 'failed');
const plural = (n: number): string => `${n} tool${n === 1 ? '' : 's'}`;

/** The short status under a row's name. */
function wordOf(i: PluginItem): string {
  if (!i.on) return 'Off';
  switch (i.status) {
    case 'connected': return i.tools ? `Connected · ${plural(i.tools)}` : 'Connected';
    case 'needs-auth': return 'Needs sign-in';
    case 'failed': return 'Failed';
    case 'pending': return 'Starting…';
    case 'missing': return 'Not found on this PC';
    default: return '';
  }
}

/** The status line in the detail sheet. */
function statusLine(i: PluginItem): string {
  if (!i.on) return 'Off for the sessions ClaudeOS runs.';
  switch (i.status) {
    case 'connected': return i.tools ? `Connected · ${plural(i.tools)}.` : 'Connected.';
    case 'needs-auth': return 'Needs sign-in. Reconnect on your PC in Claude Desktop.';
    case 'failed': return `Failed${i.error ? `: ${i.error}` : '.'}`;
    case 'pending': return 'Starting…';
    case 'disabled': return 'Turned off in Claude Code on this PC.';
    case 'missing': return 'Not found on this PC.';
    case 'ok': return 'Found on this PC.';
    default: return view?.probe?.pending ? 'Checking…' : 'Not checked yet. Tap Test to check it now.';
  }
}

function row(i: PluginItem): string {
  const sub = wordOf(i);
  return `<div class="st-row st-plug${i.on ? '' : ' st-plug-off'}">
    <button class="st-plug-open hit" data-plug="${esc(i.key)}">
      <span class="st-app-ic">${GLYPH[i.kind]}</span>
      <div class="st-txt"><b>${esc(titleOf(i))}</b><span>${esc(i.subtitle)}${sub ? ` · ${esc(sub)}` : ''}</span></div>
    </button>
    <button class="st-switch hit" role="switch" aria-checked="${i.on}" aria-label="${esc(titleOf(i))}" data-plugsw="${esc(i.key)}"><i></i></button>
  </div>`;
}

function setTabButtons(): void {
  deps.ctx.root.querySelectorAll<HTMLElement>('[data-seg="plugtab"] button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
}

export function paintPlugins(): void {
  const list = $('stPlugList'), attn = $('stPlugAttn'), note = $('stPlugNote'), again = $('stPlugRecheck');
  $('stPlugFindV').textContent = filter.trim() || 'Filter';
  setTabButtons();
  again.hidden = true;
  $('stPlugSec').classList.toggle('mk-on', tab === 'discover');   // the CSS hides the list and shows Discover
  if (tab === 'discover') { paintMarket(); return; }
  if (!view) {
    attn.innerHTML = '';
    list.innerHTML = `<div class="st-empty">${loading ? 'Checking your connectors, servers, skills and plugins…' : 'Couldn’t reach your PC to check plugins.'}</div>`;
    note.textContent = loading ? 'This can take a few seconds the first time.' : 'Check the connection to your PC, then check again.';
    again.hidden = loading;
    return;
  }
  if (loading) note.textContent = 'Checking again…';
  else if (view.probe?.error) { note.textContent = `Couldn’t check the connectors and servers: ${view.probe.error}`; again.hidden = false; }
  else note.textContent = 'Applies to new sessions and to replies you send from now on. Your Claude Code settings on this PC stay as they are.';

  const q = filter.trim().toLowerCase();
  const shown = view.items.filter(i => (tab === 'all' || i.kind === tab)
    && (!q || `${titleOf(i)} ${i.subtitle} ${i.description}`.toLowerCase().includes(q)));
  const attention = shown.filter(needsAttention);
  const rest = shown.filter(i => !needsAttention(i));
  attn.innerHTML = attention.length ? `<h3 class="label">Needs attention</h3>${attention.map(row).join('')}` : '';
  list.innerHTML = KINDS.map(k => {
    const g = rest.filter(i => i.kind === k);
    return g.length ? `<h3 class="label">${KIND_NAME[k]}</h3>${g.map(row).join('')}` : '';
  }).join('')
    || `<div class="st-empty">${q || tab !== 'all' ? 'Nothing matches that.' : 'Nothing here yet. Connectors, servers, skills and plugins show up here once Claude Code has them on this PC.'}</div>`;
}

const PLUGINS_TIMEOUT_MS = 60_000;   // the PC's own check gives up after about 35 s (server/plugins.ts, PROBE_MS)
/** Fetch the list. `fresh` asks the PC to check the connectors and servers again first (slower). */
export async function loadPlugins(fresh = false): Promise<void> {
  if (loading) return;
  loading = true;
  paintPlugins();
  try { view = await getJson<PluginsView>(`/api/settings/plugins${fresh ? '?fresh=1' : ''}`, PLUGINS_TIMEOUT_MS); }
  catch { /* keep what we had */ }
  finally { loading = false; }
  paintPlugins();
  if (openKey) paintDetail();
}

async function toggle(key: string): Promise<void> {
  const it = view?.items.find(x => x.key === key);
  if (!it) return;
  const on = !it.on;
  it.on = on;
  paintPlugins();
  if (openKey === key) paintDetail();
  const undo = (): void => {
    it.on = !on;
    paintPlugins();
    if (openKey === key) paintDetail();
  };
  let refusal: string;
  try {
    const r = await postJson<{ ok: true } | { ok: false; error: string }>('/api/settings/plugins/toggle', { key, on });
    if (r.ok) { report(`settings:plugins:${it.kind}:${on ? 'on' : 'off'}`); return; }
    refusal = toggleRefusal(r.error);
  } catch {
    undo();
    deps.confirm('Couldn’t change it', 'Check the connection to your PC, then try again.', 'OK', () => {});
    return;
  }
  undo();
  deps.confirm('Couldn’t change it', refusal, 'OK', () => {});
}

// ---------- the detail sheet ----------
function paintDetail(): void {
  const it = view?.items.find(x => x.key === openKey);
  if (!it) { $('stPlugSheet').hidden = true; openKey = null; return; }
  $('stPlugIc').innerHTML = GLYPH[it.kind];
  $('stPlugTitle').textContent = titleOf(it);
  $('stPlugSub').textContent = it.subtitle;
  const fallback = it.kind === 'skill' ? 'A skill Claude uses when a task calls for it.'
    : it.kind === 'plugin' ? 'A Claude Code plugin.'
    : it.kind === 'connector' ? 'A claude.ai connector, signed in through your Claude account.'
    : 'An MCP server Claude can use for tools.';
  $('stPlugDesc').textContent = it.description || fallback;
  $('stPlugFacts').innerHTML = [...it.detail, `Source: ${it.source}`].map(d => `<li>${esc(d)}</li>`).join('');
  const status = $('stPlugStatus');
  status.textContent = statusLine(it);
  status.classList.toggle('st-err', it.on && it.status === 'failed');
  $('stPlugSwitch').setAttribute('aria-checked', String(it.on));
  $('stPlugTest').hidden = !(it.kind === 'mcp' || it.kind === 'connector') || !it.on;
  $('stPlugRemove').hidden = !it.custom;
}

async function testOne(): Promise<void> {
  const it = view?.items.find(x => x.key === openKey);
  if (!it) return;
  $('stPlugStatus').textContent = 'Checking…';
  try {
    const r = await postJson<{ ok: boolean; error?: string | null }>('/api/settings/plugins/test', { name: it.name });
    if (!r.ok) {
      $('stPlugStatus').textContent = r.error === 'no_such_server' ? 'ClaudeOS can’t check this one from here.'
        : `Couldn’t check it${r.error ? `: ${r.error}` : '.'}`;
      return;
    }
    report('settings:plugins:test');
  } catch {
    $('stPlugStatus').textContent = 'Check the connection to your PC, then try again.';
    return;
  }
  await loadPlugins(false);
}

function closeDetail(): void {
  openKey = null;
  $('stPlugSheet').hidden = true;
}

function removeOpen(): void {
  const it = view?.items.find(x => x.key === openKey);
  if (!it || !it.custom) return;
  const isFolder = it.key.startsWith('plugin:path:');
  closeDetail();   // the confirm sheet sits under this one, so this one closes first
  deps.confirm(isFolder ? 'Remove this folder?' : 'Remove this server?',
    `${titleOf(it)} is taken off the sessions ClaudeOS runs. Your Claude Code settings on this PC are not changed.`, 'Remove',
    () => { void removeItem(it, isFolder); });
}

async function removeItem(it: PluginItem, isFolder: boolean): Promise<void> {
  let r: { ok: boolean };
  try {
    r = isFolder
      ? await postJson<{ ok: boolean }>('/api/settings/plugins/folder/remove', { path: it.key.slice('plugin:path:'.length) })
      : await postJson<{ ok: boolean }>('/api/settings/plugins/mcp/remove', { name: it.name });
  } catch {
    deps.confirm('Couldn’t remove it', 'Check the connection to your PC, then try again.', 'OK', () => {});
    return;
  }
  if (!r.ok) {
    // The PC no longer lists it: say so, and reload so the stale row goes.
    deps.confirm('Couldn’t remove it', removeRefusal(), 'OK', () => {});
    await loadPlugins(true);
    return;
  }
  report('settings:plugins:remove');
  await loadPlugins(true);
}

// ---------- the add sheet ----------
function openAdd(mode: 'mcp' | 'folder'): void {
  addMode = mode;
  draft = blankDraft();
  $('stPlugAddTitle').textContent = mode === 'mcp' ? 'Add an MCP server' : 'Add a plugin folder';
  $('stPlugAddIntro').textContent = mode === 'mcp'
    ? 'For the sessions ClaudeOS runs only. Your Claude Code settings on this PC are not changed.'
    : 'A folder with a Claude Code plugin in it, used only by the sessions ClaudeOS runs.';
  $('stPlugFormNote').hidden = true;
  paintAddForm();
  $('stPlugAdd').hidden = false;
}

function paintAddForm(): void {
  const field = (id: Field, shown: string) => {
    const f = FIELDS[id];
    return `<button class="st-row st-field hit" data-field="${id}">
      <div class="st-txt"><b>${esc(f.label)}</b><span>${esc(f.hint)}</span></div>
      <span class="st-val${shown && shown !== 'Not set' ? '' : ' st-unset'}">${esc(shown || 'Not set')}</span>
      <span class="st-chev">${CHEV}</span></button>`;
  };
  const count = (s: string): string => {
    const n = s.split(';').filter(x => x.trim()).length;
    return n ? `${n} set` : 'Not set';
  };
  const t = draft.text;
  if (addMode === 'folder') {
    $('stPlugForm').innerHTML = field('folder', t.folder);
    return;
  }
  const seg = (v: Draft['type'], label: string) => `<button class="hit${draft.type === v ? ' on' : ''}" data-v="${v}">${label}</button>`;
  $('stPlugForm').innerHTML = field('name', t.name)
    + `<div class="st-plug-typerow"><span>Connects with</span><div class="st-seg" data-seg="plugtype">${seg('stdio', 'A program')}${seg('http', 'Web (http)')}${seg('sse', 'Web (sse)')}</div></div>`
    + (draft.type === 'stdio'
      ? field('command', t.command) + field('args', t.args) + field('env', count(t.env))
      : field('url', t.url) + field('headers', count(t.headers)));
}

function editField(id: Field): void {
  const f = FIELDS[id];
  Keyboard.open({
    value: draft.text[id], placeholder: f.placeholder, autoCap: false, max: f.max,
    onDone: text => { draft.text[id] = text.trim(); paintAddForm(); },
  });
}

function showFormError(code: string): void {
  const note = $('stPlugFormNote');
  note.textContent = ERRORS[code] ?? 'Couldn’t add it. Check the connection to your PC, then try again.';
  note.hidden = false;
}

async function saveAdd(): Promise<void> {
  const t = draft.text;
  let r: { ok: boolean; error?: string };
  try {
    r = addMode === 'folder'
      ? await postJson<{ ok: boolean; error?: string }>('/api/settings/plugins/folder', { path: t.folder })
      : await postJson<{ ok: boolean; error?: string }>('/api/settings/plugins/mcp', {
        name: t.name, type: draft.type, command: t.command, args: t.args, url: t.url, env: t.env, headers: t.headers,
      });
  } catch { showFormError('network'); return; }
  if (!r.ok) { showFormError(r.error ?? ''); return; }
  $('stPlugAdd').hidden = true;
  report(addMode === 'folder' ? 'settings:plugins:folder:add' : 'settings:plugins:mcp:add');
  await loadPlugins(true);
}

// ---------- wiring ----------
/** Segmented controls on this page: the tabs, and the connection type in the add sheet. True when it was one of ours. */
export function handlePluginSeg(id: string, v: string): boolean {
  if (id === 'plugtab') { tab = v as Tab; paintPlugins(); if (tab === 'discover') enterMarket(); return true; }
  if (id === 'plugtype') { draft.type = v as Draft['type']; paintAddForm(); return true; }
  return false;
}

export function initPlugins(d: Deps): void {
  deps = d;
  // a plugin installed from Discover shows in the list at once (the file read is quick; the live check is not needed)
  initMarket({ ctx: d.ctx, glyph: GLYPH, onInstalled: () => { void loadPlugins(false); } });
  const onList = (e: Event) => {
    const t = e.target as HTMLElement;
    const sw = t.closest<HTMLElement>('[data-plugsw]');
    if (sw) { void toggle(sw.dataset.plugsw!); return; }
    const open = t.closest<HTMLElement>('[data-plug]');
    if (open) { openKey = open.dataset.plug!; paintDetail(); $('stPlugSheet').hidden = false; }
  };
  $('stPlugList').addEventListener('click', onList);
  $('stPlugAttn').addEventListener('click', onList);
  $('stPlugFind').addEventListener('click', () => Keyboard.open({
    value: filter, placeholder: 'Filter plugins', autoCap: false, max: 40,
    onChange: text => { filter = text; paintPlugins(); },
    onDone: text => { filter = text; paintPlugins(); },
  }));
  $('stPlugSwitch').addEventListener('click', () => { if (openKey) void toggle(openKey); });
  $('stPlugTest').addEventListener('click', () => void testOne());
  $('stPlugRemove').addEventListener('click', removeOpen);
  $('stPlugClose').addEventListener('click', closeDetail);
  $('stPlugSheet').addEventListener('click', e => { if (e.target === $('stPlugSheet')) closeDetail(); });
  $('stPlugAddMcp').addEventListener('click', () => openAdd('mcp'));
  $('stPlugAddFolder').addEventListener('click', () => openAdd('folder'));
  $('stPlugRecheck').addEventListener('click', () => void loadPlugins(true));
  $('stPlugForm').addEventListener('click', e => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-field]');
    if (f) editField(f.dataset.field as Field);
  });
  $('stPlugAddCancel').addEventListener('click', () => { $('stPlugAdd').hidden = true; });
  $('stPlugAddSave').addEventListener('click', () => void saveAdd());
  $('stPlugAdd').addEventListener('click', e => { if (e.target === $('stPlugAdd')) $('stPlugAdd').hidden = true; });
}
