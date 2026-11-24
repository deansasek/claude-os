// Settings → Security → "PIN to unlock": set, change or remove the ClaudeOS PIN on ClaudeOS's own pad (core/web/pin-pad.ts),
// never the Android keyboard. The PC keeps the PIN (server/pin.ts); this sheet only asks it. Set and Change ask for the
// new PIN twice; Change and Remove ask for the current PIN first. Five wrong tries on the PC give a 30-second wait.
import { getJson, postJson, report } from '../../../core/web/dom.ts';
import { rememberPinSet } from '../../../core/web/lock.ts';
import { clearLocalRecord, saveLocalPin } from '../../../core/web/pin-local.ts';
import { padKey, padKeysHtml, paintDots, PAD_MAX, PAD_MIN } from '../../../core/web/pin-pad.ts';
import type { AppContext } from '../../../core/web/shell.ts';
import type { PinResult, PinStatus } from '../api.ts';

type Mode = 'set' | 'change' | 'remove';
type Step = 'current' | 'new' | 'confirm';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let status: PinStatus | null = null;   // null: the PC couldn't be asked
let mode: Mode = 'set';
let step: Step = 'new';
let typed = '';
let firstNew = '';                     // the first entry of a new PIN
let current = '';                      // the PIN checked at the first step of Change
let msg = '';
let busy = false;
let until = 0;                         // the cooldown ends (ms)
let tick: number | undefined;

const cooling = (): boolean => Date.now() < until;
const cooldownText = (): string => {
  const secs = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  return `Too many tries. Wait ${secs} ${secs === 1 ? 'second' : 'seconds'}.`;
};

/** The row: Off or On, and the buttons that go with it. Read again each time the Security page opens. */
export async function paintPinRow(): Promise<void> {
  try { status = await getJson<PinStatus>('/api/settings/pin'); } catch { status = null; }
  if (status) {
    rememberPinSet(status.set);
    // the tablet's copy is made when a PIN is set or changed on this tablet (saveLocalPin); gone on the PC → forget it
    if (!status.set) clearLocalRecord();
  }
  const on = status?.set === true;
  $('stPinState').textContent = status ? (on ? 'On' : 'Off') : '–';
  $('stPinNote').textContent = status
    ? 'Asks for the PIN when the tablet wakes from the ambient screen. Not on app switches.'
    : 'Can’t reach your PC to check the PIN. Try again when it’s back.';
  $('stPinSet').hidden = on;
  $('stPinChange').hidden = !on;
  $('stPinRemove').hidden = !on;
  for (const b of [$<HTMLButtonElement>('stPinSet'), $<HTMLButtonElement>('stPinChange'), $<HTMLButtonElement>('stPinRemove')]) b.disabled = !status;
}

function headline(): { title: string; intro: string; done: string } {
  if (step === 'current') {
    return mode === 'remove'
      ? { title: 'Remove the PIN', intro: 'Enter your PIN. ClaudeOS stops asking for it.', done: 'Remove' }
      : { title: 'Change the PIN', intro: 'Enter your current PIN first.', done: 'Next' };
  }
  if (step === 'new') {
    return { title: mode === 'set' ? 'Set a PIN' : 'Choose a new PIN', intro: `${PAD_MIN} to ${PAD_MAX} digits. ClaudeOS asks for it when the tablet wakes from the ambient screen.`, done: 'Next' };
  }
  return { title: 'Enter it again', intro: 'So you know it’s right.', done: 'Save' };
}

function paintSheet(): void {
  const h = headline();
  $('stPinTitle').textContent = h.title;
  $('stPinIntro').textContent = h.intro;
  paintDots($('stPinDots'), typed.length);
  $('stPinMsg').textContent = cooling() ? cooldownText() : msg;
  $('stPinDone').textContent = h.done;
  $('stPinDone').toggleAttribute('disabled', busy || cooling() || typed.length < PAD_MIN);
  $('stPinKeys').querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = busy || cooling(); });
}

