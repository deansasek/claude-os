// Progress text and bar for a running download. No imports: the size formatter is copied from state.ts so this file stays testable on its own.

function size(bytes: number): string {
  if (!bytes || bytes < 1) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** pct is null when the total is unknown: draw no bar, show only the text. */
export function runningMeta(bytes: number, total: number): { pct: number | null; text: string } {
  if (total > 0) {
    return {
      pct: Math.min(100, Math.round(bytes / total * 100)),
      text: `${size(bytes)} of ${size(total)}`,
    };
  }
  return { pct: null, text: bytes > 0 ? `${size(bytes)} so far` : 'Starting' };
}
