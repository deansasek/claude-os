// Claude control on the tablet: runs the jobs that sessions ask for and sends each answer back.
//   browser jobs (server/browser.ts)   through the Browser's native bridge (core/web/device.ts)
//   tablet jobs  (server/tablet.ts)    timers, alarms and reminders in the Clock app (its ClockApi), notices (system.ts)
// When it runs: the Claude app mounts at boot with every other app, on the one page that is always loaded, and starts
// the relay then. It stops after IDLE_MS with no job, so the PIN unlock can lapse again. It starts again (and the idle
// time restarts) when a job comes in, when the Claude page is shown, and whenever the Claude app's usage check (every
// 3 to 10 seconds, on screen or off) sees a reply running or waiting for approval: every tool call happens inside such
// a turn, and its approval card comes first, so the relay is listening by the time a call needs it.
import { browser, device } from '../../../core/web/device.ts';
import { batterySay } from '../../../core/web/voice-battery.ts';
import { wifiSay } from '../../../core/web/voice-wifi.ts';
import { notify, prefs } from '../../../core/web/system.ts';
import { getClock, getRoutines } from '../../../core/web/voice-commands.ts';
import { sayDuration } from '../../../core/web/voice-parse.ts';
import { call } from './sessions/pin.ts';
import { cur, getControl } from '../../browser/web/state.ts';

type Op = 'read' | 'click' | 'type' | 'screenshot' | 'open' | 'back' | 'timer' | 'alarm' | 'reminder' | 'notify' | 'routine' | 'clock_status' | 'cancel_timer' | 'cancel_alarms' | 'tablet_status' | 'dnd' | 'pause_timer' | 'resume_timer' | 'adjust_timer';
interface Job { id: string; op: Op; ref?: string; text?: string; args?: Record<string, unknown> }
interface NextReply { ok: boolean; job?: Job | null; error?: string }
type Answer = { ok: boolean; data: string };

const IDLE_MS = 3 * 60e3;      // no job (and no running turn) for this long: stop polling
const RETRY_MS = 5e3;          // locked or offline: try again this often
const MAX_ACTIVE = 20;         // timers and alarms on, in total (the server checks the same with the count sent below)

let running = false;
let lastJobAt = 0;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Start polling for jobs, or keep it going: either way the idle time starts again from now. */
export function startBrowserRelay(): void {
  lastJobAt = Date.now();
  if (running) return;
  running = true;
  void loop();
}

async function loop(): Promise<void> {
  while (running) {
    if (Date.now() - lastJobAt > IDLE_MS) { running = false; return; }
    let r: NextReply;
    try { r = await call<NextReply>('browser/next', { active: getClock()?.active() ?? null }); }
    catch { await sleep(RETRY_MS); continue; }   // locked (the PIN is needed) or no connection: try later
    if (!r.ok) { await sleep(RETRY_MS); continue; }   // the Hub refused (not the PIN): wait, do not spin
    if (!r.job) continue;                        // nothing yet: poll again (the Hub held the request already)
    lastJobAt = Date.now();
    const answer = await run(r.job);
    lastJobAt = Date.now();
    await call('browser/result', { id: r.job.id, ok: answer.ok, data: answer.data }).catch(() => undefined);
  }
}

function run(job: Job): Promise<Answer> | Answer {
  if (job.op === 'routine') return runRoutine(job.args || {});
  if (job.op === 'clock_status' || job.op === 'cancel_timer' || job.op === 'cancel_alarms' || job.op === 'pause_timer' || job.op === 'resume_timer' || job.op === 'adjust_timer') return runClock(job.op, job.args || {});
  if (job.op === 'tablet_status') return runStatus();
  if (job.op === 'dnd') return runDnd(job.args || {});
  if (job.op === 'timer' || job.op === 'alarm' || job.op === 'reminder' || job.op === 'notify') return runTablet(job.op, job.args || {});
  return runBrowser(job);
}

/** The tablet's battery and Wi-Fi for Claude: the same words the voice gives (batterySay, wifiSay). Read only. */
function runStatus(): Answer {
  try {
    return { ok: true, data: `${batterySay(device.battery())} ${wifiSay(device.wifi())}` };
  } catch { return { ok: false, data: 'I can’t read the tablet’s battery or Wi-Fi right now.' }; }
}

/** Do Not Disturb for Claude: the same flag the Control Center tile and the voice set (prefs.dnd). Checked on the server; checked again here. */
function runDnd(a: Record<string, unknown>): Answer {
  if (typeof a.on !== 'boolean') return { ok: false, data: 'Say whether Do Not Disturb is on or off.' };
  if (prefs.dnd === a.on) return { ok: true, data: `Do Not Disturb is already ${a.on ? 'on' : 'off'}.` };
  prefs.dnd = a.on;
  return { ok: true, data: `Do Not Disturb is ${a.on ? 'on' : 'off'}.` };
}

