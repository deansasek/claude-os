// Where a hardware volume change shows (src/core/web/system.ts): the drawer's slider while the drawer is open, else the
// volume HUD, unless a quiet window has the HUD down. Pure: no DOM, no imports, so the test can run it under node.

/** The place a volume change shows: 'slider' while the drawer is open, 'hud' when the HUD may show, 'none' inside a quiet window. */
export function volumeTarget(ccOpen: boolean, now: number, quietUntil: number): 'slider' | 'hud' | 'none' {
  if (ccOpen) return 'slider';
  return now >= quietUntil ? 'hud' : 'none';
}
