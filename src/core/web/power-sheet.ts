// The power menu: holding the tablet's power button opens it (MainActivity calls window.hubPower()).
// Restart (after a confirm), Turn off screen, Screenshot, Cancel. Android's own power menu never shows; Power off is not
// offered, because a normal app can't turn the tablet off. The page imports nothing at run time here, so the test can load it.

export type PowerButton = 'restart' | 'screen-off' | 'screenshot' | 'cancel';
export type PowerStage = 'menu' | 'confirm';
/** What a button does: the next stage (null closes the sheet) and the tablet call to make, if any. */
export interface PowerStep { next: PowerStage | null; call: 'reboot' | 'screenOff' | 'screenshot' | null }

export function powerStep(stage: PowerStage, button: PowerButton): PowerStep {
  if (button === 'cancel') return { next: null, call: null };
  if (button === 'screen-off') return { next: null, call: 'screenOff' };
  if (button === 'screenshot') return { next: null, call: 'screenshot' };
  return stage === 'menu' ? { next: 'confirm', call: null } : { next: null, call: 'reboot' };
}

export interface PowerDeps {
  reboot(): unknown;
  screenOff(): unknown;
  /** Takes the screenshot once the sheet has closed (the sheet is not in the picture); the wiring shows the result. */
  screenshot(): unknown;
  onBack(fn: () => boolean, prio?: number): () => void;
}

const TEXT: Record<PowerStage, { title: string; text: string; restart: string }> = {
  menu: { title: 'Power', text: '', restart: 'Restart' },
  confirm: { title: 'Restart the tablet?', text: 'It takes about a minute and comes straight back to ClaudeOS.', restart: 'Restart now' },
};

// line icons drawn like the control center's (22px, currentColor); inline so this module stays import-free
const ICON = {
  restart: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/></svg>',
  screenOff: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
  screenshot: '<svg viewBox="0 0 24 24"><path d="M4 8.5V7a2 2 0 0 1 2-2h1.5"/><path d="M16.5 5H18a2 2 0 0 1 2 2v1.5"/><path d="M20 15.5V17a2 2 0 0 1-2 2h-1.5"/><path d="M7.5 19H6a2 2 0 0 1-2-2v-1.5"/><circle cx="12" cy="12" r="3"/></svg>',
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
    const p = root!.querySelector('p')!;
    p.textContent = t.text;
    p.hidden = !t.text;
    root!.querySelector<HTMLElement>('[data-b="restart"] b')!.textContent = t.restart;
    root!.querySelector<HTMLElement>('[data-b="screen-off"]')!.hidden = stage === 'confirm';
    root!.querySelector<HTMLElement>('[data-b="screenshot"]')!.hidden = stage === 'confirm';
    root!.dataset.stage = stage;
  };
  const press = (b: PowerButton) => {
    const s = powerStep(stage, b);
    if (s.next) { stage = s.next; paint(); } else close();
    try {
      if (s.call === 'reboot') d.reboot();
      else if (s.call === 'screenOff') d.screenOff();
      else if (s.call === 'screenshot') d.screenshot();
    } catch { /* older app build or not device owner: the sheet is closed, nothing else happens */ }
  };
  const open = () => {
    if (!root) {
      root = document.createElement('div');
      root.className = 'pw';
      // a bottom sheet like the control center turned upside down: the grab handle, a serif title and one helper
      // line, the actions in one rounded group, and Cancel on its own below
      root.innerHTML = '<div class="pw-card" role="dialog" aria-modal="true"><div class="cc-grab"></div><h3></h3><p></p>'
        + '<div class="pw-group">'
        + `<button class="pw-btn hit" data-b="restart"><i class="cc-ic">${ICON.restart}</i><b></b></button>`
        + `<button class="pw-btn hit" data-b="screen-off"><i class="cc-ic">${ICON.screenOff}</i><b>Turn off screen</b></button>`
        + `<button class="pw-btn hit" data-b="screenshot"><i class="cc-ic">${ICON.screenshot}</i><b>Screenshot</b></button>`
        + '</div><button class="pw-btn pw-cancel hit" data-b="cancel"><b>Cancel</b></button></div>';
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
