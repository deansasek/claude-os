// The user's profile (Settings → Profile), kept on the PC so every screen shares it. This module holds a copy
// for the greetings: the critter and the home screen read the nickname from here. Settings writes through it.
import { getJson } from './dom.ts';

export interface Profile { name: string; nickname: string; role: string; photoAt: number }

const EMPTY: Profile = { name: '', nickname: '', role: '', photoAt: 0 };
let current: Profile = EMPTY;
const listeners: ((p: Profile) => void)[] = [];

export const profile = (): Profile => current;
/** What Claude should call the user, or '' when it isn't set. */
export const nickname = (): string => current.nickname;

export function onProfile(fn: (p: Profile) => void): void { listeners.push(fn); }

/** Take a profile the server just sent back (Settings does this after each save). */
export function applyProfile(p: Profile): void {
  current = { ...EMPTY, ...p };
  listeners.forEach(f => { try { f(current); } catch { /* ignore */ } });
}

/** Read the profile from the PC. A screen that can't reach it keeps what it had. */
export async function refreshProfile(): Promise<void> {
  try { applyProfile(await getJson<Profile>('/api/settings/profile')); } catch { /* offline: keep what we have */ }
}

/** Up to two letters for the initials avatar: first and last word ("Alex Smith" → AS, "Alex" → AL). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  // split into characters, not code units: an emoji or another astral letter is one character, not half of one
  const chars = words.map(w => Array.from(w));
  const first = chars[0][0] ?? '', last = chars.length > 1 ? (chars[chars.length - 1][0] ?? '') : (chars[0][1] ?? '');
  return (first + last).toUpperCase();
}

// Load once when a screen starts; the Settings app refreshes it again when it's opened.
void refreshProfile();
