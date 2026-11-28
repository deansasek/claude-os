// "What's the battery" by voice: the charge the tablet reports (device.battery()). Pure: no DOM, so Node tests it
// (test/voice-battery.test.ts). The command (voice-commands.ts) reads the device and speaks this.

/** "what's the battery", "how much battery is left", "is the tablet charging": true when the family asks about the charge. */
export function batteryWord(t: string): boolean {
  return /^(?:what(?:'s| is) the battery(?: level)?(?: now| right now)?|how much battery(?: is)? left|how much battery is there|is the tablet charging|is it charging|battery level|how(?:'s| is) the battery(?: doing)?)$/.test(t);
}

/** "The battery is at 64 percent and charging.", "...and full.", or "The battery is at 64 percent." when on its own. */
export function batterySay(b: { percent: number; charging: boolean; full: boolean }): string {
  if (!Number.isFinite(b.percent)) return 'I can’t read the battery right now.';
  const state = b.full ? ' and full' : b.charging ? ' and charging' : '';
  return `The battery is at ${Math.round(b.percent)} percent${state}.`;
}
