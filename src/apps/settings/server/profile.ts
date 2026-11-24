// The user's profile on this PC: name, what Claude calls them, their work, and a photo. Kept in profile.json
// (the photo in profile-photo.jpg) and written whole whenever it changes. Local only: nothing leaves this PC
// except as part of a Claude session's prompt, sent to Claude the same way the session's own messages are.
import fs from 'node:fs';
import path from 'node:path';
import { HUB, readJson, readJsonOrSetAside, writeJsonFile } from '../../../core/server/paths.ts';
import { isJpeg } from '../../photos/server/store.ts';
import { NAME_MAX, NICK_MAX, PHOTO_MAX, ROLES, type Profile } from '../api.ts';

const FILE = path.join(HUB, 'profile.json');
const PHOTO = path.join(HUB, 'profile-photo.jpg');

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

let state: Profile = load();
// The first-run welcome: finished or skipped (true), kept in profile.json so it shows once per ClaudeOS install
let welcomed = readJson<{ welcomed?: unknown }>(FILE)?.welcomed === true;

function load(): Profile {
  const s = readJsonOrSetAside<Partial<Profile>>(FILE) ?? {};   // a bad file is set aside, not saved over
  return {
    name: clean(s.name, NAME_MAX),
    nickname: clean(s.nickname, NICK_MAX),
    role: (ROLES as readonly string[]).includes(String(s.role)) ? String(s.role) : '',
    photoAt: typeof s.photoAt === 'number' && fs.existsSync(PHOTO) ? s.photoAt : 0,
  };
}

// Write the file first. Callers change the in-memory state only after this returns, so a failed write leaves both unchanged.
const save = (s: Profile = state, w: boolean = welcomed): void => writeJsonFile(FILE, { ...s, welcomed: w }, { indent: 2 });

export const getProfile = (): Profile => ({ ...state });

export const welcomeDone = (): boolean => welcomed;

/** Mark the first-run welcome finished or skipped (true), or bring it back (false). Returns the flag now. */
export function setWelcomeDone(done: boolean): boolean {
  save(state, done);
  welcomed = done;
  return welcomed;
}

/** Save the fields sent (a field left out stays as it was). Returns the profile now. */
export function setProfile(body: Record<string, unknown>): Profile {
  const next: Profile = { ...state };
  if (typeof body.name === 'string') next.name = clean(body.name, NAME_MAX);
  if (typeof body.nickname === 'string') next.nickname = clean(body.nickname, NICK_MAX);
  if (typeof body.role === 'string') next.role = (ROLES as readonly string[]).includes(body.role) ? body.role : '';
  save(next);
  state = next;
  return getProfile();
}

/** Keep a square JPEG as the profile photo. */
export function savePhoto(raw: Buffer | null): { ok: true; profile: Profile } | { ok: false; error: string } {
  if (!raw || !raw.length) return { ok: false, error: 'no_photo' };
  if (raw.length > PHOTO_MAX) return { ok: false, error: 'too_big' };
  if (!isJpeg(raw)) return { ok: false, error: 'not_jpeg' };
  fs.writeFileSync(PHOTO, raw);
  const next: Profile = { ...state, photoAt: Date.now() };
  save(next);
  state = next;
  return { ok: true, profile: getProfile() };
}

export function removePhoto(): Profile {
  try { fs.rmSync(PHOTO, { force: true }); } catch { /* already gone */ }
  const next: Profile = { ...state, photoAt: 0 };
  save(next);
  state = next;
  return getProfile();
}

export function readProfilePhoto(): Buffer | null {
  if (!state.photoAt) return null;
  try { return fs.readFileSync(PHOTO); } catch { return null; }
}

/**
 * The lines about the user for a new Claude session's system prompt. Empty fields are left out; "" when
 * nothing is set. Only sent to Claude as part of the session's own prompt.
 */
export function profileForPrompt(): string {
  const { name, nickname, role } = state;
  const lines: string[] = [];
  if (name && nickname) lines.push(`The user's name is ${name}; call them ${nickname}.`);
  else if (name) lines.push(`The user's name is ${name}.`);
  else if (nickname) lines.push(`Call the user ${nickname}.`);
  if (role) lines.push(`They describe their work as: ${role}.`);
  return lines.length ? `About the user (from their profile on ClaudeOS): ${lines.join(' ')}` : '';
}
