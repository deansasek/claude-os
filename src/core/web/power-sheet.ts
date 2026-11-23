// The power menu: holding the tablet's power button opens it (MainActivity calls window.hubPower()).
// Restart (after a confirm), Turn off screen, Cancel. Android's own power menu never shows; Power off is not offered,
// because a normal app can't turn the tablet off. The page imports nothing at run time here, so the test can load it.

export type PowerButton = 'restart' | 'screen-off' | 'cancel';
export type PowerStage = 'menu' | 'confirm';
/** What a button does: the next stage (null closes the sheet) and the tablet call to make, if any. */
export interface PowerStep { next: PowerStage | null; call: 'reboot' | 'screenOff' | null }

export function powerStep(stage: PowerStage, button: PowerButton): PowerStep {
  if (button === 'cancel') return { next: null, call: null };
  if (button === 'screen-off') return { next: null, call: 'screenOff' };
  return stage === 'menu' ? { next: 'confirm', call: null } : { next: null, call: 'reboot' };
}

export interface PowerDeps {
  reboot(): unknown;
  screenOff(): unknown;
  onBack(fn: () => boolean, prio?: number): () => void;
}

const TEXT: Record<PowerStage, { title: string; text: string; restart: string }> = {
  menu: { title: 'Power', text: 'Restart the tablet or turn the screen off.', restart: 'Restart' },
  confirm: { title: 'Restart the tablet?', text: 'It takes about a minute and comes straight back to ClaudeOS.', restart: 'Restart now' },
};

export function initPowerSheet(d: PowerDeps): void {
  let root: HTMLElement | null = null;
  let stage: PowerStage = 'menu';
  let unBack: (() => void) | null = null;

  const close = () => {
    if (root) root.hidden = true;
    unBack?.(); unBack = null;
  };
  const paint = () => {
    const t = TEXT[stage];
    root!.querySelector('h3')!.textContent = t.title;
    root!.querySelector('p')!.textContent = t.text;
    root!.querySelector<HTMLElement>('[data-b="restart"]')!.textContent = t.restart;
    root!.querySelector<HTMLElement>('[data-b="screen-off"]')!.hidden = stage === 'confirm';
  };
  const press = (b: PowerButton) => {
    const s = powerStep(stage, b);
    if (s.next) { stage = s.next; paint(); } else close();
    try {
      if (s.call === 'reboot') d.reboot();
      else if (s.call === 'screenOff') d.screenOff();
    } catch { /* older app build or not device owner: the sheet is closed, nothing else happens */ }
  };
  const open = () => {
    if (!root) {
      root = document.createElement('div');
      root.className = 'pw';
      root.innerHTML = '<div class="pw-card" role="dialog" aria-modal="true"><h3></h3><p></p><div class="pw-actions">'
        + '<button class="pw-btn hit" data-b="restart"></button>'
        + '<button class="pw-btn hit" data-b="screen-off">Turn off screen</button>'
        + '<button class="pw-btn hit ghost" data-b="cancel">Cancel</button></div></div>';
      root.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
        if (b) press(b.dataset.b as PowerButton);
        else if (e.target === root) close();   // a tap outside the card is Cancel
      });
      document.getElementById('stage')!.appendChild(root);
    }
    stage = 'menu';
    paint();
    root.hidden = false;
    if (!unBack) unBack = d.onBack(() => { close(); return true; }, 110);   // above the welcome: Back is Cancel
  };
  (window as unknown as { hubPower: () => void }).hubPower = open;
}
