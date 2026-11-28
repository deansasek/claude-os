// "What wifi am I on" by voice: the network the tablet is on (device.wifi()). Pure: no DOM, so Node tests it
// (test/voice-wifi.test.ts). The command (voice-commands.ts) reads the device and speaks this.

/** "what wifi am I on", "what's the wifi network", "is the wifi on": true when the family asks about the Wi-Fi. */
export function wifiWord(t: string): boolean {
  return /^(?:what wi-?fi (?:am i on|is this|network am i on)|what(?:'s| is) the wi-?fi(?: network| name)?(?: now| right now)?|am i (?:on|connected to) (?:the )?wi-?fi|is (?:the )?wi-?fi (?:on|connected|working)|which wi-?fi (?:am i on|is this))$/.test(t);
}

/** "You’re on Home Network.", "Wi-Fi is on, but not connected.", or "Wi-Fi is off." */
export function wifiSay(w: { enabled: boolean; ssid?: string }): string {
  if (!w.enabled) return 'Wi-Fi is off.';
  const name = (w.ssid ?? '').trim();
  return name ? `You’re on ${name}.` : 'Wi-Fi is on, but not connected.';
}
