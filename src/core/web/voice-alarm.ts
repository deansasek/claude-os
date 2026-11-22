// Voice words for the Clock's alarms: "stop" and "snooze" act on the ring that is sounding. Only "turn off all my
// alarms" switches every alarm off. Pure text matching, so Node tests can load it (core/web/voice-commands.ts uses it).

export type AlarmWord = 'stop-ring' | 'snooze' | 'all-off' | 'one-alarm' | null;

/** t: the lower-case command text. ringing: true while an alarm or timer is sounding. */
export function alarmWord(t: string, ringing: boolean): AlarmWord {
  if (ringing) {
    if (/^(?:stop|silence|dismiss|turn off|cancel)(?: it| that| the alarm| the timer| my alarm| my timer)?$/.test(t)) return 'stop-ring';
    if (/^snooze(?: it| that| the alarm)?$/.test(t)) return 'snooze';
  }
  if (/^(?:turn off|cancel|disable|switch off|clear|delete)(?: all)?(?: of)?(?: my| the)? alarms$/.test(t)) return 'all-off';
  if (/^stop all(?: of)?(?: my| the)? alarms$/.test(t)) return 'all-off';
  if (/^(?:stop|turn off|cancel|disable|switch off|delete)(?: the| my)? alarm$/.test(t)) return 'one-alarm';
  return null;
}
