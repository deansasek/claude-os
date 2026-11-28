// The Dice app: choose one to six dice and roll them, or flip a coin. The rolls are in roll.ts; this file paints them.
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { flipCoin, rollDice, total } from './roll.ts';

let count = 2;
let faces: number[] = [];

function paint(c: AppContext): void {
  c.$('dcCount').querySelectorAll<HTMLElement>('[data-count]')
    .forEach(b => b.classList.toggle('on', Number(b.dataset.count) === count));
  const dice = c.$('dcDice');
  dice.innerHTML = faces.map(f => `<div class="die" aria-label="${f}">${f}</div>`).join('');
  c.$('dcSum').textContent = faces.length > 1 ? `Total ${total(faces)}` : '';
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('dice'),
  mount(c: AppContext) {
    c.$('dcCount').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-count]');
      if (!b) return;
      count = Number(b.dataset.count);
      faces = [];
      c.$('dcCoinOut').textContent = '';
      paint(c);
    });
    c.$('dcRoll').addEventListener('click', () => {
      faces = rollDice(count);
      c.$('dcCoinOut').textContent = '';
      paint(c);
      c.$('dcDice').querySelectorAll<HTMLElement>('.die').forEach(d => d.classList.add('rolling'));
    });
    c.$('dcCoin').addEventListener('click', () => {
      c.$('dcCoinOut').textContent = flipCoin();
    });
    paint(c);
  },
  // closed in the app switcher: start a fresh roll the next time it opens
  onClose() { faces = []; },
};
export default app;
