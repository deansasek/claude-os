// One-line descriptions of tool calls, shared by the transcript and the approval cards.
// The names come from tools.ts (the status line uses the same ones).
import { wordsFor } from '../web/tools.ts';

const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fileName = (p: string) => p.split(/[\\/]/).slice(-2).join('/');

/** The input's key argument: the command, file, pattern, URL, query or title the call is about. */
const ARG_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'subject', 'uri',
  'description', 'prompt', 'title', 'name', 'to', 'text', 'path', 'id'];
function keyArg(i: Record<string, any>): string | null {
  for (const k of ARG_KEYS) if (typeof i[k] === 'string' && i[k].trim()) return i[k];
  return null;
}

/** A plain detail for the ClaudeOS tools, from the facts in the call: "10 minutes (pasta)", "07:00", "7 days". Null for other tools. */
function plainDetail(tool: string, i: Record<string, any>): string | null {
  if (!tool.startsWith('mcp__claudeos_')) return null;
  const n = tool.split('__').pop() ?? '';
  if (n === 'set_timer' && typeof i.minutes === 'number') return `${i.minutes} minutes${typeof i.label === 'string' && i.label ? ` (${i.label})` : ''}`;
  if (n === 'set_alarm' && typeof i.time === 'string') return i.time;
  if ((n === 'weather_forecast' || n === 'calendar_range') && typeof i.days === 'number') return `${i.days} days`;
  // the device and the service, so the approval shows what will change: "light.turn_on on light.kitchen", and the set temperature
  if (n === 'ha_call_service' && typeof i.entity_id === 'string') return `${i.domain}.${i.service} on ${i.entity_id}${typeof i.temperature === 'number' ? `, ${i.temperature}°` : ''}`;
  if (n === 'ha_activate_scene' && typeof i.scene === 'string') return i.scene;
  // the night and the dish, so the approval shows what goes on the plan: "Thursday: lasagne"
  if (n === 'meals_plan' && typeof i.day === 'string' && typeof i.dinner === 'string') return `${i.day}: ${i.dinner}`;
  return '';
}

/** The name and the key argument, as the transcript shows them: "Read notes/todo.txt", "Ran a command". */
export function describeTool(tool: string, input: Record<string, any>): { summary: string; detail: string } {
  const i = input || {};
  const w = wordsFor(tool);
  const arg = keyArg(i);
  // a subagent's own short description is the most useful line about it
  if ((tool === 'Agent' || tool === 'Task') && typeof i.description === 'string') return { summary: short(i.description, 80), detail: short(JSON.stringify(i), 600) };
  if (w.arg && arg) {
    const shown = w.arg === 'file' ? short(fileName(arg), 60) : short(arg, 60);
    return { summary: `${w.past} ${shown}`, detail: short(arg, 600) };
  }
  if (arg) return { summary: w.past, detail: short(arg, 600) };
  return { summary: w.past, detail: plainDetail(tool, i) ?? short(JSON.stringify(i), 600) };
}

/** Present tense, for approval cards: "Write notes.txt", "Run a command" with the command as the detail. */
export function askFor(tool: string, input: Record<string, any>): { summary: string; detail: string } {
  const i = input || {};
  const w = wordsFor(tool);
  const arg = keyArg(i);
  if ((tool === 'Agent' || tool === 'Task') && typeof i.description === 'string') return describeTool(tool, i);
  if (w.arg && arg) {
    const shown = w.arg === 'file' ? short(fileName(arg), 60) : short(arg, 50);
    return { summary: `${w.now} ${shown}`, detail: short(arg, 600) };
  }
  return { summary: w.now, detail: arg ? short(arg, 600) : (plainDetail(tool, i) ?? short(JSON.stringify(i), 600)) };
}
