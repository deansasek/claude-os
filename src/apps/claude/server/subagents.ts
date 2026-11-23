// Counts the subagents a session is running, from the events in its log (the main log, not the subagent files).
// A subagent starts with an assistant "Agent" tool_use. Its tool_result comes back at once: a background
// agent answers "Async agent launched" with an agentId, and a foreground agent answers with its final text.
// A background agent ends with a queue-operation whose content starts "<task-notification>" and names its
// <task-id>, which is the agentId, and its <tool-use-id>. A tool_use with no tool_result yet is running too.

interface Launch { agentId: string | null; resolved: boolean }

/** How many subagents are running, given the parsed log events in order (sidechain events removed). */
export function runningSubagents(events: any[]): number {
  const launches = new Map<string, Launch>();   // Agent tool_use id -> its launch
  const ended = new Set<string>();              // agentIds and Agent tool_use ids named by a task-notification
  for (const o of events) {
    const content = Array.isArray(o?.message?.content) ? o.message.content : [];
    if (o?.type === 'assistant') {
      for (const b of content) {
        if (b?.type === 'tool_use' && b.name === 'Agent' && typeof b.id === 'string') launches.set(b.id, { agentId: null, resolved: false });
      }
    } else if (o?.type === 'user') {
      for (const b of content) {
        const launch = b?.type === 'tool_result' ? launches.get(b.tool_use_id) : undefined;
        if (!launch) continue;
        launch.resolved = true;
        const m = /agentId: (\w+)/.exec(JSON.stringify(b.content ?? ''));
        if (m) launch.agentId = m[1];
      }
    } else if (o?.type === 'queue-operation' && typeof o.content === 'string' && o.content.startsWith('<task-notification>')) {
      const m = /<task-id>(\w+)<\/task-id>/.exec(o.content);
      if (m) ended.add(m[1]);
      const u = /<tool-use-id>([\w-]+)<\/tool-use-id>/.exec(o.content);
      if (u) ended.add(u[1]);
    }
  }
  let running = 0;
  for (const [id, l] of launches) {
    if (ended.has(id)) continue;
    if (!l.resolved || (l.agentId && !ended.has(l.agentId))) running++;
  }
  return running;
}

/** True when a raw log line may matter to runningSubagents (cheap check before parsing a big line). */
export function mayTrackSubagent(raw: string): boolean {
  return raw.includes('"name":"Agent"') || raw.includes('"tool_result"') || raw.includes('<task-notification>');
}
