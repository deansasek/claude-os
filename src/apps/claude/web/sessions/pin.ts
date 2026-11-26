// Actions from Claude Home (reply, approve, stop, new session) and the PIN pad that guards them.
// The server asks for the PIN only when one is set on the PC; the unlock lasts a few minutes.
import { postJson, report } from '../../../../core/web/dom.ts';
import type { AppContext } from '../../../../core/web/shell.ts';
import { onBack } from '../../../../core/web/system.ts';
import type { UnlockResult } from '../../api.ts';
import { LOCK_DEFAULT_SECS, waitText } from './pin-wait.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let token: string | null = null, tokenUntil = 0;
let pending: (() => Promise<void>) | null = null;   // the action waiting on the PIN
let pin = '';

/** Try the action; only if the server says a PIN is set and needed, ask for it and try again. */
export async function withPin(action: () => Promise<void>): Promise<void> {
  if (token && Date.now() >= tokenUntil) token = null;
  try { await action(); return; } catch (e) { if ((e as Error).message !== 'locked_out') throw e; }
  token = null; pending = action; showPin();
}

/** POST to /api/claude/<path> with the unlock token; throws 'locked_out' when the PIN is needed. */
export async function call<T extends { ok: boolean; error?: string }>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await postJson<T>(`/api/claude/${path}`, { ...body, token });
  if (!r.ok && r.error === 'locked_out') throw new Error('locked_out');
  tokenUntil = Date.now() + 9 * 60e3;   // the server keeps an unlock alive while it's being used
  return r;
}

export const hidePin = (): void => { $('pin').hidden = true; };

function showPin(): void {
  pin = '';
  $('pin').hidden = false;
  $('pinMsg').innerHTML = '&nbsp;';
  paintPin();
}

function paintPin(): void {
  $('pinDots').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
}

async function submitPin(): Promise<void> {
  if (pin.length < 4) { $('pinMsg').textContent = 'At least 4 digits'; return; }
  const r = await postJson<UnlockResult>('/api/claude/unlock', { pin });
  pin = ''; paintPin();
  if (!r.ok) {
    $('pinMsg').textContent = r.error === 'locked' ? waitText(r.retryIn || LOCK_DEFAULT_SECS)
      : r.error === 'no_pin' ? 'No PIN is set on the PC yet.' : 'That’s not it. Try again.';
    report('pin-wrong');
    return;
  }
  token = r.token!; tokenUntil = Date.now() + (r.ttl || 600) * 1000 - 30e3;
  $('pin').hidden = true;
  report('pin-ok');
  const go = pending; pending = null;
  if (go) await go();
}

export function initPin(context: AppContext): void {
  ctx = context;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancel', '0', 'OK'];
  $('pinKeys').innerHTML = keys.map(k => `<button data-k="${k}" class="${k.length > 1 ? 'small' : ''}">${k}</button>`).join('');
  $('pinKeys').addEventListener('click', e => {
    const k = (e.target as Element).closest<HTMLElement>('button')?.dataset.k;
    if (!k) return;
    if (k === 'Cancel') { $('pin').hidden = true; pending = null; return; }
    if (k === 'OK') { void submitPin(); return; }
    if (pin.length < 8) { pin += k; paintPin(); $('pinMsg').innerHTML = '&nbsp;'; }
  });
  // Back on the PIN pad is Cancel: the action waiting on it is dropped
  onBack(() => {
    if (!ctx.isVisible() || $('pin').hidden) return false;
    $('pin').hidden = true; pending = null;
    return true;
  }, 20);
}
