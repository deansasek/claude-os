// Plugins in the mock page (no hub): no skills, connectors or plugins are read from a PC, so the list starts empty.
// Custom MCP servers added in the session are kept until a reload, and can be switched or removed. Discover has no
// marketplace here, and installing needs the Claude Code CLI on the PC, so those answers say so. The shapes are the
// ones in ../api.ts.
import { defineMock } from '../../../core/web/mock-api.ts';
import { MARKETPLACE, type MarketResult, type MarketView, type PluginItem, type PluginsView } from '../api.ts';

const items: PluginItem[] = [];
const view = (): PluginsView => ({ items: items.map(i => ({ ...i })), project: null, probe: null });
const NO_CLI: MarketResult = { ok: false, error: 'no_cli', output: '' };

defineMock({
  'GET /api/settings/plugins': (): PluginsView => view(),
  'POST /api/settings/plugins/toggle': ({ body }): { ok: true } => {
    const b = body as { key?: unknown; on?: unknown } | null;
    const it = items.find(i => i.key === b?.key);
    if (it) it.on = b?.on === true;
    return { ok: true };
  },
  'POST /api/settings/plugins/mcp': ({ body }): { ok: boolean; error?: string } => {
    const b = body as { name?: unknown; type?: unknown; command?: unknown; url?: unknown } | null;
    const name = typeof b?.name === 'string' ? b.name.trim() : '';
    if (!name) return { ok: false, error: 'Give the server a name.' };
    if (items.some(i => i.key === `mcp:${name}`)) return { ok: false, error: 'A server with that name is already there.' };
    const type = b?.type === 'http' || b?.type === 'sse' ? b.type : 'stdio';
    items.push({
      key: `mcp:${name}`, kind: 'mcp', name, subtitle: `Custom MCP · ${type}`, description: 'Added in ClaudeOS on the mock page.',
      source: 'ClaudeOS', detail: [type === 'stdio' ? `Runs: ${String(b?.command ?? '')}` : `Address: ${String(b?.url ?? '')}`],
      status: 'unknown', tools: null, error: null, on: true, custom: true,
    });
    return { ok: true };
  },
  'POST /api/settings/plugins/mcp/remove': ({ body }): { ok: boolean } => {
    const key = `mcp:${String((body as { name?: unknown } | null)?.name ?? '')}`;
    const i = items.findIndex(x => x.key === key && x.custom);
    if (i >= 0) items.splice(i, 1);
    return { ok: i >= 0 };
  },
  'POST /api/settings/plugins/test': (): { ok: boolean; error?: string } => ({ ok: false, error: 'not_running' }),
  'POST /api/settings/plugins/folder': (): { ok: boolean; error?: string } => ({ ok: false, error: 'Folders can’t be added on the mock page.' }),
  'POST /api/settings/plugins/folder/remove': (): { ok: boolean } => ({ ok: false }),
  'GET /api/settings/plugins/market': (): MarketView => ({ marketplace: MARKETPLACE, updatedAt: null, plugins: [], error: 'no_marketplace' }),
  'POST /api/settings/plugins/market/install': (): MarketResult => NO_CLI,
  'POST /api/settings/plugins/market/uninstall': (): MarketResult => NO_CLI,
  'POST /api/settings/plugins/market/refresh': (): MarketResult => NO_CLI,
});
