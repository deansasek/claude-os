// "Your Claude" instructions: a note the user writes once, kept on this PC next to the profile (instructions.txt).
// Like the profile, it is appended to a new Claude session's system prompt, and only sent to Claude as part of that prompt.
import fs from 'node:fs';
import path from 'node:path';
import { STATE } from '../../../core/server/paths.ts';
import { INSTRUCTIONS_MAX, INSTRUCTIONS_READ_FAILED } from '../api.ts';

const FILE = process.env.CLAUDEOS_INSTRUCTIONS_FILE || path.join(STATE, 'instructions.txt');   // a test sets CLAUDEOS_INSTRUCTIONS_FILE

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, INSTRUCTIONS_MAX) : '');

// readFailed: the file may exist but could not be read. Settings then shows the error, not "none saved".
let readFailed = false;
let text = load();

// Only a missing file means none saved. Any other error (EACCES, EBUSY, EISDIR) sets readFailed and returns ''.
function load(): string {
  try { const v = clean(fs.readFileSync(FILE, 'utf8')); readFailed = false; return v; }
  catch (e) { readFailed = (e as NodeJS.ErrnoException).code !== 'ENOENT'; return ''; }
}

/** The saved text. While the last read failed, it reads the file again first. */
export const getInstructions = (): string => {
  if (readFailed) text = load();
  return text;
};

/** The GET answer: {text}, or {text: '', error} while the file cannot be read. */
export function instructionsView(): { text: string; error?: string } {
  const t = getInstructions();
  return readFailed ? { text: '', error: INSTRUCTIONS_READ_FAILED } : { text: t };
}

/** Save the instructions (empty clears them). Returns what is saved now. */
export function setInstructions(v: unknown): string {
  // Write or remove the file first: a failed write or removal throws and leaves the saved text as it was.
  // force: a file that is already gone is not an error; any other failure is.
  const next = clean(v);
  if (next) fs.writeFileSync(FILE, next);
  else fs.rmSync(FILE, { force: true });
  text = next;
  readFailed = false;   // the saved file is now the text this call wrote
  return text;
}

/** The line for a new Claude session's system prompt; "" when none are set. */
export function instructionsForPrompt(): string {
  // Reads again while the last read failed, so a new session gets the text once the file is readable.
  const t = getInstructions();
  return t ? `The user's instructions: ${t}` : '';
}
