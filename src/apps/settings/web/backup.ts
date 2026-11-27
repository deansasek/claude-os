// Settings → Storage → Settings backup: the tablet's settings go to the PC, and come back on request. The keys are
// filtered on both sides (backup-keys.ts), so a token, a key, the sign-in or the PIN state never leaves the tablet.
import { getJson, postJson, store } from '../../../core/web/dom.ts';
import { backupKey, backupValues } from './backup-keys.ts';

export interface BackupState { ok?: boolean; saved: string | null; values: Record<string, string>; error?: string }
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

// the backup save and read give up on a PC that does not answer, so Save and Restore end with the can't-reach message
const BACKUP_TIMEOUT_MS = 20e3;

/** Send the tablet's settings to the PC. */
export async function saveSettings(): Promise<SaveResult> {
  try { return await postJson<SaveResult>('/api/settings/backup', { values: localSettings() }, BACKUP_TIMEOUT_MS); }
  catch { return { ok: false, error: 'Can’t reach your PC. Try again when it’s back.' }; }
}

/** The last backup on the PC, or null when the PC cannot be reached. */
export async function loadSettings(): Promise<BackupState | null> {
  try { return await getJson<BackupState>('/api/settings/backup', BACKUP_TIMEOUT_MS); } catch { return null; }
}

/** The note under the Save button: the saved time and the count, or a reason when there is no backup to show. */
export function backupNote(b: BackupState | null): string {
  if (!b) return 'Can’t reach your PC';
  if (b.ok === false) return b.error ?? 'The PC couldn’t read its settings backup.';
  return b.saved ? savedNote(b.saved, Object.keys(b.values).length) : 'Not saved yet';
}

/** The note for a backup saved at `saved` (ISO time) holding `count` settings. */
export function savedNote(saved: string, count: number): string {
  const when = new Date(saved).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `${when} · ${count} settings`;
}

/** Write the PC's settings back to this tablet. Returns how many were written, -1 when the PC cannot be reached, -2 when its backup cannot be read, or -3 when this tablet's storage would not take some settings (then every setting is put back as it was). */
export async function restoreSettings(): Promise<number> {
  const b = await loadSettings();
  if (!b) return -1;
  if (b.ok === false) return -2;
  const values = backupValues(b.values ?? {});
  // the values as they are now, so a restore that fails partway can be put back: a half-restore would mix the two sets
  const before = new Map(Object.keys(values).map(k => [k, localStorage.getItem(k)] as const));
  // each write is read back: store.set swallows a refused write, so a setting that did not land is counted as a failure
  let failed = 0;
  for (const [k, v] of Object.entries(values)) {
    try { localStorage.setItem(k, v); } catch { failed++; continue; }
    if (localStorage.getItem(k) !== v) failed++;
  }
  if (failed) {
    for (const [k, old] of before) {
      try { if (old === null) localStorage.removeItem(k); else localStorage.setItem(k, old); } catch { /* nothing more to do */ }
    }
    return -3;
  }
  return Object.keys(values).length;
}

/** The status line and the note under Save for a restore that wrote `n` settings (see restoreSettings). */
export function restoreOutcome(n: number): { msg: string; note: string | null } {
  if (n === -2) return { msg: 'The PC couldn’t read its settings backup, so nothing was restored.', note: null };
  if (n === -3) return { msg: 'This tablet couldn’t save its settings, so the restore is not complete.', note: null };
  if (n < 0) return { msg: 'Can’t reach your PC. Try again when it’s back.', note: backupNote(null) };
  if (n === 0) return { msg: 'Nothing is saved on your PC yet. Tap Save to PC first.', note: null };
  return { msg: '', note: null };
}