function startCooldown(secs: number): void {
  until = Date.now() + secs * 1000;
  clearInterval(tick);
  tick = window.setInterval(() => {
    if (!cooling()) { clearInterval(tick); msg = ''; }
    paintSheet();
  }, 1000);
  paintSheet();
}

function openSheet(m: Mode): void {
  mode = m; step = m === 'set' ? 'new' : 'current';
  typed = ''; firstNew = ''; current = ''; msg = ''; busy = false;
  $('stPin').hidden = false;
  if (status && status.lockedFor > 0) startCooldown(status.lockedFor);
  paintSheet();
}

function closeSheet(): void {
  $('stPin').hidden = true;
  typed = ''; msg = ''; busy = false;
  clearInterval(tick);
}

/** One call to the PC. Returns the result when it's ok; otherwise shows what went wrong on the pad and returns null. */
async function attempt(call: () => Promise<PinResult>): Promise<PinResult | null> {
  busy = true; paintSheet();
  let r: PinResult | null;
  try { r = await call(); } catch { r = null; }
  busy = false;
  typed = '';
  if (!r) msg = 'Can’t reach your PC. Try again when it’s back.';
  else if (r.ok) return r;
  else if (r.error === 'locked') { startCooldown(r.lockedFor || 30); return null; }
  else if (r.error === 'wrong') msg = r.left == null ? 'That’s not it. Try again.' : `That’s not it. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left before a 30-second wait.`;
  else if (r.error === 'no_pin') { msg = 'No PIN is set on the PC.'; void paintPinRow(); }
  else if (r.error === 'bad_pin') msg = `Use ${PAD_MIN} to ${PAD_MAX} digits.`;
  else msg = 'The PC couldn’t save that. Try again.';
  paintSheet();
  return null;
}

async function finish(call: () => Promise<PinResult>, tag: string, pin?: string): Promise<void> {
  if (!(await attempt(call))) return;
  report(tag);
  closeSheet();
  if (pin) void saveLocalPin(pin);
  if (mode === 'remove') clearLocalRecord();   // the tablet's copy of the PIN goes with the PIN
  void paintPinRow();
}

async function done(): Promise<void> {
  if (busy || cooling() || typed.length < PAD_MIN) return;
  const pin = typed;
  if (step === 'new') { firstNew = pin; step = 'confirm'; typed = ''; msg = ''; paintSheet(); return; }
  if (step === 'confirm') {
    if (pin !== firstNew) { step = 'new'; firstNew = ''; typed = ''; msg = 'Those don’t match. Start again.'; paintSheet(); return; }
    const cur = mode === 'change' ? current : undefined;
    await finish(() => postJson<PinResult>('/api/settings/pin', { pin, current: cur }), `settings:pin:${mode}`, pin);
    return;
  }
  if (mode === 'remove') { await finish(() => postJson<PinResult>('/api/settings/pin/remove', { pin }), 'settings:pin:remove'); return; }
  // Change: the current PIN is checked first (a wrong one counts as a failed try on the PC), then the new one
  const r = await attempt(() => postJson<PinResult>('/api/settings/pin/check', { pin }));
  if (!r) return;
  current = pin; step = 'new'; msg = '';
  paintSheet();
}

export function initPinSettings(context: AppContext): void {
  ctx = context;
  $('stPinKeys').innerHTML = padKeysHtml();
  $('stPinKeys').addEventListener('click', e => {
    const k = padKey(e);
    if (!k || busy || cooling()) return;
    if (k === 'back') typed = typed.slice(0, -1);
    else if (typed.length < PAD_MAX) typed += k;
    msg = '';
    paintSheet();
  });
  $('stPinDone').addEventListener('click', () => void done());
  $('stPinCancel').addEventListener('click', closeSheet);
  $('stPinSet').addEventListener('click', () => openSheet('set'));
  $('stPinChange').addEventListener('click', () => openSheet('change'));
  $('stPinRemove').addEventListener('click', () => openSheet('remove'));
}
