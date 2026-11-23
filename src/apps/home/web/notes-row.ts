// The words on Home's Notifications row, kept free of the DOM so a test can read them.
// The row is narrow (about 180 px for the value beside its label), so it never says the same word twice.

export interface RowNotice { title: string; app?: string; at: number }

const APP_NAMES: Record<string, string> = { claude: 'Claude', weather: 'Weather', clock: 'Clock', settings: 'Settings', home: 'Home' };

/**
 * The row's value and detail, from the last day's notifications (newest first):
 * "All caught up"; "3 new" + the newest title; or one title + where it came from and when ("Claude finished" + "11 hr").
 * The app's name is dropped when the title already starts with it, and the time never breaks across two lines.
 */
export function notesRow(recent: readonly RowNotice[], ago: (at: number) => string): { val: string; sub: string } {
  if (!recent.length) return { val: 'All caught up', sub: '' };
  const n = recent[0];
  if (recent.length > 1) return { val: `${recent.length} new`, sub: n.title };
  const app = n.app ? APP_NAMES[n.app] || '' : '';
  const named = app && n.title.toLowerCase().startsWith(app.toLowerCase());
  return { val: n.title, sub: [named ? '' : app, ago(n.at).replace(/ /g, ' ')].filter(Boolean).join(' · ') };
}
