// Which events the Calendar app can change: only ClaudeOS events, and only ones the add form can show (web/index.ts).
// Pure: no DOM and no network, so Node tests load it.

export interface EditableEvent { id?: string; title: string; start: number; end: number; allDay: boolean; location?: string; calendar?: string }

/** An event on the ClaudeOS calendar, the only kind the PC has an id for. External events (ICS, connector) stay read-only. */
export function ownEvent(e: EditableEvent): boolean {
  return !!e.id && e.calendar === 'claudeos';
}

/** The add form shows a timed event that starts and ends on one day, or an all-day event that covers one whole day. */
export function formCanShow(e: EditableEvent): boolean {
  const s = new Date(e.start), t = new Date(e.end);
  if (e.allDay) return e.end === new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1).getTime();
  return s.getFullYear() === t.getFullYear() && s.getMonth() === t.getMonth() && s.getDate() === t.getDate();
}

/** Edit is offered only for a ClaudeOS event the form can show. */
export function editable(e: EditableEvent): boolean {
  return ownEvent(e) && formCanShow(e);
}

/** The note after a saved, added or deleted event: the done text, then the note from the reload (a failed reload says so). */
export function afterWriteNote(done: string, readNote: string): string {
  return readNote ? `${done} ${readNote}` : done;
}

/** What hardware Back closes first in the Calendar: the details, then the day/time picker, then the add sheet's confirm step, then the add sheet. null: nothing is open. */
export function backTarget(s: { detail: boolean; picker: boolean; confirm: boolean; add: boolean }): 'detail' | 'picker' | 'confirm' | 'add' | null {
  if (s.detail) return 'detail';
  if (s.picker) return 'picker';
  if (s.confirm) return 'confirm';
  if (s.add) return 'add';
  return null;
}
