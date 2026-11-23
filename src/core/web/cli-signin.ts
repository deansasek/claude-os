// Signing the official Claude Code CLI in on the tablet (android/.../cli/ClaudeCli.java), for chats that run on the
// tablet (apps/claude/web/native.ts). Settings → Apps → Claude → Sign in starts it (device.cliSigninStart). The tablet
// downloads the CLI on first use, runs `claude auth login` and calls window.hubCliSignin(step) at each step:
//   prepare  the sign-in started (the first one downloads the CLI first)
//   open     the tablet opened the sign-in address in ClaudeOS's own Browser app (BrowserView.offer; no address to type)
//   code     the CLI takes a code now
//   done     the login ended (ok: `claude auth status` says signed in)
//   status   a sign-in check ended (device.cliAuthState(true)); signedIn 1 or 0
// open and code carry left: the seconds until the tablet stops the login (10 minutes from its start).
// The sheet never opens by itself: the user needs the claude.ai page to get the code. While the CLI takes a code, the
// Browser's bar shows an "Enter sign-in code" button with the time left, so a closed sheet or keyboard can always be
// opened again. The sheet has the code field (tap to type, long-press to paste), Paste, Send and Cancel. Paste reads the
// clipboard natively (Bridge.cliSigninClipboard; the WebView's own clipboard read is blocked). Send writes the code to
// the CLI's stdin (Bridge.cliSigninCode) and closes the sheet; Cancel closes it and leaves the login running.
// The field is cleared after every send and when the sheet closes. The page never logs, stores or reports the code.
// The page imports nothing at run time, so the test can load it.

export type SigninStep =
  | { step: 'prepare' }
  | { step: 'open'; code?: boolean; left?: number }
  | { step: 'code'; left?: number }
  | { step: 'done'; ok: boolean }
  | { step: 'status'; signedIn: number };

/** What one Send does: the text to hand to the tablet (null: nothing to send, msg says why), and the field after it. */
export interface SendPlan { send: string | null; field: ''; msg?: string }

/** The send logic. An empty field sends nothing; a code with a line break is refused (it would end the CLI's line early). */
export function planSend(field: string): SendPlan {
  const code = field.trim();
  if (!code) return { send: null, field: '', msg: 'Tap Paste, or type the code.' };
  if (/[\r\n]/.test(code)) return { send: null, field: '', msg: 'Paste the code only, on one line.' };
  return { send: code, field: '' };
}

const ended = (why: string) => why === 'no sign-in is waiting' || why === 'the sign-in has ended';

/** The result of a send, as the sheet words it: null when it went, else the line to show. */
export function sendResult(send: (code: string) => unknown, code: string): string | null {
  try { send(code); return null; } catch (e) {
    const why = e instanceof Error ? e.message : '';
    if (why === 'no code to send') return 'Copy the code on claude.ai first, then tap Paste.';
    if (ended(why)) return 'This sign-in has ended. Start it again.';
    return 'Couldn’t send the code. Try again.';
  }
}

/** The result of a Paste: the clipboard's text, or the line to show. */
export function pasteResult(paste: () => string): { text: string } | { msg: string } {
  try { return { text: paste() }; } catch (e) {
    const why = e instanceof Error ? e.message : '';
    if (ended(why)) return { msg: 'This sign-in has ended. Start it again.' };
    return { msg: 'Nothing to paste. Copy the code on claude.ai first.' };
  }
}

