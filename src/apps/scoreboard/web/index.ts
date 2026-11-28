// The Scoreboard app: pick the number of players, add or take points with + and −, undo the last change, or start
// a new game. The game is saved on the device, so it survives switching apps. The scores are in score.ts.
import { store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { change, leaders, newGame, parse, undo, type Game } from './score.ts';

const KEY = 'scoreboard.game';
let game: Game = parse(store.get(KEY)) ?? newGame(2);

function save(): void {
  store.set(KEY, JSON.stringify(game));
}

function paint(c: AppContext): void {
  const n = game.players.length;
  c.$('sbCount').querySelectorAll<HTMLElement>('[data-count]')
    .forEach(b => b.classList.toggle('on', Number(b.dataset.count) === n));
  const lead = new Set(leaders(game));
  c.$('sbPlayers').innerHTML = game.players.map((v, i) => `
    <div class="sb-card${lead.has(i) ? ' lead' : ''}">
      <span class="sb-name">Player ${i + 1}</span>
      <div class="sb-score">${v}</div>
      <div class="sb-steps">
        <button data-player="${i}" data-delta="-1" aria-label="Take one from player ${i + 1}">−</button>
        <button data-player="${i}" data-delta="1" aria-label="Add one to player ${i + 1}">+</button>
      </div>
    </div>`).join('');
  c.$<HTMLButtonElement>('sbUndo').disabled = game.history.length === 0;
}

function update(c: AppContext, next: Game): void {
  game = next;
  save();
  paint(c);
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('scoreboard'),
  mount(c: AppContext) {
    c.$('sbCount').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-count]');
      if (b) update(c, newGame(Number(b.dataset.count)));
    });
    c.$('sbPlayers').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-delta]');
      if (b) update(c, change(game, Number(b.dataset.player), Number(b.dataset.delta)));
    });
    c.$('sbUndo').addEventListener('click', () => update(c, undo(game)));
    c.$('sbNew').addEventListener('click', () => update(c, newGame(game.players.length)));
    paint(c);
  },
};
export default app;
