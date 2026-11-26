// Which Claude sessions need you on Home (src/apps/home/web/index.ts). Pure: no DOM, so it runs in node
// (test/home-needs-you.test.ts). A session needs you when its turn waits for your OK, or when it is waiting for your turn.

/** A Claude session as the usage endpoint lists it. age: seconds since its last activity. */
export interface NeedSession { id: string | null; state: string; age: number }
/** A Hub turn as the usage endpoint lists it. An 'approval' turn is still working, but waits for your OK. */
export interface NeedTurn { sessionId: string; status: string }

/** The sessions that need you: waiting for your turn (within 15 min), or with a turn waiting for your OK. */
export function needsYou<T extends NeedSession>(sessions: T[], turns: NeedTurn[]): T[] {
  const approval = new Set(turns.filter(t => t.status === 'approval').map(t => t.sessionId));
  return sessions.filter(s => !!s.id && ((s.state === 'waiting' && s.age < 15 * 60) || approval.has(s.id)));
}

/** The sessions that work: thinking or running a tool, and not waiting for your OK (those count as needs you). */
export function busyOf<T extends NeedSession>(sessions: T[], turns: NeedTurn[]): T[] {
  const approval = new Set(turns.filter(t => t.status === 'approval').map(t => t.sessionId));
  return sessions.filter(s => (s.state === 'thinking' || s.state === 'tool') && !(s.id && approval.has(s.id)));
}

/** The session and turn lists to judge now. A failed read gives none: the old lists are not live. */
export function liveSessions<T extends NeedSession>(usage: { sessions?: T[]; turns?: NeedTurn[] } | null | undefined, failed: boolean): { sessions: T[]; turns: NeedTurn[] } {
  if (failed) return { sessions: [], turns: [] };
  return { sessions: usage?.sessions || [], turns: usage?.turns || [] };
}
