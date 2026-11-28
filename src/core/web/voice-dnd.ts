// Do Not Disturb by voice: "turn on do not disturb", "turn off do not disturb", "is do not disturb on". Pure: no DOM, so Node
// tests it (test/voice-dnd.test.ts). The command (voice-commands.ts) sets the tablet's flag and says the result.

export type DndWord = 'on' | 'off' | 'ask' | null;

/** The Do Not Disturb phrase: switch it on, switch it off, or ask whether it is on. Null when the phrase is not about it. */
export function dndWord(t: string): DndWord {
  if (/^(?:turn on|switch on|enable|put on|set)(?: the)? (?:do not disturb|dnd)(?: mode)?$|^(?:turn|switch)(?: the)? (?:do not disturb|dnd)(?: mode)? on$|^(?:do not disturb|dnd)(?: mode)? on$/.test(t)) return 'on';
  if (/^(?:turn off|switch off|disable|cancel)(?: the)? (?:do not disturb|dnd)(?: mode)?$|^(?:turn|switch)(?: the)? (?:do not disturb|dnd)(?: mode)? off$|^(?:do not disturb|dnd)(?: mode)? off$/.test(t)) return 'off';
  if (/^is (?:do not disturb|dnd)(?: mode)?(?: on| off)?$/.test(t)) return 'ask';
  return null;
}
