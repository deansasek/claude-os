// "Your Claude" instructions: a note the user writes once, kept on this PC next to the profile (instructions.txt).
// Like the profile, it is appended to a new Claude session's system prompt, and only sent to Claude as part of that prompt.
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';
import { INSTRUCTIONS_MAX } from '../api.ts';

const FILE = path.join(HUB, 'instructions.txt');

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, INSTRUCTIONS_MAX) : '');

let text = load();

function load(): string {
  try { return clean(fs.readFileSync(FILE, 'utf8')); } catch { return ''; }
}

export const getInstructions = (): string => text;

/** Save the instructions (empty clears them). Returns what is saved now. */
export function setInstructions(v: unknown): string {
  text = clean(v);
  if (text) fs.writeFileSync(FILE, text);
  else { try { fs.rmSync(FILE, { force: true }); } catch { /* already gone */ } }
  return text;
}

/** The line for a new Claude session's system prompt; "" when none are set. */
export function instructionsForPrompt(): string {
  return text ? `The user's instructions: ${text}` : '';
}