/** The Clock's status and cancels for Claude: the Clock's own state, read or changed here on the tablet. */
function runClock(op: 'clock_status' | 'cancel_timer' | 'cancel_alarms' | 'pause_timer' | 'resume_timer' | 'adjust_timer', args: Record<string, unknown> = {}): Answer {
  const clock = getClock();
  if (!clock) return { ok: false, data: 'The tablet’s Clock isn’t ready. Try again in a moment.' };
  if (op === 'cancel_timer') {
    const label = str(args.label);
    if (label) return { ok: true, data: clock.cancelNamedTimer(label) ? `${label} timer cancelled.` : `There’s no ${label} timer.` };
    return { ok: true, data: clock.cancelTimer() ? 'Timer cancelled.' : 'There’s no timer running.' };
  }
  if (op === 'adjust_timer') {
    // the same change the voice makes (nudgeTimer on the Clock: the timer in front, capped at an hour)
    const m = typeof args.minutes === 'number' ? args.minutes : 0;
    if (!m || !clock.nudgeTimer(m)) return { ok: true, data: 'There’s no timer running.' };
    const n = Math.abs(m), amount = n === 60 ? 'an hour' : n === 30 ? 'half an hour' : `${n} minute${n === 1 ? '' : 's'}`;
    const left = clock.timerLeft();
    const now = left == null ? '' : ` A timer has ${Math.ceil(left / 60e3)} minute${Math.ceil(left / 60e3) === 1 ? '' : 's'} left.`;
    return { ok: true, data: `${m > 0 ? 'Added' : 'Took off'} ${amount}.${now}` };
  }
  if (op === 'pause_timer' || op === 'resume_timer') {
    // the same replies the voice gives (voice-commands.ts), named timer first, then the one in front
    const label = str(args.label), pausing = op === 'pause_timer';
    if (label) {
      const done = pausing ? clock.pauseNamedTimer(label) : clock.resumeNamedTimer(label);
      return { ok: true, data: done ? `${label} timer ${pausing ? 'paused' : 'resumed'}.` : `The ${label} timer ${pausing ? 'isn’t running' : 'isn’t paused'}.` };
    }
    if (pausing) return { ok: true, data: clock.pauseTimer() ? 'Timer paused.' : clock.timerPaused() ? 'The timer is already paused.' : 'There’s no timer running.' };
    if (clock.resumeTimer()) return { ok: true, data: 'Timer resumed.' };
    return { ok: true, data: clock.timerLeft() != null && !clock.timerPaused() ? 'The timer is already running.' : 'There’s no paused timer.' };
  }
  if (op === 'cancel_alarms') {
    const n = clock.cancelClaudeAlarms();
    return { ok: true, data: n ? `Switched off ${n} ${n === 1 ? 'alarm or reminder' : 'alarms or reminders'} that Claude set. Your own alarms are unchanged.` : 'Claude has no alarms or reminders on.' };
  }
  const left = clock.timerLeft();
  const mins = left == null ? 0 : Math.ceil(left / 60e3);
  // a paused timer keeps its time left, so say it is paused, not counting down (timerPaused on the Clock)
  const timer = left == null ? 'No timer is running.' : `A timer has ${mins} minute${mins === 1 ? '' : 's'} left${clock.timerPaused() ? ', and it is paused' : ''}.`;
  const on = clock.active();
  // the next alarm, with its time and whether it is today, tomorrow or a weekday (nextAlarm on the Clock)
  const next = clock.nextAlarm();
  const alarmSay = next ? ` Next alarm: ${hhmm(next.h, next.m)} ${next.when}.` : '';
  // the stopwatch's time and whether it runs, as the voice says it; nothing when it is at zero
  const sw = clock.stopwatchTime();
  const swSay = sw >= 1000 ? ` The stopwatch is ${clock.stopwatchRunning() ? 'running' : 'stopped'} at ${sayDuration(Math.floor(sw / 1000) * 1000)}.` : '';
  return { ok: true, data: `${timer} ${on ? `${on} timer${on === 1 ? '' : 's'} or alarm${on === 1 ? '' : 's'} on.` : 'No timers or alarms are on.'}${alarmSay}${swSay}` };
}

