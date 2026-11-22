// Home Assistant app routes (all under /api/home-assistant/):
//   GET  status     configured, demo, connected, the address (the token only masked)
//   POST config     {address?, token?, demo?}   saved in .ha-config.json on the PC
//   POST test       calls Home Assistant's /api/ with the token: ok, or why not
//   GET  entities   the allowlisted (Claude) devices and their state (the demo house in demo mode)
//   GET  devices    every device that may be shown (lights, switches, fans, media players, thermostats; covers and
//                   sensors read-only), with its Claude allowlist flag and whether it is on the dashboard
//   POST allow      {entity_id, allowed}   Claude's allowlist; the only thing that lets Claude control a device
//   POST toggle     {entity_id, on?, voice?}   a tile tap: a light, switch, media player, fan or thermostat on the dashboard;
//                   with voice: true (a voice command) only on/off for a light, switch, fan or media player
//   GET  layout     the dashboard: {layout: {rooms, other, names}, entities: the state of each device on it}
//   POST layout     {layout} (or the layout itself): replaces it; cleaned and saved in .ha-layout.json
//   POST dashboard  {entity_id, on, room?}   add one device to the dashboard (into a room, else Other), or take it off
//   GET  scenes     every scene Home Assistant reports (the demo scenes in demo mode), and the Home screen's picks
//   POST scene      {entity_id}   activate one scene (scene.turn_on); only domain "scene", only one on the dashboard
//                   or on the Home screen
//   POST home-scenes {entity_id, on}   put a scene on the Home screen's quick actions (up to 3), or take it off
import type { ServerApp } from '../../../core/server/app.ts';
import type { HaConfigUpdate } from '../api.ts';
import { manifest } from '../manifest.ts';
import { activateScene, dashboard, devices, entities, saveConfig, saveLayout, scenes, setAllowed, setDashboard, setHomeScene, status, test, toggle } from './ha.ts';

const LAYOUT_MAX_BYTES = 128 * 1024;

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'status', handle: () => status() },
    {
      method: 'POST', path: 'config', handle: ({ body }) => {
        const b = (body ?? {}) as Record<string, unknown>;
        const u: HaConfigUpdate = {};
        if (typeof b.address === 'string') u.address = b.address;
        if (typeof b.token === 'string') u.token = b.token;
        if (typeof b.demo === 'boolean') u.demo = b.demo;
        return saveConfig(u);
      },
    },
    { method: 'POST', path: 'test', handle: () => test() },
    { method: 'GET', path: 'entities', handle: () => entities() },
    { method: 'GET', path: 'devices', handle: () => devices() },
    { method: 'POST', path: 'allow', handle: ({ body }) => setAllowed(String(body?.entity_id ?? ''), body?.allowed === true) },
    {
      method: 'POST', path: 'toggle', handle: ({ body }) =>
        toggle(String(body?.entity_id ?? ''), typeof body?.on === 'boolean' ? body.on : undefined, body?.voice === true),
    },
    { method: 'GET', path: 'layout', handle: () => dashboard() },
    {
      // a layout can be bigger than the core's 8 KB JSON body, so it is read raw and parsed here
      method: 'POST', path: 'layout', rawMax: LAYOUT_MAX_BYTES, handle: ({ raw }) => {
        let b: unknown = null;
        try { b = JSON.parse((raw ?? Buffer.alloc(0)).toString('utf8') || 'null'); } catch { b = null; }
        const l = b && typeof b === 'object' && 'layout' in b ? (b as { layout: unknown }).layout : b;
        return saveLayout(l);
      },
    },
    {
      method: 'POST', path: 'dashboard', handle: ({ body }) =>
        setDashboard(String(body?.entity_id ?? ''), body?.on === true, typeof body?.room === 'string' ? body.room : undefined),
    },
    { method: 'GET', path: 'scenes', handle: () => scenes() },
    {
      // an entity id only (never a name), and the page's rule: on the dashboard or on the Home screen
      method: 'POST', path: 'scene', handle: ({ body }) => {
        const id = typeof body?.entity_id === 'string' ? body.entity_id : '';
        if (!id.includes('.')) return { ok: false, error: 'Give the scene’s entity id.' };
        return activateScene(id, 'page');
      },
    },
    { method: 'POST', path: 'home-scenes', handle: ({ body }) => setHomeScene(String(body?.entity_id ?? ''), body?.on === true) },
  ],
};
export default app;
