// Voice on/off for Home Assistant: "turn off the kitchen light", "lights on", "switch the fan off".
// Pure (no DOM, no fetch) so it can be tested in Node. core/web/voice-commands.ts feeds it the devices on the Home
// dashboard and calls POST /api/home-assistant/toggle with {voice: true}, which checks everything again on the PC.
// It never guesses: anything that isn't clearly one dashboard device (or "the lights") returns null and goes to Claude.
import { VOICE_DOMAINS } from '../api.ts';

export interface VoiceDevice { entity_id: string; domain: string; name: string }
export interface VoiceMatch { on: boolean; targets: VoiceDevice[]; all: boolean; label: string }

/** Words that name a kind of device; "the kitchen light" is the light called "Kitchen". */
const KIND_WORDS: Record<string, string[]> = {
  light: ['light', 'lights', 'lamp', 'lamps'],
  switch: ['switch', 'plug', 'socket'],
  fan: ['fan'],
  media_player: ['speaker', 'tv', 'television', 'player'],
};
const ALL_LIGHTS = /^(?:all|every|each)? ?(?:of )?(?:the |my )?(?:lights|lamps)$|^(?:every|each) (?:light|lamp)$|^all (?:the |my )?(?:lights|lamps) in the (?:house|home|flat|apartment)$/;
const POLITE = /^(?:(?:can|could|would|will) you |please |hey |ok |okay |claude )+|(?: please| thanks| thank you)+$/g;

const clean = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const noArticles = (s: string) => ` ${s} `.replace(/ (?:the|a|an|my|our) /g, ' ').replace(/\s+/g, ' ').trim();

/** "turn off the kitchen light" -> {on: false, target: "kitchen light"}; null if it isn't an on/off phrase. */
export function parseOnOff(raw: string): { on: boolean; target: string } | null {
  const t = clean(raw).replace(POLITE, '').trim().replace(POLITE, '').trim();
  let on: string, target: string;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:turn|switch|put) (on|off) (.+)$/))) { on = m[1]; target = m[2]; }
  else if ((m = t.match(/^(?:turn|switch|put) (.+) (on|off)$/))) { on = m[2]; target = m[1]; }
  else if ((m = t.match(/^(.+) (on|off)$/))) { on = m[2]; target = m[1]; }
  else return null;
  target = target.trim();
  // "turn on" on its own would otherwise read "turn" as the device: a verb or a pronoun is never a device
  if (!target || ['it', 'that', 'this', 'turn', 'switch', 'put'].includes(target)) return null;
  return { on: on === 'on', target };
}

/** The phrase spoken back: "Kitchen light", "Bedroom fan", "Speaker". */
export function sayName(d: VoiceDevice): string {
  const n = d.name.trim();
  const words = clean(n).split(' ');
  const kind = d.domain === 'light' ? 'light' : d.domain === 'fan' ? 'fan' : '';
  const has = (KIND_WORDS[d.domain] ?? []).some(w => words.includes(w));
  return kind && !has ? `${n} ${kind}` : n;
}

// ---------- scenes: "set movie night", "activate the good morning scene" ----------
export interface VoiceScene { entity_id: string; name: string }

/** "set movie night" -> "movie night"; null if it isn't a "set / activate <scene>" phrase. */
export function parseScene(raw: string): string | null {
  const t = clean(raw).replace(POLITE, '').trim().replace(POLITE, '').trim();
  const m = t.match(/^(?:set|activate|start)(?: up)? (.+?)(?: scene)?$/);
  if (!m) return null;
  const target = noArticles(m[1]).trim();
  if (!target || /^(?:it|that|this|scene)$/.test(target)) return null;
  return target;
}

/** The one scene whose name is exactly what was said (articles and a trailing "scene" ignored), else null. */
export function matchScene(raw: string, scenes: VoiceScene[]): VoiceScene | null {
  const want = parseScene(raw);
  if (!want) return null;
  const found = scenes.filter(s => s.entity_id.startsWith('scene.') && noArticles(clean(s.name)).replace(/ scene$/, '') === want);
  return found.length === 1 ? found[0] : null;   // none, or more than one: don't guess
}

/** Match a spoken phrase to dashboard devices. `devices` should be only what is on the Home dashboard. */
export function matchHome(raw: string, devices: VoiceDevice[]): VoiceMatch | null {
  const p = parseOnOff(raw);
  if (!p) return null;
  const usable = devices.filter(d => (VOICE_DOMAINS as readonly string[]).includes(d.domain) && d.entity_id.split('.')[0] === d.domain);
  const target = clean(p.target);
  const word = p.on ? 'on' : 'off';

  if (ALL_LIGHTS.test(target)) {
    const lights = usable.filter(d => d.domain === 'light');
    if (!lights.length) return null;
    return { on: p.on, targets: lights, all: true, label: `${lights.length === 1 ? sayName(lights[0]) : 'Lights'} ${word}` };
  }

  const want = noArticles(target);
  if (!want) return null;
  const hits = (pred: (d: VoiceDevice) => boolean) => usable.filter(pred);
  const nameOf = (d: VoiceDevice) => noArticles(clean(d.name));

  // 1. the name exactly ("coffee machine", "bedroom fan", "kitchen")
  let found = hits(d => nameOf(d) === want);
  // 2. the name and a kind word that fits its domain ("kitchen light" -> light "Kitchen"; "lamp bedside" not)
  if (!found.length) {
    found = hits(d => (KIND_WORDS[d.domain] ?? []).some(k => want === `${nameOf(d)} ${k}`));
  }
  // 3. only a kind word ("the fan"), when exactly one dashboard device is of that kind
  if (!found.length) {
    const kinds = Object.keys(KIND_WORDS).filter(dm => KIND_WORDS[dm].includes(want) && !/s$/.test(want));
    if (kinds.length === 1) found = hits(d => d.domain === kinds[0]);
  }
  if (found.length !== 1) return null;   // none, or more than one: don't guess
  return { on: p.on, targets: found, all: false, label: `${sayName(found[0])} ${word}` };
}
