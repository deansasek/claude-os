// The Calculator app: a four-function calculator (+ − × ÷, %, decimals) with a clear and a backspace key, and a kitchen
// converter. The keys and the arithmetic are in calc.ts; the units are in convert.ts. This file paints and passes presses on.
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { display, START, step, type CalcState } from './calc.ts';
import { UNITS, convert, roundResult, type Unit } from './convert.ts';

let shown: HTMLElement | null = null;
let out: HTMLElement | null = null;
let pick: HTMLElement | null = null;
let state: CalcState = START;
let from: Unit | null = null, to: Unit | null = null;

const label = (u: Unit): string => UNITS.find(x => x.id === u)?.label ?? u;

/** The readout's number, when it is one (a finished result or a plain number). */
const readoutValue = (): number | null => {
  // the keys type a minus as "−" (U+2212), and a number may end in a point ("5."): both are read as a number
  const text = display(state).replace(/−/g, '-').replace(/\.$/, '');
  return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/.test(text) ? Number(text) : null;
};

function paintConvert(): void {
  if (!pick || !out) return;
  pick.innerHTML = ['from', 'to'].map(which => `<div class="calc-conv-row">${UNITS.map(u => {
    const on = (which === 'from' ? from : to) === u.id;
    return `<button class="calc-chip${on ? ' on' : ''}" data-${which}="${u.id}">${u.label}</button>`;
  }).join('')}</div>`).join('');
  if (!from || !to) { out.textContent = 'Pick a unit to convert from and to.'; return; }
  const v = readoutValue();
  if (v === null) { out.textContent = 'Work out a number on the keys first.'; return; }
  const r = convert(v, from, to);
  out.textContent = r === null ? `${label(from)} can’t be turned into ${label(to)}.` : `${roundResult(v)} ${label(from)} = ${roundResult(r)} ${label(to)}`;
}

function paint(): void {
  if (shown) {
    shown.textContent = display(state);
    shown.scrollLeft = shown.scrollWidth;   // a sum wider than the readout keeps its newest digits in view
  }
  paintConvert();
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('calculator'),
  mount(c: AppContext) {
    shown = c.$('calcShown');
    out = c.$('calcOut');
    pick = c.$('calcConv');
    c.$('calcPad').addEventListener('click', e => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (!key) return;
      state = step(state, key);
      paint();
    });
    pick.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-from],[data-to]');
      if (!b) return;
      if (b.dataset.from) from = b.dataset.from as Unit;
      if (b.dataset.to) to = b.dataset.to as Unit;
      paint();
    });
    paint();
  },
  // closed in the app switcher: start a fresh calculation the next time it opens
  onClose() { state = START; paint(); },
};
export default app;
