// The software update panel's words (Settings → About). Pure: no DOM and no imports, so the test runs under node.

/** What the tablet's update check says (Bridge.updateAvailable): the installed build and the newest one it can see. */
export interface UpdateAvailable { status: 'ok' | 'not owner' | 'error'; installed?: number; latest?: number }
/** What starting an update says (Bridge.updateCheck). The install runs in the background on the tablet. */
export interface UpdateStart { status: 'updating' | 'up to date' | 'busy' | 'not owner' | 'error'; from?: number; to?: number; versionCode?: number; error?: string }

/** The panel's status line, and whether "Update now" should show. `pcBuild` is the PC's build (from /apk/version). */
export function updateStatus(a: UpdateAvailable | null, pcBuild: number | null): { text: string; canUpdate: boolean } {
  if (!a) return { text: 'Can’t check this tablet’s build right now.', canUpdate: false };
  if (a.status === 'not owner') return { text: 'Updates need ClaudeOS to be this tablet’s owner.', canUpdate: false };
  if (a.status !== 'ok' || a.installed == null) return { text: 'Can’t check for an update right now.', canUpdate: false };
  if (pcBuild == null) return { text: `This tablet has build ${a.installed}. Can’t reach your PC to check for a newer one.`, canUpdate: false };
  if (pcBuild > a.installed) return { text: `Build ${pcBuild} is ready on your PC. This tablet has ${a.installed}.`, canUpdate: true };
  return { text: `Up to date at build ${a.installed}.`, canUpdate: false };
}

/** The words for the last update attempt, kept until the next one. */
export function resultText(r: UpdateStart): string {
  switch (r.status) {
    case 'updating': return `Updating to build ${r.to ?? '?'}. ClaudeOS restarts when it’s done.`;
    case 'up to date': return `Already up to date at build ${r.versionCode ?? '?'}.`;
    case 'busy': return 'An update is already running.';
    case 'not owner': return 'Updates need ClaudeOS to be this tablet’s owner.';
    default: return `Couldn’t update: ${r.error || 'unknown error'}.`;
  }
}
