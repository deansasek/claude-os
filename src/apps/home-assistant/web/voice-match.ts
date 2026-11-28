// Voice on/off for Home Assistant: "turn off the kitchen light", "lights on", "switch the fan off".
// Pure (no DOM, no fetch) so it can be tested in Node. core/web/voice-commands.ts feeds it the devices on the Home
// dashboard and calls POST /api/home-assistant/toggle with {voice: true}, which checks everything again on the PC.
// It never guesses: anything that isn't clearly one dashboard device (or "the lights") returns null and goes to Claude.
import { plain, VOICE_DOMAINS, type HaResult } from '../api.ts';

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

export interface OnOffReply { say: string; react?: 'hop' | 'look' }

/** The reply for an on/off command. `results` has one entry per target: the PC's answer, or null when the PC
 *  could not be reached. All-null failures say the PC can't be reached; a refusal says its plain reason. */
export function onOffReply(m: VoiceMatch, results: (HaResult | null)[]): OnOffReply {
  const failed = m.targets.map((d, i) => ({ d, r: results[i] })).filter(x => !x.r?.ok);
  if (!failed.length) return { say: `${m.label}.`, react: m.on ? 'hop' : 'look' };
  if (m.all && failed.length < m.targets.length) return { say: `Couldn’t reach ${failed.length} of the lights.` };
  if (failed.every(x => x.r == null)) return { say: 'I can’t reach the PC right now.' };
  const verb = m.on ? 'turn on' : 'turn off';
  const subject = m.all ? 'the lights' : `the ${lowerFirst(sayName(m.targets[0]))}`;
  const reason = failed.find(x => x.r)?.r?.error;
  return { say: `Couldn’t ${verb} ${subject}. ${plain(reason)}` };
}

/** "is the porch light on", "are the lights off", "is the front door open": the device's words and the state asked about,
 *  or null. A pronoun is never a device ("is it on"). Only the question is read; nothing is switched. */
export function parseIsOn(raw: string): { target: string; word: string } | null {
  const t = clean(raw).replace(POLITE, '').trim().replace(POLITE, '').trim();
  const m = t.match(/^(?:is|are) (.+) (on|off|open|closed)$/);
  if (!m) return null;
  const target = noArticles(m[1]);
  if (!target || ['it', 'that', 'this', 'them'].includes(target)) return null;
  return { target, word: m[2] };
}

/** "are any lights on", "which lights are on", "are the lights all off": the question's kind, or null. Read only. */
export function parseLightsOn(raw: string): 'any-on' | 'all-off' | null {
  const t = clean(raw).replace(POLITE, '').trim().replace(POLITE, '').trim();
  if (/^(?:are|is) (?:any|there any) (?:of the |of my |my )?lights? (?:still )?on$|^(?:which|what) lights? (?:are|is) on$/.test(t)) return 'any-on';
  if (/^(?:are|is) (?:the |all the )?lights? (?:all )?off$/.test(t)) return 'all-off';
  return null;
}

/** The spoken answer about the lights: "The kitchen light and porch light are on.", "No lights are on.", "All the lights are off." */
export function lightsOnReply(kind: 'any-on' | 'all-off', all: string[], on: string[]): string {
  const join = (names: string[]): string => {
    const first = names.slice(0, 3);
    const words = first.length === 1 ? first[0] : `${first.slice(0, -1).join(', ')} and ${first[first.length - 1]}`;
    return names.length > 3 ? `${first.join(', ')}, and ${names.length - 3} more` : words;
  };
  if (!all.length) return 'There are no lights.';
  if (kind === 'all-off') return on.length ? `No, ${join(on)} ${on.length === 1 ? 'is' : 'are'} still on.` : 'All the lights are off.';
  if (!on.length) return 'No lights are on.';
  return `The ${join(on)} ${on.length === 1 ? 'is' : 'are'} on.`;
}

/** The spoken answer for a device's state: "The porch light is on.", "The front door is open.". */
/** The first letter in lower case, only when the next letter is too: "Kitchen light" is "kitchen light", but "TV" and "LED strip" keep their capitals. */
function lowerFirst(s: string): string {
  return s.replace(/^([A-Z])(?=[a-z])/, c => c.toLowerCase());
}

/** The one device a question names, by its name or its voice name, any domain (a door sensor or a cover too). Null when none or several. */
export function findDevice(target: string, devices: VoiceDevice[]): VoiceDevice | null {
  const t = clean(target);
  const hits = devices.filter(d => clean(d.name) === t || clean(sayName(d)) === t);
  return hits.length === 1 ? hits[0] : null;
}

export function stateReply(d: VoiceDevice, state: string): string {
  // a door, window, gate or garage sensor reads on and off as open and closed, as Home Assistant shows them
  const opening = d.domain === 'binary_sensor' && /door|window|gate|garage|opening/i.test(d.name);
  const words = opening ? (state === 'on' ? 'open' : state === 'off' ? 'closed' : state.replace(/_/g, ' ')) : state.replace(/_/g, ' ');
  const name = lowerFirst(sayName(d));
  return `The ${name} is ${words}.`.replace(/^./, c => c.toUpperCase());
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
