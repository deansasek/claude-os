// On-screen keyboard shared by every app. It slides up from the bottom of the screen.
//
//   Keyboard.open({ placeholder: 'Search', autoCap: true, done: 'Search',
//                   onChange: text => …, onDone: text => …, onClose: (reason, text) => … })
//
// onDone may return false to keep the keyboard open. done is the bar's action label (Go, Search, Send...);
// it matches the native keyboard, which labels its Done with the field's action.
import { $, esc } from './dom.ts';
import { device } from './device.ts';

interface KeyboardOptions {
  value?: string;
  placeholder?: string;
  done?: string;            // the bar's action label, default 'Done'
  autoCap?: boolean;        // capitalise the first letter of each word
  max?: number;
  mask?: boolean;           // a secret (e.g. an access token): the bar shows dots, and only the last character typed
  onChange?: (text: string) => void;
  onDone?: (text: string) => boolean | void;
  onClose?: (reason: CloseReason, text: string) => void;
}
type CloseReason ='done' | 'cancel' | 'nav' | 'chosen' | 'close';

type Layout = 'alpha' | 'sym';
const LAYOUTS: Record<Layout, string[][]> = {
  alpha: [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
          ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'], ['123', ',', 'space', '.', '-', "'"]],
  sym:   [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['@', '#', '&', '(', ')', '/', ':', ';', '?', '!'],
          ['"', '_', '+', '=', '*', '%', '$', '⌫'], ['ABC', ',', 'space', '.', '-', "'"]],
};
const WIDE = new Set(['⇧', '⌫', '123', 'ABC']);

let opts: KeyboardOptions | null = null;
let val = '', layout: Layout = 'alpha', shift = false;
let repeatTimer: number | undefined;

const shiftOn = () => shift || (!!opts?.autoCap && (val === '' || /[ -]$/.test(val)));

// ⇧ and ⌫ are drawn as the native keyboard draws them (KeyboardView.drawShift / drawBackspace), so both look alike
const ICON: Record<string, string> = {
  '⇧': '<svg class="kb-ico kb-ico-shift" viewBox="-6 -6 12 12" aria-hidden="true"><path d="M0-6L4.8-.3H2.5V4.8H-2.5V-.3H-4.8Z"/></svg>',
  '⌫': '<svg class="kb-ico" viewBox="-6 -6 12 12" aria-hidden="true"><path d="M-5.7 0L-2.7-4.5H6V4.5H-2.7Z"/><path d="M.6-2.1L4.2 2.1M4.2-2.1L.6 2.1"/></svg>',
};
const ARIA: Record<string, string> = { '⇧': 'Shift', '⌫': 'Delete' };

// Key clicks: the Settings switch "Key sounds" (off by default), read each time the keyboard opens.
let sounds = false;
let audio: AudioContext | undefined;
function click(): void {
  if (!sounds) return;
  try {
    if (!audio) audio = new AudioContext();
    const n = Math.floor(audio.sampleRate * 0.012);
    const buf = audio.createBuffer(1, n, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.25));
    const src = audio.createBufferSource(), gain = audio.createGain();
    gain.gain.value = 0.25;
    src.buffer = buf; src.connect(gain); gain.connect(audio.destination); src.start();
  } catch { /* no audio here: the key still works */ }
}

function render(): void {
  $('kbKeys').innerHTML = LAYOUTS[layout].map(row => `<div class="kb-row">${row.map(k =>
    `<button data-k="${esc(k)}" class="${k === 'space' ? 'space' : WIDE.has(k) ? 'wide' : ''}"${ARIA[k] ? ` aria-label="${ARIA[k]}"` : ''}>${ICON[k] ?? esc(k)}</button>`).join('')}</div>`).join('');
  paint();
}

function paint(): void {
  $('kbText').textContent = opts?.mask ? '•'.repeat(Math.max(0, val.length - 1)) + val.slice(-1) : val;
  $('kbPh').textContent = val ? '' : opts?.placeholder || '';
  const field = $('kbText').parentElement!;
  field.scrollLeft = field.scrollWidth;   // a long entry scrolls, so the end and the caret stay in view
  const up = shiftOn();
  $('kbKeys').querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    const k = b.dataset.k!;
    if (/^[a-z]$/.test(k)) b.textContent = up ? k.toUpperCase() : k;
    if (k === '⇧') b.classList.toggle('on', shift);
  });
}

function press(k: string): void {
  if (!opts) return;
  if (k === '⇧') { shift = !shift; paint(); return; }
  if (k === '123' || k === 'ABC') { layout = k === '123' ? 'sym' : 'alpha'; render(); return; }
  if (k === '⌫') val = val.slice(0, -1);
  else if (k === 'space') { if (val && !val.endsWith(' ')) val += ' '; }
  else { val += shiftOn() && /^[a-z]$/.test(k) ? k.toUpperCase() : k; shift = false; }
  val = val.slice(0, opts.max ?? 60);
  paint();
  opts.onChange?.(val);
}

function stopRepeat(): void {
  clearTimeout(repeatTimer); clearInterval(repeatTimer); repeatTimer = undefined;
  $('kbKeys').querySelectorAll('.down').forEach(b => b.classList.remove('down'));
}

export const Keyboard = {
  open(o: KeyboardOptions): void {
    opts = { placeholder: '', done: 'Done', autoCap: false, max: 60, ...o };
    val = o.value || ''; layout = 'alpha'; shift = false;
    $('kbDone').textContent = opts.done || 'Done';
    sounds = device.keyboard.prefs()?.keySounds ?? false;
    render();
    $('kb').classList.add('on');
  },
  close(reason: CloseReason = 'close'): void {
    if (!opts) return;
    const o = opts; opts = null;
    stopRepeat();
    $('kb').classList.remove('on');
    o.onClose?.(reason, val);
  },
  get isOpen(): boolean { return !!opts; },
  get value(): string { return val; },
};

export function initKeyboard(): void {
  const keys = $('kbKeys');
  keys.addEventListener('pointerdown', e => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    e.preventDefault();
    b.classList.add('down');
    click();
    press(b.dataset.k!);
    if (b.dataset.k === '⌫') {   // hold to keep deleting
      repeatTimer = window.setTimeout(() => { repeatTimer = window.setInterval(() => press('⌫'), 70); }, 450);
    }
  });
  (['pointerup', 'pointerleave', 'pointercancel'] as const).forEach(ev => keys.addEventListener(ev, stopRepeat));
  $('kbCancel').addEventListener('click', () => Keyboard.close('cancel'));
  $('kbDone').addEventListener('click', () => {
    if (!opts) return;
    if (opts.onDone?.(val) !== false) Keyboard.close('done');
  });
}
