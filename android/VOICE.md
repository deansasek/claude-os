# Voice on the desk tablet

Say **"Hey Claude, …"** and ClaudeOS listens, sends what you said to Claude Code on the PC,
and reads the answer aloud. After it speaks it listens for a few more seconds, so you can answer
back without the wake word; silence ends the conversation.

## How it works

```
tablet mic ─▶ VoiceService (Vosk, offline) ──text──▶ page (apps/claude/web/voice.ts) ──▶ PC server (/api/claude/new | reply | approve)
                                                         │
tablet speaker ◀── VoiceSpeaker (Android TextToSpeech) ◀─┘  answer, shortened for speaking
```

- **Wake word, on the tablet.** `VoiceService` is a foreground service (type microphone) that reads
  the mic at 16 kHz into [Vosk](https://alphacephei.com/vosk/), an offline Kaldi recogniser, with a
  small English model packed into the APK. Until the wake word fires the only recogniser running is a
  *grammar* recogniser that knows the wake phrases, a few decoys ("hey Clyde", "close", "cold") and
  "[unk]": it cannot write down anything else you say. Audio is never stored or sent: the last
  8 seconds sit in memory so the words right after "Hey Claude" (said in one breath) aren't lost.
  - Accepted: "hey / hi / okay" + "claude", and the way the small model often hears a voice across a
    desk ("hey cloud", "hey clod", "hey clawed"), plus "Claude, …" at the start of an utterance.
  - **One breath works:** it fires on the recogniser's *partial* result, while you're still talking
    (an exact "hey claude" at once; the looser variants once they show up twice in a row). The whole
    utterance so far is handed to the full recogniser with no gap and the wake words are stripped
    from the transcript, so "Hey Claude, what time is it" arrives as "what time is it".
  - "Hey Claude" and a pause: it keeps listening for the request.
  - A soft two-note earcon plays at the media volume the instant it fires, without pausing capture.
  - (The grammar recogniser gives no partial text with `setPartialWords`, so that's off.)
- **Writing down the request** (`VoiceStt.java`): Android's own speech recogniser, which is far
  better than the small Vosk model. Vosk only does the wake word.
  - `createOnDeviceSpeechRecognizer` when the tablet has it with the English pack (this one does):
    audio stays on the tablet. Settings → Voice offers the pack's download when it's missing.
  - The standard (Google, online) recogniser only if you switch on **"Use Google speech
    recognition"** (off by default; what you say after "Hey Claude" then goes to Google).
  - Otherwise Vosk writes it down too, and Vosk also takes over mid-request if Android's recogniser
    fails.
  - It's fed *our* audio through a pipe (`EXTRA_AUDIO_SOURCE`, Android 13+), starting just after
    "Claude" (from the wake recogniser's word times), so words said in the same breath aren't lost
    and it never hears "Hey Claude" to turn into "a quad". Audio waits until it reports ready, and its
    segments are stitched together. Don't pass it extra intent options (silence lengths,
    prefer-offline): the on-device one fails with ERROR_CLIENT.
  - In a noisy room: what it hears is gated against the loudness of your own "Hey Claude" (quieter
    50 ms frames, like a TV, are turned right down); the request ends 0.8 s after you stop; and a
    request with nothing as loud as you is never sent.
  - Never sent: leftovers of the name ("a quad", "clod"…) or a stray word. It says "Didn't catch
    that" and keeps listening, once.
  - The Vosk path: two long-lived recognisers, warmed at start-up on `android/assets/voice-warmup.raw`
    (~20 s once; a fresh one needs ~3 s for its first second of audio), reset between uses.
- **Noise**: a noise floor is tracked continuously, and audio near it is turned down before the wake
  recogniser (factor 1.2; offline A/B: woke 10/10 vs 7/10 at 1.6 and 6/8 off). "hey" + a
  Claude-like word fires on first sight; "hi/okay claude" needs two partials in a row.
- **Settings → Voice → Last heard** shows what the wake word recogniser made of the room lately (text
  only) and a live mic level, for when "Hey Claude" doesn't seem to work (`voice.diag()`).
- **What the request means** (page, `voice.ts`):
  - a session is open on screen and can take a reply → it's a reply to that session;
  - otherwise → a new session, in Scratch space or in a folder you name first
    ("Hey Claude, **in eBay Cards**, list my drafts");
  - "never mind" / "cancel" → nothing.
  The usual rules apply: the PIN (if set), sessions open on the PC are never answered, no permission bypass.
- **Quick commands, without Claude** (`src/core/web/voice-commands.ts`): after "Hey Claude", timers
  ("set a timer for a minute and a half", "5 minute timer", "how long is left", "cancel the timer"),
  alarms ("wake me up at 7", "set an alarm for 6:30 on weekdays", "when is my alarm", "turn off my
  alarms"), weather ("what's the weather", "will it rain tomorrow"), time and date, screen ("dim the
  screen", "brighter", "brightness 50 percent", "dark mode"), sound ("volume up", "louder", "mute",
  "volume 30 percent") and "open weather / clock / settings / sessions" are done on the spot and
  answered aloud. Matching is whole-phrase and strict; anything it isn't sure about goes to Claude.
  The Clock app registers its timer and alarms with `provideClock(clockApi)`. A tap on the session
  composer's mic always means "message for Claude", so quick commands are skipped there.
- **Approvals by voice.** If Claude asks for permission during a voice turn, ClaudeOS asks out
  loud ("Claude wants to write hello. Should I allow it?") and listens for "yes / allow" or "no / deny".
  Allowing takes a clear, whole answer ("yes", "allow it", "go ahead"…); a stray "okay" never allows.
- **Speaking.** `VoiceSpeaker` uses Android's TextToSpeech on the **media** stream, so the media
  volume applies (at 0 you only see the answer). By default only on-device voices are used. Google's
  "natural" network voices are used only if you pick one in Settings → Voice, or switch on "Prefer
  natural voices when online" (off by default): they send the spoken text to Google to be voiced.
  With no internet, or if Google fails mid-sentence, it says it again with an on-device voice.
  Settings lists every voice ("Natural · US English · Voice 3", "On-device · …"), grouped, with a
  sample on tap. Long answers are cut down to a few sentences with code, tables, links and paths
  left out ("There's more on the screen"). Sessions started by voice also ask Claude, via an addition
  to Claude Code's system prompt, to end each turn with a short spoken-style answer.
- **Stop, or talk over it (barge-in).** Tap the critter or the voice pill, say "stop", or simply start
  talking: it stops and listens, keeping the start of what you said. While it speaks a full recogniser
  keeps listening; a result counts as *you* only when its latest words mostly aren't words it is saying
  and the mic is clearly louder than its own echo has been. "Hey Claude, stop" while Claude is still
  working stops that turn.
- **The indicator** (`src/core/web/voice-ui.ts`, on every screen): a quiet spark in the bottom-right
  corner while the wake word is on (tap it to talk); a pill that rises at the bottom for *listening*
  (live mic level + your words; in the follow-up window a thin line runs down the time left),
  *heard*, *thinking/working* (Claude's latest step; tap to open the session), *speaking* (the words
  being said; tap to stop), *ask* (approval with Allow / Deny buttons), and notices such as
  "Didn't catch that". A voice request no longer switches you to the Claude app. Any element with
  `id="svMic"` or `data-voice-mic` is a tap-to-talk button and gets the `voice-live` class while it listens.
- **On any screen.** The service keeps listening while another app is in front, and brings
  ClaudeOS back when the wake word fires. Android shows its microphone indicator while the wake
  word is on. A microphone service may only *start* while ClaudeOS is in front, so after a
  reboot it starts listening once ClaudeOS opens (it's the home screen, so that's at boot).

## Settings (page API, `core/web/device.ts` → `voice`)

| What | Call |
|---|---|
| Wake word on/off (asks for the mic permission the first time) | `voice.state().wake`, `voice.setWake(on)` |
| Voice (installed, offline voices for the tablet's language) | `voice.voices()` → `{voice, voices:[{id,label,current}]}`, `voice.setVoice(id)` (`''` = automatic) |
| Speaking rate (0.5–2, 1 = normal) | `voice.voices().rate`, `voice.setVoice(null, rate)` |
| Try it | `voice.speak('Hello from ClaudeOS')` |

## Building

`node android/setup-voice.ts` fetches Vosk for Android and JNA (Maven Central) and the model (alphacephei.com)
into `tools/voice` once; `android/build.ts` then adds the jars, the arm64 `.so` files and the model
(as assets) to the APK (~44 MB). For better accuracy at ~4x the size and memory:
`node android/setup-voice.ts --model vosk-model-en-us-0.22-lgraph`, then rebuild.

## Testing without talking (adb only; the sender needs the shell's DUMP permission)

Test **silently**: never play test audio out loud or trigger the assistant live without the user's
OK. A *dry run* feeds a WAV through the real wake → handover → transcription code in place of the
mic for a few seconds, with no events to the page, no earcon and no Claude session:

```powershell
adb push test.wav /sdcard/Android/data/hub.kiosk/files/          # 16 kHz mono 16-bit WAV (make it with SetOutputToWaveFile; don't play it)
adb shell am broadcast -a hub.kiosk.VOICE_TEST --es dry /sdcard/Android/data/hub.kiosk/files/test.wav
adb shell am broadcast -a hub.kiosk.VOICE_TEST --ez drylog true   # what it would have told the page (wake, partials, final)
```

Pad pauses with soft noise rather than digital silence (exact zeros confuse the end-of-speech
detector). `--es wav` (live: acts like real speech) and `--ez events true` still exist; use them
only with the user's OK.