/** "17:05" for the answer, as Claude gave it (24-hour). */
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** A tablet job: the arguments were checked on the server; checked again here where the Clock's state lives. */
function runTablet(op: 'timer' | 'alarm' | 'reminder' | 'notify', a: Record<string, unknown>): Answer {
  if (op === 'notify') {
    const title = str(a.title).slice(0, 80), body = str(a.body).slice(0, 80);
    if (!title) return { ok: false, data: 'The notification needs a title.' };
    // a ClaudeOS banner, kept in the notification list; with Do Not Disturb on it only goes in the list
    notify({ title, ...(body ? { body } : {}), app: 'claude' }, prefs.dnd);
    return { ok: true, data: prefs.dnd ? 'The notification is in the tablet’s list; Do Not Disturb is on, so no banner showed.' : 'Notification shown on the tablet.' };
  }
  const clock = getClock();
  if (!clock) return { ok: false, data: 'The tablet’s Clock isn’t ready. Try again in a moment.' };
  if (clock.active() >= MAX_ACTIVE) return { ok: false, data: `There are already ${clock.active()} timers and alarms on (the most is ${MAX_ACTIVE}). Ask the user to turn one off in the Clock first.` };
  const label = str(a.label).slice(0, 80);
  if (op === 'timer') {
    const ms = num(a.ms);
    if (!(ms >= 60e3 && ms <= 720 * 60e3)) return { ok: false, data: 'A timer can be from 1 to 720 minutes.' };
    if (!clock.startTimer(ms, label)) return { ok: false, data: 'The timer list is full. Stop a timer first.' };
    const ends = new Date(Date.now() + ms);
    return { ok: true, data: `Timer set for ${str(a.words) || `${Math.round(ms / 60e3)} minutes`}${label ? ` (${label})` : ''}. It rings at ${hhmm(ends.getHours(), ends.getMinutes())}.` };
  }
  const h = num(a.h), m = num(a.m);
  if (!(Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(m) && m >= 0 && m <= 59)) return { ok: false, data: 'That isn’t a time the Clock can use.' };
  if (op === 'reminder' && !label) return { ok: false, data: 'The reminder needs some text to show.' };
  const days = Array.isArray(a.days) ? (a.days as number[]) : [];
  const set = clock.addLabelled(h, m, label, days);
  if (!set) return { ok: false, data: 'The tablet’s Clock is full (20 alarms). Ask the user to delete one in the Clock first.' };
  return op === 'reminder'
    ? { ok: true, data: `Reminder set for ${hhmm(h, m)} ${set.when}: “${label}”. The Clock will ring and show it then.` }
    : { ok: true, data: `Alarm set for ${hhmm(h, m)} ${set.when}${label ? ` (${label})` : ''}.` };
}

/** run_routine (routines/server/tools.ts): the Routines app's runner starts it by id (it reads the routine from the
 *  PC again, so only a saved routine runs) and the answer comes as soon as it has started. */
async function runRoutine(a: Record<string, unknown>): Promise<Answer> {
  const r = a.routine && typeof a.routine === 'object' ? a.routine as { id?: unknown; name?: unknown } : {};
  const id = str(r.id), name = str(r.name).slice(0, 40);
  const api = getRoutines();
  if (!api) return { ok: false, data: 'Routines aren’t ready on the tablet. Try again in a moment.' };
  if (!id) return { ok: false, data: `The tablet couldn’t find the routine ${name || id}.` };
  const res = await api.run(id);
  if (res === 'empty') return { ok: false, data: 'That routine has no steps yet.' };
  if (res === 'offline') return { ok: false, data: 'The PC isn’t answering, so that routine can’t start.' };
  if (res !== 'started') return { ok: false, data: `The tablet couldn’t find the routine ${name || id}.` };
  return { ok: true, data: `Started ${name || 'the routine'} on the tablet.` };
}

/** One browser job through the Browser: the tab on screen (the Browser's current tab) and its native calls.
 *  open and back go through the Browser app's own functions (state.ts BrowserControl); open makes its new tab the
 *  current one, so the read, click, type and screenshot that follow work on it. */
async function runBrowser(job: Job): Promise<Answer> {
  if (job.op === 'open' || job.op === 'back') {
    const control = getControl();
    if (!control) return { ok: false, data: 'The Browser isn’t ready on the tablet. Try again in a moment.' };
    try { return job.op === 'open' ? await control.open(job.text ?? '') : await control.back(); }
    catch (e) { return { ok: false, data: (e as Error).message || 'The Browser could not do that.' }; }
  }
  const tab = cur()?.id;
  if (!tab || !cur().url) return { ok: false, data: 'The Browser has no page open. Open one with browser_open first.' };
  try {
    if (job.op === 'read') return { ok: true, data: JSON.stringify(await browser.readPage(tab)) };
    if (job.op === 'screenshot') return { ok: true, data: await browser.screenshot(tab) };
    if (job.op === 'click') {
      const out = await browser.click(tab, job.ref ?? '');
      return out === 'ok' ? { ok: true, data: 'Clicked.' } : { ok: false, data: 'That element is no longer on the page. Read the page again.' };
    }
    const out = await browser.type(tab, job.ref ?? '', job.text ?? '');
    return out === 'ok' ? { ok: true, data: 'Typed.' } : { ok: false, data: 'That field is no longer on the page. Read the page again.' };
  } catch (e) {
    return { ok: false, data: (e as Error).message || 'The Browser could not run that.' };
  }
}
