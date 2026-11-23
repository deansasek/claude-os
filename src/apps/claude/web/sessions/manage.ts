// A session's actions, from the ⋯ on its row in the sidebar: Archive (or Unarchive), and Delete. Delete asks
// once more before it goes. Both go to the server behind the PIN (pin.ts), and the screen is told what changed
// so it can move on (reply.ts: back to the new-session screen if the open session was the one touched).
// The tablet's own chat (NATIVE_ID) has no server session: its ⋯ offers only Clear this chat (native.ts), local.
import { report } from '../../../../core/web/dom.ts';
import type { AppContext } from '../../../../core/web/shell.ts';
import { onBack } from '../../../../core/web/system.ts';
import { nativeBusy, nativeClear, NATIVE_ID } from '../native.ts';
import { copyText } from '../reply.ts';
import { call, withPin } from './pin.ts';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

type ManageDone ='archived' | 'unarchived' | 'deleted' | 'cleared';
let target: { id: string; title: string; archived: boolean } | null = null;
let done: (id: string, what: ManageDone) => void = () => {};

const MESSAGES: Record<string, string> = {
  running: 'Claude is still working in this one. Let it finish, then try again.',
  open_on_pc: 'It is open in a Claude Code window on your PC. Close it there first.',
  not_found: 'That session is already gone.',
  not_this_session: 'Nothing was deleted: the file did not look like this session’s.',
  delete_failed: "Couldn't delete: the file is in use on your PC.",
};

function show(acts: boolean): void {
  $('smActs').hidden = !acts;
  $('smConfirm').hidden = acts;
}
function close(): void {
  $('svSessMenu').hidden = true;
  target = null;
}
function say(text: string): void { $('smMsg').textContent = text; }

/** Open the menu for one session (from its row's ⋯). */
export function openSessionMenu(id: string, title: string, archived: boolean): void {
  target = { id, title, archived };
  const tablet = id === NATIVE_ID;
  $('smTitle').textContent = title;
  $('smArchive').hidden = tablet;
  $('smArchiveText').textContent = archived ? 'Unarchive' : 'Archive';
  $('smDeleteText').textContent = tablet ? 'Clear this chat' : 'Delete';
  $('smAsk').textContent = tablet ? 'Clear this chat? It leaves this screen and the list. The tablet keeps its session files.' : 'Delete this session? This can’t be undone.';
  $('smGone').textContent = tablet ? 'Clear' : 'Delete';
  $('smCopy').hidden = id === NATIVE_ID;   // a PC session's id only: the tablet's own chat has none
  say('');
  show(true);
  $('svSessMenu').hidden = false;
  report('session-menu');
}

async function changeState(on: boolean): Promise<void> {
  const t = target;
  if (!t || t.id === NATIVE_ID) return;
  const act = async (): Promise<void> => {
    const r = await call<{ ok: boolean; error?: string }>('archive', { id: t.id, archived: on });
    if (!r.ok) { say(MESSAGES[r.error || ''] || 'Nothing was changed. Try again.'); return; }
    close();
    done(t.id, on ? 'archived' : 'unarchived');
  };
  report(on ? 'session-archive' : 'session-unarchive');
  await withPin(act);
}

/** Copies the PC session's id to the clipboard (the same copy path as a message's Copy). The menu stays open. */
async function copyId(): Promise<void> {
  const t = target;
  if (!t || t.id === NATIVE_ID) return;
  const ok = await copyText(t.id);
  report(ok ? 'copy-session-id' : 'copy-session-id-failed');
  say(ok ? 'Session id copied.' : 'Couldn’t copy the session id.');
}

async function remove(): Promise<void> {
  const t = target;
  if (!t) return;
  if (t.id === NATIVE_ID) {   // the tablet's chat: cleared here only, nothing goes to the hub or the PIN
    if (nativeBusy()) { say(MESSAGES.running); return; }
    close();
    nativeClear();
    done(t.id, 'cleared');
    report('native-clear');
    return;
  }
  const act = async (): Promise<void> => {
    const r = await call<{ ok: boolean; error?: string }>('delete', { id: t.id });
    if (!r.ok) {
      show(true);
      say(MESSAGES[r.error || ''] || 'Nothing was deleted. Try again.');
      return;
    }
    close();
    done(t.id, 'deleted');
  };
  report('session-delete');
  await withPin(act);
}

export function initManage(context: AppContext, onDone: (id: string, what: ManageDone) => void): void {
  ctx = context;
  done = onDone;
  $('smArchive').addEventListener('click', () => { if (target) void changeState(!target.archived); });
  $('smDelete').addEventListener('click', () => { say(''); show(false); });
  $('smKeep').addEventListener('click', () => { say(''); show(true); });
  $('smGone').addEventListener('click', () => { void remove(); });
  $('smCopy').addEventListener('click', () => { void copyId(); });
  $('smClose').addEventListener('click', close);
  $('svSessMenu').addEventListener('click', e => { if (e.target === $('svSessMenu')) close(); });   // tap the dimmed part to close
  // Back: the delete confirmation goes back to the actions (as Keep it does), then the menu closes
  onBack(() => {
    if (!ctx.isVisible() || $('svSessMenu').hidden) return false;
    if (!$('smConfirm').hidden) { say(''); show(true); return true; }
    close();
    return true;
  }, 20);
}
