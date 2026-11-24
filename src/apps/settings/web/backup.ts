// Settings → Storage → Settings backup: the tablet's settings go to the PC, and come back on request. The keys are
// filtered on both sides (backup-keys.ts), so a token, a key, the sign-in or the PIN state never leaves the tablet.
import { getJson, postJson, store } from '../../../core/web/dom.ts';
import { backupKey, backupValues } from './backup-keys.ts';

export interface BackupState { saved: string | null; values: Record<string, string> }
export interface SaveResult { ok: boolean; count?: number; saved?: string; error?: string }

/** The tablet's settings that the backup keeps. Storage that cannot be read gives none. */
export function localSettings(): Record<string, string> {
  const raw: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !backupKey(k)) continue;
      const v = localStorage.getItem(k);
      if (v != null) raw[k] = v;
    }
  } catch { /* storage is not readable here */ }
  return backupValues(raw);
}

/** Send the tablet's settings to the PC. */
export async function saveSettings(): Promise<SaveResult> {
  try { return await postJson<SaveResult>('/api/settings/backup', { values: localSettings() }); }
  catch { return { ok: false, error: 'Can’t reach your PC. Try again when it’s back.' }; }
}

/** The last backup on the PC, or null when the PC cannot be reached. */
export async function loadSettings(): Promise<BackupState | null> {
  try { return await getJson<BackupState>('/api/settings/backup'); } catch { return null; }
}

/** Write the PC's settings back to this tablet. Returns how many were written, or -1 when the PC cannot be reached. */
export async function restoreSettings(): Promise<number> {
  const b = await loadSettings();
  if (!b) return -1;
  const values = backupValues(b.values);
  for (const [k, v] of Object.entries(values)) store.set(k, v);
  return Object.keys(values).length;
}
