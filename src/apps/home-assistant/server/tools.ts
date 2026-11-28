// Claude's Home Assistant tools, as one in-process MCP server (claudeos_ha) that turns.ts adds to each session.
// Each call is an ordinary tool call, so it goes through canUseTool (the approval card on the tablet) first.
// The same rules as the page apply (ha.ts): allowlisted devices only, the five safe domains only, no locks,
// alarms, covers, scripts, automations or Home Assistant itself. Scenes: ha_activate_scene calls scene.turn_on on a
// scene only, and only on one the user put on Home (the dashboard or the Home screen's picks), since a real scene may
// set locks or covers. activateScene (ha.ts) enforces that for every caller; the approval card is a second check.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { CONTROL_DOMAINS, isControlDomain } from '../api.ts';
import { activateScene, callService, entities, isDemo, scenes, servicesFor } from './ha.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

/** One device row for ha_list_entities. The unit and the device class (temperature, door, motion) let Claude say °C or °F, or a door. */
export function entityRow(e: { entity_id: string; name: string; domain: string; state: string; current?: number | null; target?: number | null; media?: unknown; unit?: string; deviceClass?: string }) {
  return {
    entity_id: e.entity_id, name: e.name, domain: e.domain, state: e.state,
    ...(e.current != null ? { current_temperature: e.current } : {}), ...(e.target != null ? { target_temperature: e.target } : {}),
    ...(e.unit ? { unit: e.unit } : {}), ...(e.deviceClass ? { device_class: e.deviceClass } : {}),
    ...(e.media ? { media: e.media } : {}),
    services: isControlDomain(e.domain) ? servicesFor(e.domain) : [],
  };
}

export const haServer = createSdkMcpServer({
  name: 'claudeos_ha',
  version: '1.0.0',
  tools: [
    tool('ha_list_entities',
      'List the smart home devices the user lets ClaudeOS control (Home Assistant), with their state. Read-only. '
        + 'Only allowlisted lights, switches, media players, fans, thermostats and sensors are listed; sensor rows give their unit and device class. Says when it is the demo house.',
      {},
      async () => {
        const r = await entities();
        if (r.status !== 'ok') return text(`Couldn’t read Home Assistant: ${r.error ?? 'unknown error'}`, true);
        const rows = r.entities.map(entityRow);
        const head = r.demo ? 'DEMO MODE: these are made-up devices; nothing real is switched.\n' : '';
        const sc = await scenes();
        const tail = sc.status === 'ok' && sc.scenes.length
          ? `\nScenes (set one with ha_activate_scene): ${sc.scenes.map(s => `${s.name} (${s.entity_id})`).join(', ')}` : '';
        return text((rows.length ? head + JSON.stringify(rows, null, 1) : `${head}No devices are allowed yet (Settings > Apps > Home Assistant).`) + tail);
      }),
    tool('ha_call_service',
      'Call a Home Assistant service on one allowlisted device, e.g. light.turn_on on light.kitchen. '
        + `Domains: ${CONTROL_DOMAINS.join(', ')}. Use ha_list_entities first for the ids and the services each allows. `
        + 'temperature is only for climate.set_temperature (5 to 35).',
      {
        domain: z.enum(CONTROL_DOMAINS),
        service: z.string().max(40),
        entity_id: z.string().max(120),
        temperature: z.number().optional(),
      },
      async ({ domain, service, entity_id, temperature }) => {
        const r = await callService(domain, service, entity_id, temperature);
        if (!r.ok) return text(r.error ?? 'That didn’t work.', true);
        const e = r.entity;
        // in the demo house nothing real changes, so the reply says so, as ha_activate_scene does
        const demo = isDemo() ? ' (demo house: nothing real was switched)' : '';
        return text(e ? `Done. ${e.name} (${e.entity_id}) is now ${e.state}${e.target != null ? `, set to ${e.target}${e.unit ?? ''}` : ''}${demo}.` : `Done.${demo}`);
      }),
    tool('ha_activate_scene',
      'Activate one Home Assistant scene (a saved set of device states, e.g. "Movie night"), by its entity id '
        + '(scene.movie_night) or its name. Calls scene.turn_on only; any id that is not a scene is refused, and so is '
        + 'a scene that is not on the Home screen or the Home Assistant dashboard (the user can add it there). '
        + 'If the name is not found, the error lists the scenes there are.',
      { scene: z.string().min(1).max(120).describe('The scene’s entity id (scene.…) or its name') },
      async ({ scene }) => {
        const r = await activateScene(scene, 'claude');
        if (!r.ok) return text(r.error ?? 'That didn’t work.', true);
        return text(`Done. ${r.name ?? scene} is set${isDemo() ?' (demo house: nothing real was switched)' : ''}.`);
      }),
  ],
});
