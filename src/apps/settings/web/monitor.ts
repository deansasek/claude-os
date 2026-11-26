// The System monitor page's status words (Settings → System monitor). Pure: no DOM and no imports, so the test runs under node.

export interface MonitorInput {
  uptimeSeconds: number | null;   // from /api/core/status; null when the PC did not answer. Also the PC link state.
  openNames: string[];            // the open apps, by name
  failedNames: string[];          // the apps that did not start, by name
}

export interface MonitorLines { uptime: string; pc: string; open: string; failed: string }

/** "2 h 5 min", "5 min", or "under a minute". */
export function uptimeText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return 'under a minute';
}

/** The four lines the page shows. Each one is words only; the buttons are the page's own. */
export function monitorLines(i: MonitorInput): MonitorLines {
  const uptime = i.uptimeSeconds == null ? 'Not reachable right now' : `Running for ${uptimeText(i.uptimeSeconds)}`;
  const pc = i.uptimeSeconds == null ? 'Can’t reach the PC right now' : 'Connected';
  const open = i.openNames.length
    ? `${i.openNames.length} open: ${i.openNames.join(', ')}`
    : 'No apps open';
  const failed = i.failedNames.length
    ? `${i.failedNames.length} didn’t start: ${i.failedNames.join(', ')}`
    : 'No apps failed to start';
  return { uptime, pc, open, failed };
}