/** Seconds as m:ss. */
export function formatLeft(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface SigninDeps {
  sendCode(code: string): unknown;            // device.cliSigninCode; throws with the reason
  paste(): string;                            // device.cliSigninClipboard; throws with the reason
  secondsLeft(): number;                      // device.cliSigninState: a running login after a page reload (-1: none)
  keyboard(o: { value: string; placeholder: string; done: string; mask: boolean; max: number; paste(): string | null;
    onChange(t: string): void; onDone(t: string): void; onClose(): void }): void;
  keyboardClose(): void;
  notify(title: string, body: string): void;
  onBack(fn: () => boolean, prio?: number): () => void;
  onStatus(): void;                           // the sign-in state may have changed (Settings repaints its row)
}

export function initCliSignin(d: SigninDeps): void {
  let root: HTMLElement | null = null;
  let pill: HTMLButtonElement | null = null;
  let deadline = 0;           // while the CLI takes a code: when the tablet stops the login (Date.now() ms)
  let field = '';             // the code, only until it is sent or the sheet closes
  let typing = false;         // the keyboard is open for the field
  let unBack: (() => void) | null = null;
  let tick: number | undefined;

  const left = () => deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : 0;
  const $ = <T extends HTMLElement>(sel: string) => root!.querySelector<T>(sel)!;
  const paintTime = () => { if (root) $('p.cs-time').textContent = `${formatLeft(left())} left to sign in`; };
  const paint = (msg = '') => {
    if (!root) return;
    $('.cs-field b').textContent = field ? '•'.repeat(Math.min(field.length, 24)) : 'Tap to type, or long-press to paste';
    $('.cs-field b').style.color = field ? '' : 'var(--t4)';
    paintTime();
    const p = $('p.cs-msg');
    p.textContent = msg;
    p.hidden = !msg;
  };
  const paintPill = () => {
    if (!pill) {   // in the Browser's bar, after the address: the app the user signs in with
      const bar = document.querySelector('#app-browser .br-bar');
      if (!bar || !deadline) return;
      pill = document.createElement('button');
      pill.className = 'cs-pill hit';
      pill.innerHTML = '<b>Enter sign-in code</b><small></small>';
      pill.addEventListener('click', show);
      const addr = bar.querySelector('#brAddr');
      if (addr) addr.after(pill); else bar.appendChild(pill);
    }
    pill.hidden = !deadline;
    pill.querySelector('small')!.textContent = `${formatLeft(left())} left`;
  };
  const close = () => {
    field = '';
    if (typing) { typing = false; d.keyboardClose(); }
    if (root && !root.hidden) { root.hidden = true; dispatchEvent(new CustomEvent('hub:cover', { detail: false })); }
    unBack?.(); unBack = null;
  };
  const stop = () => {   // the login no longer takes a code
    deadline = 0;
    clearInterval(tick); tick = undefined;
    close();
    paintPill();
  };
  const start = (sec: number | undefined) => {
    deadline = Date.now() + Math.max(0, sec ?? 600) * 1000;
    if (tick == null) tick = window.setInterval(() => {
      if (left() <= 0) { stop(); return; }
      paintPill();
      if (root && !root.hidden) paintTime();
    }, 1000);
    paintPill();
  };
  const send = () => {
    const plan = planSend(field);
    field = plan.field;   // cleared at once, sent or not
    if (plan.send == null) { paint(plan.msg); return; }
    const msg = sendResult(d.sendCode, plan.send);
    if (msg) { paint(msg); return; }
    stop();   // stdin is closed now: the CLI checks the code and exits ('done')
  };
  const paste = (): string | null => {
    const r = pasteResult(d.paste);
    if ('msg' in r) { paint(r.msg); return null; }
    field = r.text;
    paint();
    return r.text;
  };
  const type = () => {
    typing = true;
    d.keyboard({ value: field, placeholder: 'Sign-in code', done: 'Send', mask: true, max: 2048, paste,
      onChange: t => { field = t; paint(); },
      onDone: t => { typing = false; field = t; send(); },
      onClose: () => { typing = false; } });
  };
  function show(): void {
    if (!deadline) return;
    if (!root) {
      root = document.createElement('div');
      root.className = 'pw cs';
      root.hidden = true;
      root.innerHTML = '<div class="pw-card" role="dialog" aria-modal="true"><div class="cc-grab"></div>'
        + '<h3>Sign in to Claude Code</h3><p>Copy the code claude.ai shows you, then tap Paste and Send.</p>'
        + '<p class="cs-time"></p>'
        + '<div class="pw-group"><button class="pw-btn cs-field hit" data-b="field"><b></b></button>'
        + '<button class="pw-btn hit" data-b="paste"><b>Paste</b></button>'
        + '<button class="pw-btn hit" data-b="send"><b>Send</b></button></div><p class="cs-msg" hidden></p>'
        + '<button class="pw-btn pw-cancel hit" data-b="cancel"><b>Cancel</b></button></div>';
      const f = root.querySelector<HTMLElement>('[data-b="field"]')!;
      let press: number | undefined, pressed = false;   // a long press on the field pastes
      const unpress = () => { clearTimeout(press); press = undefined; };
      f.addEventListener('pointerdown', () => { pressed = false; unpress(); press = window.setTimeout(() => { pressed = true; paste(); }, 550); });
      (['pointerup', 'pointerleave', 'pointercancel'] as const).forEach(ev => f.addEventListener(ev, unpress));
      f.addEventListener('contextmenu', e => e.preventDefault());
      root.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]')?.dataset.b;
        if (b === 'send') send();
        else if (b === 'paste') paste();
        else if (b === 'cancel' || e.target === root) close();
        else if (b === 'field') { if (pressed) pressed = false; else type(); }
      });
      document.getElementById('stage')!.appendChild(root);
    }
    paint();
    if (root.hidden) { root.hidden = false; dispatchEvent(new CustomEvent('hub:cover', { detail: true })); }   // hides the Browser's native page meanwhile
    if (!unBack) unBack = d.onBack(() => { close(); return true; }, 110);
  }

  (window as unknown as { hubCliSignin: (s: SigninStep) => void }).hubCliSignin = s => {
    if (s.step === 'prepare') {
      d.notify('Signing in to Claude on this tablet', 'The first time, Claude Code downloads first (about 365 MB). The Browser opens when it is ready.');
      d.onStatus();
    } else if (s.step === 'status') {
      d.onStatus();
    } else if (s.step === 'open') {
      if (s.code) start(s.left);   // claude.ai shows a code to copy: the button comes up; the Browser stays on screen
    } else if (s.step === 'code') {
      start(s.left);
    } else if (s.step === 'done') {
      stop();
      d.notify(s.ok ? 'Claude Code is signed in' : 'Claude Code isn’t signed in', s.ok ? '' : 'The sign-in ended. Try again.');
      d.onStatus();
    }
  };
  const running = d.secondsLeft();   // a login that was already running when the page (re)loaded
  if (running > 0) start(running);
}
