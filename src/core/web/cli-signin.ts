// SPIKE: signing the official Claude Code CLI in on the tablet (android/.../node/NativeClaudeRunner.java).
// The tablet runs `claude auth login` and calls window.hubCliSignin(step) at each step:
//   open   the tablet opened the sign-in address in ClaudeOS's own Browser app (BrowserView.offer; no address to type)
//   code   the CLI takes a code now: the sheet is ready (it shows when the Browser is not on screen, or on 'copied')
//   copied the clipboard changed while a code is wanted (the Copy on claude.ai): the sheet comes up over the Browser
//   done   the CLI exited (ok: exit code 0)
// The sheet has one field and a Paste button. Paste with an empty field sends '' and the tablet takes the clipboard's
// text itself, so the code never passes through the page; a typed code is sent as typed. The field is cleared after
// every send. The page never logs, stores or reports the code. The page imports nothing at run time, so the test can load it.

export type SigninStep =
  | { step: 'open'; code?: boolean }
  | { step: 'code' }
  | { step: 'copied' }
  | { step: 'done'; ok: boolean };

/** What one Send does: the text to hand to the tablet (null: nothing to send), and the field after it. */
export interface SendPlan { send: string | null; field: '' }

/** The send logic. An empty field means "the clipboard" (''); a code with a line break is refused (it would end the CLI's line early). */
export function planSend(field: string): SendPlan {
  const code = field.trim();
  if (/[\r\n]/.test(code)) return { send: null, field: '' };
  return { send: code, field: '' };
}

/** The result of a send, as the sheet words it: null when it went, else the line to show. */
export function sendResult(send: (code: string) => unknown, code: string): string | null {
  try { send(code); return null; } catch (e) {
    const why = e instanceof Error ? e.message : '';
    if (why === 'no code to send') return 'Copy the code on claude.ai first, then tap Paste code.';
    if (why === 'no sign-in is waiting' || why === 'the sign-in has ended') return 'This sign-in has ended. Start it again.';
    return 'Couldn’t send the code. Try again.';
  }
}

export interface SigninDeps {
  appOnScreen(id: string): boolean;
  sendCode(code: string): unknown;            // device.cliSigninCode; throws with the reason
  keyboard(o: { value: string; placeholder: string; done: string; mask: boolean; max: number;
    onChange(t: string): void; onDone(t: string): void }): void;
  notify(title: string, body: string): void;
  onBack(fn: () => boolean, prio?: number): () => void;
}

export function initCliSignin(d: SigninDeps): void {
  let root: HTMLElement | null = null;
  let waiting = false;        // the CLI takes a code now
  let field = '';             // a typed code, only until it is sent or the sheet closes
  let unBack: (() => void) | null = null;

  const $ = <T extends HTMLElement>(sel: string) => root!.querySelector<T>(sel)!;
  const paint = (msg = '') => {
    $('.cs-field b').textContent = field ? '•'.repeat(Math.min(field.length, 24)) : 'Tap Paste code, or type it here';
    $('.cs-field b').style.color = field ? '' : 'var(--t4)';
    $<HTMLElement>('[data-b="send"] b').textContent = field ? 'Send code' : 'Paste code';
    const p = $('p.cs-msg');
    p.textContent = msg;
    p.hidden = !msg;
  };
  const close = () => {
    field = '';
    if (root && !root.hidden) { root.hidden = true; dispatchEvent(new CustomEvent('hub:cover', { detail: false })); }
    unBack?.(); unBack = null;
  };
  const send = () => {
    const plan = planSend(field);
    field = plan.field;   // cleared at once, sent or not
    if (plan.send == null) { paint('Paste the code only, on one line.'); return; }
    const msg = sendResult(d.sendCode, plan.send);
    if (msg) { paint(msg); return; }
    waiting = false;
    close();
  };
  const show = () => {
    if (!waiting) return;
    if (!root) {
      root = document.createElement('div');
      root.className = 'pw cs';
      root.hidden = true;
      root.innerHTML = '<div class="pw-card" role="dialog" aria-modal="true"><div class="cc-grab"></div>'
        + '<h3>Sign in to Claude Code</h3><p>Copy the code claude.ai shows you, then tap Paste code.</p>'
        + '<div class="pw-group"><button class="pw-btn cs-field hit" data-b="field"><b></b></button>'
        + '<button class="pw-btn hit" data-b="send"><b></b></button></div><p class="cs-msg" hidden></p>'
        + '<button class="pw-btn pw-cancel hit" data-b="cancel"><b>Not now</b></button></div>';
      root.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]')?.dataset.b;
        if (b === 'send') send();
        else if (b === 'cancel' || e.target === root) close();
        else if (b === 'field') d.keyboard({ value: field, placeholder: 'Code', done: 'Send', mask: true, max: 2048,
          onChange: t => { field = t; paint(); }, onDone: t => { field = t; send(); } });
      });
      document.getElementById('stage')!.appendChild(root);
    }
    paint();
    if (root.hidden) { root.hidden = false; dispatchEvent(new CustomEvent('hub:cover', { detail: true })); }   // hides the Browser's native page meanwhile
    if (!unBack) unBack = d.onBack(() => { close(); return true; }, 110);
  };

  (window as unknown as { hubCliSignin: (s: SigninStep) => void }).hubCliSignin = s => {
    if (s.step === 'open') {
      if (s.code) waiting = true;   // the tablet has opened the address in the Browser app itself
    } else if (s.step === 'code') {
      waiting = true;
      if (!d.appOnScreen('browser')) show();
    } else if (s.step === 'copied') {
      show();
    } else if (s.step === 'done') {
      waiting = false;
      close();
      d.notify(s.ok ? 'Claude Code is signed in' : 'Claude Code isn’t signed in', s.ok ? '' : 'The sign-in ended. Try again.');
    }
  };
}
