// The Calculator app: a four-function calculator (+ − × ÷, %, decimals) with a clear and a backspace key.
// The keys and the arithmetic are in calc.ts; this file only paints the readout and passes presses on.
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { display, START, step, type CalcState } from './calc.ts';

let shown: HTMLElement | null = null;
let state: CalcState = START;

function paint(): void {
  if (shown) shown.textContent = display(state);
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('calculator'),
  mount(c: AppContext) {
    shown = c.$('calcShown');
    c.$('calcPad').addEventListener('click', e => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (!key) return;
      state = step(state, key);
      paint();
    });
    paint();
  },
  // closed in the app switcher: start a fresh calculation the next time it opens
  onClose() { state = START; paint(); },
};
export default app;
