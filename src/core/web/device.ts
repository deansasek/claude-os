// The desk tablet's own controls, when the Hub runs inside the tablet app (android/).
// The app puts window.HubDevice on the page; on the Nest Hub or a normal browser it isn't there,
// so `onTablet` is false and everything that needs the tablet stays hidden.
// Every call is synchronous and returns JSON; `{ error }` becomes a thrown Error.

import { recordClip } from './clipboard-history.ts';

interface HubDeviceApi {
  info(): string; battery(): string;
  wifi(): string; wifiScan(): string; wifiNetworks(): string;
  wifiConnect(ssid: string, password: string): string; wifiForget(ssid: string): string; wifiEnable(on: boolean): string;
  googleAccounts(): string; addGoogleAccount(): string; googleCheck(which: string): string;
  brightness(): string; setBrightness(v: number): string; keepAwake(on: boolean): string;
  volume(): string; setVolume(which: 'media' | 'alarm' | 'notification', v: number): string;
  apps(): string; setAppHidden(pkg: string, hidden: boolean): string;
  reboot(): string; maintenance(): string;
  screenOff?(): string;   // newer app builds: the power menu's Turn off screen
  screenshot?(id: string): string;   // newer app builds: the power menu's Screenshot (uploads to the PC's Photos)
  updateAvailable?(): string; updateCheck?(): string;   // newer app builds: Settings → About → Software
  // newer app builds: chats on the tablet's own Claude CLI (apps/claude/web/native.ts) and its sign-in (cli-signin.ts)
  cliSigninStart?(): string; cliAuthState?(check: boolean): string;
  cliSigninCode?(code: string): string; cliSigninClipboard?(): string; cliSigninState?(): string;
  claudeSend?(text: string, sessionId: string, model: string): string; claudeStop?(): string;
  claudeUsageCheck?(): string;   // newer app builds: the plan limits from the tablet's CLI (Settings → Usage)
  pageFileWrite?(name: string, text: string): string; pageFileRead?(name: string): string;
  setTopColor?(hex: string): string; setTopBand?(runs: string): string;   // the strip at the top edge (system.ts sendTop)
  topInset?(): string; topGestureInset?(): string; bottomGestureInset?(): string;
  setup(): string; fix(id: string): string; setKiosk(on: boolean): string;
  keyboardStatus?(): string; keyboardSetDefault?(): string; keyboardClearLearned?(): string;   // newer app builds
  keyboardPrefs?(): string; keyboardSetPref?(name: string, on: boolean): string;   // newer app builds: suggestions, key sounds
  browserDownloadsSize?(): string;   // newer app builds: what the Browser saved (Storage)
  newsFetch?(url: string): string;   // newer app builds: one News feed, read natively (NewsFetch.java; the hosts are fixed there)
  // newer app builds (the Settings device rows below are disabled with "Needs the latest ClaudeOS app" without them; see nativeHas)
  screen?(): string; setAutoBrightness?(on: boolean): string; setScreenOff?(sec: number): string;
  storage?(): string; timeZone?(): string; setTimeZone?(id: string): string; bluetooth?(): string;
  adbWifi?(): string; setAdbWifi?(on: boolean): string; setAdbWifiKeep?(keep: boolean): string;   // wireless debugging (AdbWifi.java)
}

/** Screen: Android's auto-brightness, and seconds until the screen turns off by itself (0 = never). */
export interface ScreenState { auto: boolean; offSec: number }
export interface StorageInfo { total: number; free: number }
interface TimeZoneInfo {id: string; auto: boolean }
export interface BluetoothInfo { supported: boolean; on: boolean; devices: { name: string; mac: string }[] }

/** Claude Keyboard, the tablet's keyboard: switched on, the default, and whether this app may change that. */
interface KeyboardStatus {enabled: boolean; isDefault: boolean; canSet: boolean }
/** The keyboard's own switches: word suggestions (on by default) and a click with each key (off by default). */
interface KeyboardPrefs {suggestions: boolean; keySounds: boolean }
/** The files the Browser saved (its downloads and saved pictures) still on the tablet. */
interface SavedDownloads {bytes: number; count: number }

/** Wireless debugging (ADB over Wi-Fi). needsGrant: the PC must grant the app once (see AdbWifi.java). keep: switched back on after restarts. */
export interface AdbWifiState { on: boolean; canControl: boolean; needsGrant: boolean; ip: string; port: string; keep: boolean }

interface SetupItem {id: string; title: string; detail: string; done: boolean; optional: boolean }
export interface Setup { owner: boolean; kiosk: boolean; items: SetupItem[] }

interface DeviceInfo {app: string; model: string; maker: string; android: string; sdk: number; owner: boolean; pinned: boolean }
export interface Battery { percent: number; charging: boolean; full: boolean; plugged: '' | 'ac' | 'usb' | 'wireless' | 'dock'; tempC: number; voltage: number; health: string }
export interface WifiState { enabled: boolean; ssid?: string; bars?: number; ip?: string; mbps?: number }
export interface WifiNet { ssid: string; bars: number; secure: boolean; enterprise: boolean; wpa3: boolean; saved: boolean; current: boolean }
interface AppEntry {id: string; name: string; system: boolean; hidden: boolean; protected: boolean }

const api = (window as unknown as { HubDevice?: HubDeviceApi }).HubDevice;
/** A web client installed to the Home Screen (standalone). iOS and Android both report it. */
const installedApp = (): boolean => (typeof navigator !== 'undefined' && (navigator as { standalone?: boolean }).standalone === true)
  || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
/** A client opened with ?client=personal: a browser tab the owner uses for their own data (not a shared screen). */
const personalClient = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('client') === 'personal';
/** What this client can do. onTablet is the same as caps.bridge; use caps in new code. Each part is set in one place, so a later client can change one without the others. */
export const caps = {
  bridge: !!api,          // the native bridge (Android app): device controls, the top band, the kiosk
  localState: !!api || installedApp() || personalClient(),   // keeps its own copies of lists, routines and calendar notices, so it works with the Host off
  kind: (api ? 'android' : 'web') as 'android' | 'web',
} as const;
export const onTablet = caps.bridge;
if (onTablet) document.documentElement.classList.add('tablet');

function call<T>(fn: (a: HubDeviceApi) => string): T {
  if (!api) throw new Error('not on the tablet');
  const r = JSON.parse(fn(api)) as T & { error?: string };
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error);
  return r;
}

/** The top edge (system.ts sendTop): the strip Android draws at the top, and the gesture bands at the top and bottom. */
export const hasTopBand = (): boolean => typeof api?.setTopBand === 'function';
export function setTopBand(color: string, runs: string): void {
  api?.setTopColor?.(color);
  api?.setTopBand?.(runs);
}
const pxOf = (json: string | undefined): number | undefined => {
  if (!json) return undefined;
  try { const v = (JSON.parse(json) as { px?: unknown }).px; return typeof v === 'number' ? v : undefined; } catch { return undefined; }
};
/** The top strip, and the grab zones of Android's top and bottom gesture bands, in device pixels. Zero when the app lacks them. */
export function topInsets(): { top: number; grabTop: number; bottom: number } {
  const top = pxOf(api?.topInset?.()) ?? 0;
  return { top, grabTop: pxOf(api?.topGestureInset?.()) ?? top, bottom: pxOf(api?.bottomGestureInset?.()) ?? 0 };
}

/** Whether the tablet app has these native methods. Older app builds lack the newer ones, so a feature that needs them
 *  is shown disabled ("Needs the latest ClaudeOS app") rather than as a control that does nothing. The mock has them all. */
export function nativeHas(...methods: (keyof HubDeviceApi)[]): boolean {
  return !!api && methods.every(m => typeof api[m] === 'function');
}

/** One News feed read by the tablet (NewsFetch.java): the HTTP status and body. Throws when the native side refuses or fails. */
export function newsFetch(url: string): { status: number; body: string } {
  return call(a => a.newsFetch!(url));
}

/** Media volume changes (0..1): the tablet's volume keys (window.onHubVolume, from MainActivity) and this page's own setVolume. */
const volumeHandlers: ((level: number) => void)[] = [];
export function onVolume(fn: (level: number) => void): void { volumeHandlers.push(fn); }
const emitVolume = (level: number): void => volumeHandlers.forEach(f => { try { f(level); } catch { /* ignore */ } });
(window as unknown as { onHubVolume: (level: number) => void }).onHubVolume = emitVolume;

export const device = {
  info: () => call<DeviceInfo>(a => a.info()),
  battery: () => call<Battery>(a => a.battery()),
  wifi: () => call<WifiState>(a => a.wifi()),
  wifiScan: () => call<{ ok: boolean }>(a => a.wifiScan()),
  wifiNetworks: () => call<WifiNet[]>(a => a.wifiNetworks()),
  wifiConnect: (ssid: string, password = '') => call<{ ok: boolean; panel?: boolean }>(a => a.wifiConnect(ssid, password)),
  wifiForget: (ssid: string) => call<{ ok: boolean }>(a => a.wifiForget(ssid)),
  wifiEnable: (on: boolean) => call<{ ok: boolean }>(a => a.wifiEnable(on)),
  googleAccounts: () => call<{ accounts: { name: string }[] }>(a => a.googleAccounts()),
  addGoogleAccount: () => call<{ ok: boolean }>(a => a.addGoogleAccount()),
  googleCheck: (which: 'calendar' | 'gmail') => call<{ ok?: boolean; consent?: boolean }>(a => a.googleCheck(which)),
  brightness: () => call<{ value: number }>(a => a.brightness()).value,
  setBrightness: (v: number) => call<{ ok: boolean }>(a => a.setBrightness(v)),
  keepAwake: (on: boolean) => call<{ ok: boolean }>(a => a.keepAwake(on)),
  volume: () => call<{ media: number; alarm: number; notification: number }>(a => a.volume()),
  setVolume: (which: 'media' | 'alarm' | 'notification', v: number) => {
    const r = call<{ ok: boolean }>(a => a.setVolume(which, v));
    if (which === 'media') emitVolume(v);
    return r;
  },
  apps: () => call<AppEntry[]>(a => a.apps()),
  setAppHidden: (pkg: string, hidden: boolean) => call<{ ok: boolean }>(a => a.setAppHidden(pkg, hidden)),
  reboot: () => call<{ ok: boolean }>(a => a.reboot()),
  /** The screen off now (Android's lock, with no lock screen: the power button wakes it). Throws on older app builds. */
  screenOff: () => call<{ ok: boolean }>(a => a.screenOff!()),
  /** Screenshot of ClaudeOS's window, uploaded to the PC's Photos as `id`. Throws on older app builds or on failure. */
  screenshot: (id: string) => call<{ ok: boolean; id?: string }>(a => a.screenshot!(id)),
  /** Check only: this build and the newest one the PC offers (installs nothing). Throws on older app builds. */
  updateAvailable: () => call<{ status: string; installed?: number; latest?: number }>(a => a.updateAvailable!()),
  /** Start the update the PC offers (the person confirms first). Throws on older app builds. */
  updateCheck: () => call<{ status: string; from?: number; to?: number; versionCode?: number }>(a => a.updateCheck!()),
  maintenance: () => call<{ ok: boolean }>(a => a.maintenance()),
  /** Starts signing the tablet's Claude CLI in (core/web/cli-signin.ts follows the steps). Throws with the reason. */
  cliSigninStart: () => call<{ ok: boolean }>(a => a.cliSigninStart!()),
  /** The tablet CLI's sign-in: 1 signed in, 0 not, -1 not known (also on older builds); busy while a sign-in runs.
   *  check: also asks the CLI now (the answer comes as a "status" step). */
  cliAuthState: (check = false): { signedIn: number; busy: boolean } => {
    try { return call<{ signedIn: number; busy: boolean }>(a => a.cliAuthState!(check)); } catch { return { signedIn: -1, busy: false }; }
  },
  /** The code for the waiting `claude auth login` ('' = the clipboard's). Throws with the reason. */
  cliSigninCode: (code: string) => call<{ ok: boolean }>(a => a.cliSigninCode!(code)),
  /** The clipboard's text for the sign-in sheet's Paste (read natively). Throws with the reason. */
  cliSigninClipboard: () => call<{ text: string }>(a => a.cliSigninClipboard!()).text,
  /** Seconds left for a running CLI login that takes a code; -1 when none runs or on older builds. */
  cliSigninState: (): number => { try { return call<{ left: number }>(a => a.cliSigninState!()).left; } catch { return -1; } },
  /** One message to the tablet's own Claude CLI ('' = a new chat; model haiku, sonnet or opus). Throws on older builds or with the reason. */
  claudeSend: (text: string, sessionId: string, model: string) => call<{ ok: boolean }>(a => a.claudeSend!(text, sessionId, model)),
  /** Stops the tablet's running chat. */
  claudeStop: () => call<{ ok: boolean }>(a => a.claudeStop!()),
  /** Asks the tablet's CLI for the plan limits: its get_usage control request, with no prompt. The answer comes back as
   *  window.hubClaudeNative lines (apps/claude/web/native.ts). Throws on older builds or when a check already runs. */
  claudeUsageCheck: () => call<{ ok: boolean }>(a => a.claudeUsageCheck!()),
  /** A small file in the app's files folder, on disk when this returns, so it survives the app being closed
   *  (localStorage writes land a few seconds late). Throws on older builds or off the tablet. */
  pageFileWrite: (name: 'native-chat', text: string) => call<{ ok: boolean }>(a => a.pageFileWrite!(name, text)),
  /** The file's text, or null when it is not there. Throws on older builds or off the tablet. */
  pageFileRead: (name: 'native-chat'): string | null => call<{ text: string | null }>(a => a.pageFileRead!(name)).text,
  /** One-time Android settings that make the tablet a kiosk without device owner. Older app builds lack it. */
  setup: (): Setup | null => { try { return call<Setup>(a => a.setup()); } catch { return null; } },
  fix: (id: string) => call<{ ok: boolean }>(a => a.fix(id)),
  setKiosk: (on: boolean) => call<{ ok: boolean }>(a => a.setKiosk(on)),
  /** Display: Android's auto-brightness and screen-off time. Null on older app builds. */
  screen: (): ScreenState | null => { try { return call<ScreenState>(a => a.screen!()); } catch { return null; } },
  setAutoBrightness: (on: boolean) => call<{ ok: boolean }>(a => a.setAutoBrightness!(on)),
  setScreenOff: (sec: number) => call<{ ok: boolean }>(a => a.setScreenOff!(sec)),
  /** Storage of the tablet (data partition). Null on older app builds. */
  storage: (): StorageInfo | null => { try { return call<StorageInfo>(a => a.storage!()); } catch { return null; } },
  /** Time zone (Date & time). Null on older app builds. */
  timeZone: (): TimeZoneInfo | null => { try { return call<TimeZoneInfo>(a => a.timeZone!()); } catch { return null; } },
  setTimeZone: (id: string) => call<{ ok: boolean }>(a => a.setTimeZone!(id)),
  /** Bluetooth: read only (on/off and pairing are Android's own screens). Null on older app builds. */
  bluetooth: (): BluetoothInfo | null => { try { return call<BluetoothInfo>(a => a.bluetooth!()); } catch { return null; } },
  /** Claude Keyboard (ime/ClaudeKeyboard.java). Null on older app builds. */
  keyboard: {
    status: (): KeyboardStatus | null => { try { return call<KeyboardStatus>(a => a.keyboardStatus!()); } catch { return null; } },
    makeDefault: () => call<{ ok: boolean }>(a => a.keyboardSetDefault!()),
    clearLearned: () => call<{ ok: boolean }>(a => a.keyboardClearLearned!()),
    /** Null on older app builds. */
    prefs: (): KeyboardPrefs | null => { try { return call<KeyboardPrefs>(a => a.keyboardPrefs!()); } catch { return null; } },
    setPref: (name: 'suggestions' | 'keySounds', on: boolean) => call<{ ok: boolean }>(a => a.keyboardSetPref!(name, on)),
  },
  /** What the Browser saved (downloads and pictures): its size and count. Null on older app builds. */
  browserDownloads: (): SavedDownloads | null => { try { return call<SavedDownloads>(a => a.browserDownloadsSize!()); } catch { return null; } },
  /** Wireless debugging: Android's ADB over Wi-Fi, switched here. Null on older app builds. */
  adbWifi: (): AdbWifiState | null => { try { return call<AdbWifiState>(a => a.adbWifi!()); } catch { return null; } },
  /** ok false with needsGrant true: the PC has not granted the app its one-time permission yet. */
  setAdbWifi: (on: boolean) => call<{ ok: boolean; needsGrant?: boolean }>(a => a.setAdbWifi!(on)),
  setAdbWifiKeep: (keep: boolean) => call<{ ok: boolean }>(a => a.setAdbWifiKeep!(keep)),
};

/** The tablet app calls window.hubResume() whenever the Hub comes back to the front. */
const resumeHandlers: (() => void)[] = [];
export function onResume(fn: () => void): void { resumeHandlers.push(fn); }
const runResume = (): void => resumeHandlers.forEach(f => { try { f(); } catch { /* ignore */ } });
(window as unknown as { hubResume: () => void }).hubResume = runResume;
/** Without the tablet app, a page that comes back to the front (a tab shown again, a Home Screen app reopened) counts as a resume. */
if (!api) document.addEventListener('visibilitychange', () => { if (!document.hidden) runResume(); });

// ---------- voice: "Hey Claude", speech-to-text and speaking (android/VOICE.md) ----------
// The wake word and transcription run on the tablet (offline); only text reaches the page.
// Older app builds have no voice: `voice.available` is false and every call is a no-op.
interface VoiceApi {
  voice(): string; voiceSetWake(on: boolean): string; voiceListen(silenceMs: number): string; voiceCancel(): string;
  speak(text: string, id: string): string; stopSpeaking(): string; voices(): string; setVoice(voice: string | null, rate: number): string;
  setVoiceNatural?(on: boolean): string; previewVoice?(id: string, text: string): string;   // newer app builds
  setVoiceLanguage?(tag: string): string; setVoicePitch?(pitch: number): string;   // newer app builds: spoken language, voice style
  voiceDiag?(): string;
  voiceStt?(): string; voiceSetCloudStt?(on: boolean): string; voiceSttDownload?(): string;
}
/** Which recogniser writes down requests after "Hey Claude". using: device (Android, on this tablet), cloud (Google), vosk. */
interface VoiceSttInfo {
  onDevice: boolean; onDeviceEnglish: 'installed' | 'downloadable' | 'pending' | 'missing' | 'unknown';
  standard: boolean; cloud: boolean; using: 'device' | 'cloud' | 'vosk'; lastError?: string; lastCode?: VoiceReason;
}
/** Why voice failed or is off, as a short code. The page turns it into a plain line (voice-ui.ts plainError). */
export type VoiceReason = 'no_mic' | 'mic_busy' | 'no_pack' | 'no_voice' | 'tts_failed' | 'stt_failed' | 'network' | 'unknown';
/** What the wake word recogniser heard lately (text only) and the mic level over the last 5 s (0..1, every 100 ms). */
interface VoiceDiag {
  mode: string; rate: number; effects: string; level: number; peak: number; levels: number[];
  floor?: number;        // the room's noise floor, same scale as levels
  engine?: string;       // what wrote down the last request: device | cloud | vosk
  heard: { at: number; text: string; final: boolean; woke: boolean }[];
}
type VoiceMode ='off' | 'loading' | 'wake' | 'listen' | 'speaking';
interface VoiceState {permission: boolean; wake: boolean; mode: VoiceMode; speaking: boolean; error?: string; code?: VoiceReason }
/** network: a "natural" Google voice; the text is sent to Google to be voiced. */
interface VoiceOption {id: string; label: string; locale: string; language?: string; network?: boolean; quality: number; latency?: number; installed: boolean; current: boolean }
interface VoiceList {
  ready: boolean; voice: string; rate: number; voices: VoiceOption[];
  natural?: boolean;          // "Prefer natural voices when online" (off by default)
  online?: boolean;           // the tablet has a working internet connection right now
  using?: string; usingNatural?: boolean;   // the voice it would speak with now
  lang?: string;              // the language voices are chosen in (BCP-47): the chosen one, or the tablet's
  pitch?: number;             // voice style: 0.8 calmer … 1 normal … 1.2 brighter
}
/** What the tablet tells the page. */
export type VoiceEvent =
  | { type: 'state'; mode: 'off' | 'loading' | 'wake' | 'listening' }
  | { type: 'wake' }                                  // "Hey Claude" heard: listening for the request
  | { type: 'partial'; text: string }                 // words so far
  | { type: 'final'; text: string }                   // what you said
  | { type: 'timeout' } | { type: 'cancel' }          // nothing said / listening called off
  | { type: 'speaking'; id: string; natural?: boolean }   // natural: a Google network voice is speaking
  | { type: 'spoken'; id: string; stopped: boolean }  // finished (or stopped) speaking
  | { type: 'stop' }                                  // you said "stop" while it was speaking
  | { type: 'bargein' }                               // you started talking over it: it stopped and is listening
  | { type: 'level'; v: number }                      // mic loudness 0..1 while listening (~10 a second)
  | { type: 'retry'; heard: string }                  // what it heard wasn't a request ("a quad"): still listening
  | { type: 'error'; code?: VoiceReason; message: string };   // code: what went wrong; message: the tablet's words (for the log)

const vapi = api && typeof (api as unknown as Partial<VoiceApi>).voice === 'function' ? api as unknown as VoiceApi : null;
function vcall<T>(fn: (a: VoiceApi) => string, fallback: T): T {
  if (!vapi) return fallback;
  const r = JSON.parse(fn(vapi)) as T & { error?: string };
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error);
  return r;
}
const voiceHandlers: ((e: VoiceEvent) => void)[] = [];
let finalClaim: ((text: string) => void) | null = null;   // a full-screen mode holding the spoken requests (voice.claimFinals)

export const voice = {
  available: !!vapi,
  state: (): VoiceState | null => vcall<VoiceState | null>(a => a.voice(), null),
  /** Wake word on/off (Settings). Turning it on may first show Android's microphone prompt. */
  setWake: (on: boolean) => vcall(a => a.voiceSetWake(on), { ok: false } as { ok: boolean; asking?: boolean; reason?: VoiceReason }),
  /** Listen now without the wake word; gives up after `silenceMs` of nothing said. On ok: false, `reason` says why. */
  listen: (silenceMs = 6000) => vcall(a => a.voiceListen(silenceMs), { ok: false } as { ok: boolean; reason?: VoiceReason }),
  cancel: () => vcall(a => a.voiceCancel(), { ok: false } as { ok: boolean }),
  /** Say something aloud (media volume). A 'spoken' event with the same id follows. */
  speak: (text: string, id = '') => (vapi ? vcall(a => a.speak(text, id), { ok: false } as { ok: boolean }) : webSay(text, id)),
  stopSpeaking: () => {
    if (vapi) return vcall(a => a.stopSpeaking(), { ok: false } as { ok: boolean });
    if (typeof speechSynthesis === 'undefined') return { ok: false };
    speechSynthesis.cancel();
    return { ok: true };
  },
  /** Every voice the engine has, your language and English first (Settings: voice picker). */
  voices: () => vcall<VoiceList | null>(a => a.voices(), null),
  /** voice: an id from voices(), '' = automatic, null = unchanged; rate 0.5–2 (1 normal), 0 = unchanged. */
  setVoice: (id: string | null, rate = 0) => vcall(a => a.setVoice(id, rate), { ok: false } as { ok: boolean }),
  /** Spoken language: a BCP-47 tag, '' = the tablet's language. Drops a chosen voice of another language. */
  setLanguage: (tag: string) => vcall(a => (a.setVoiceLanguage ? a.setVoiceLanguage(tag) : '{"error":"update the tablet app"}'), { ok: false } as { ok: boolean }),
  /** Voice style: pitch 0.8 (calmer) to 1.2 (brighter), 1 normal. */
  setPitch: (pitch: number) => vcall(a => (a.setVoicePitch ? a.setVoicePitch(pitch) : '{"error":"update the tablet app"}'), { ok: false } as { ok: boolean }),
  /** Whether this tablet app has one of the newer voice methods (gate a Settings row with it). */
  has: (m: 'setVoiceLanguage' | 'setVoicePitch'): boolean => !!vapi && typeof vapi[m] === 'function',
  /** Automatic uses natural (Google, online) voices when on. A privacy choice: off by default. */
  setNatural: (on: boolean) => vcall(a => (a.setVoiceNatural ? a.setVoiceNatural(on) : '{"error":"update the tablet app"}'), { ok: false } as { ok: boolean }),
  /** Diagnostics for Settings ("Last heard" and a live level meter); null on older app builds. */
  diag: (): VoiceDiag | null => vcall<VoiceDiag | null>(a => (a.voiceDiag ? a.voiceDiag() : 'null'), null),
  /** Which recogniser writes down requests, and whether Android's on-device English pack is there. */
  stt: (): VoiceSttInfo | null => vcall<VoiceSttInfo | null>(a => (a.voiceStt ? a.voiceStt() : 'null'), null),
  /** "Use Google speech recognition" (online): off by default; only used when the on-device one isn't available. */
  setCloudStt: (on: boolean) => vcall(a => (a.voiceSetCloudStt ? a.voiceSetCloudStt(on) : '{"error":"update the tablet app"}'), { ok: false } as { ok: boolean }),
  /** Ask Android to download its on-device English speech pack. */
  downloadStt: () => vcall(a => (a.voiceSttDownload ? a.voiceSttDownload() : '{"error":"update the tablet app"}'), { ok: false } as { ok: boolean }),
  /** Say a short sample with one voice ('' = the current choice) without choosing it. */
  preview: (id: string, text: string) => vcall(a => (a.previewVoice ? a.previewVoice(id, text) : a.speak(text, 'preview')), { ok: false } as { ok: boolean; kind?: 'natural' | 'device' }),
  on(fn: (e: VoiceEvent) => void): void { voiceHandlers.push(fn); },
  /** Look mode (Camera) holds the spoken requests: while it does, a 'final' goes only to it, not to the Claude app.
   *  Returns the release. Every other event still goes to everyone. */
  claimFinals(fn: (text: string) => void): () => void { finalClaim = fn; return () => { if (finalClaim === fn) finalClaim = null; }; },
};
/** Why voice is off on this tablet, as a code (for the rail item's label). null = it's on, or not a tablet with voice.
 *  Reads the state directly: `voice.state()` throws on a failure, and the reason is what's wanted here. */
export function voiceOffReason(): VoiceReason | null {
  if (!vapi) return null;
  let r: { permission?: boolean; error?: string; code?: VoiceReason } | null;
  try { r = JSON.parse(vapi.voice()); } catch { return 'unknown'; }
  if (r?.error) return r.code ?? 'unknown';
  if (r && r.permission === false) return 'no_mic';
  return null;
}
function dispatchVoice(e: VoiceEvent): void {
  if (e.type === 'final' && finalClaim) { try { finalClaim(e.text); } catch (err) { console.error(err); } return; }
  voiceHandlers.forEach(f => { try { f(e); } catch (err) { console.error(err); } });
}
(window as unknown as { hubVoice: (e: VoiceEvent) => void }).hubVoice = dispatchVoice;

/** Speaking without the tablet app: the browser's own voice. It sends the same events as the tablet (speaking, then spoken). */
function webSay(text: string, id: string): { ok: boolean } {
  if (typeof speechSynthesis === 'undefined') return { ok: false };
  dispatchVoice({ type: 'speaking', id, natural: false });
  const u = new SpeechSynthesisUtterance(text);
  u.onend = () => dispatchVoice({ type: 'spoken', id, stopped: false });
  speechSynthesis.speak(u);
  return { ok: true };
}

// ---------- Android apps Claude Home may open (the Apps screen; Launcher.java) ----------
export interface AndroidApp { id: string; name: string; icon: string }   // icon: a small PNG data URL ('' if none)
interface LauncherApi {
  launchableApps(): string; allowedApps(): string; setAllowedApps(json: string): string; launchApp(pkg: string): string;
}
const lapi = api && typeof (api as unknown as Partial<LauncherApi>).launchableApps === 'function' ? api as unknown as LauncherApi : null;
function lcall<T>(fn: (a: LauncherApi) => string, fallback: T): T {
  if (!lapi) return fallback;
  const r = JSON.parse(fn(lapi)) as T & { error?: string };
  if (r && typeof r === 'object' && !Array.isArray(r) && 'error' in r && r.error) throw new Error(r.error);
  return r;
}
export const androidApps = {
  /** false on the Nest Hub, a normal browser, or a tablet app too old to have the Apps calls. */
  available: !!lapi,
  /** Every app on the tablet with a launcher icon (for the picker). */
  launchable: () => lcall<AndroidApp[]>(a => a.launchableApps(), []),
  /** The apps the user chose, in their order. */
  allowed: () => lcall<AndroidApp[]>(a => a.allowedApps(), []),
  setAllowed: (ids: string[]) => lcall(a => a.setAllowedApps(JSON.stringify(ids)), { ok: false } as { ok: boolean }),
  /** Opens an allowed app; the tablet refuses anything not on the list. */
  launch: (pkg: string) => lcall(a => a.launchApp(pkg), { ok: false } as { ok: boolean }),
};
// ---------- the Browser app's pages (BrowserView.java) ----------
// Web pages can't live in an iframe (most sites refuse to be framed), so on the tablet each browser tab is a
// native WebView that Android places exactly over the Browser app's content area. The page draws the chrome
// and tells the tablet where the content goes (screen pixels: getBoundingClientRect() × devicePixelRatio).
// The tablet reports back through window.hubBrowser(event). Calls are fire-and-forget; older app builds lack them.
//
// Claude control: browser.readPage / click / type / screenshot below. Each call resolves with the page's answer,
// which the tablet sends back as a 'claude' event matched by request id (see the handler at the end of this file).
export interface BrowserEvent {
  tab: string;                         // '' for events that belong to no tab (downloads, permission asks, messages)
  type: 'url' | 'title' | 'favicon' | 'progress' | 'error' | 'newtab' | 'blocked' | 'download'
      | 'chooser' | 'context' | 'find' | 'zoom' | 'reader' | 'thumb' | 'permission' | 'message' | 'chrome'
      | 'share' | 'viewer' | 'dialog' | 'claude';
  url?: string; title?: string;
  icon?: string;                       // favicon: a small PNG data URL (the mock may give a plain URL)
  progress?: number; loading?: boolean;
  canGoBack?: boolean; canGoForward?: boolean;
  code?: number; message?: string;     // error, blocked, download, message
  retryable?: boolean;                 // error: a second try may work (a timeout, DNS, refused, offline). Older builds send none.
  // download: id (DownloadManager's; 0 for a picture saved to Downloads), state, name, mime, bytes, total, uri
  // chrome (Google sign-in in Chrome's side sheet): state open or closed, url, session (whether Chrome gave a session),
  // and while open the sheet's left edge and width in screen px (Chrome's own report once it has laid the sheet out,
  // the requested width before that). 'open' comes again whenever the sheet moves. Older app builds send neither.
  id?: number; state?: 'start' | 'running' | 'done' | 'failed' | 'gone' | 'open' | 'closed'; name?: string; mime?: string;
  session?: boolean; left?: number; width?: number;
  bytes?: number; total?: number; uri?: string;
  // chooser (a page's file chooser): accept types, multiple, capture
  accept?: string; multiple?: boolean; capture?: boolean;
  // share (a link to share): title, url. viewer (a downloaded file to show): kind image | text | none, mime, data (an image's
  // data URL), text, message. dialog (a page's alert, confirm or prompt): dialogId, kind, message, value (the prompt's
  // default), host. The page answers a dialog with browser.dialog(dialogId, ok, text).
  dialogId?: string; value?: string; text?: string; data?: string;
  // claude (the answer to browser.readPage / click / type / screenshot): req matches the call; ok; data is the result or the reason
  req?: string; op?: string; ok?: boolean;
  // context (a long-press): kind, the link, the image. viewer: image | text | none. dialog: alert | confirm | prompt
  kind?: 'link' | 'image' | 'imagelink' | 'text' | 'none' | 'alert' | 'confirm' | 'prompt'; image?: string;
  // find: count, index (1-based, 0 for none), done; zoom: percent; reader: article (JSON text, '' if none); thumb: image
  count?: number; index?: number; done?: boolean; percent?: number; article?: string;
  // permission: reqId, origin, host, kinds (camera, microphone, geolocation; comma list)
  reqId?: string; origin?: string; host?: string; kinds?: string;
}
interface BrowserRect {x: number; y: number; w: number; h: number }
interface BrowserApi {
  browserShow(tab: string, url: string, x: number, y: number, w: number, h: number): string;
  browserHide(): string; browserCover(on: boolean): string;
  browserNavigate(tab: string, url: string): string;
  browserBack(tab: string): string; browserForward(tab: string): string;
  browserReload(tab: string): string; browserStop(tab: string): string;
  browserClose(tab: string): string; browserClearData(): string;
}
const bapi = api && typeof (api as unknown as Partial<BrowserApi>).browserShow === 'function' ? api as unknown as BrowserApi : null;
const bcall = (fn: (a: BrowserApi) => string): void => { if (bapi) { try { fn(bapi); } catch (e) { console.error(e); } } };
const browserHandlers: ((e: BrowserEvent) => void)[] = [];
// The Browser's further features (BrowserView.java, BrowserDownloads.java, BrowserFiles.java): private and desktop
// tabs, find, zoom, reader, snapshots, sharing, the long-press sheet, downloads, uploads, site permissions, links
// that other apps send to Claude Home. Synchronous answers are JSON; the rest work through window.hubBrowser.
interface BrowserApiMore {
  browserConfigure(tab: string, priv: boolean, desktop: boolean): string;
  browserDesktop(tab: string, on: boolean): string;
  browserFind(tab: string, query: string): string; browserFindStep(tab: string, forward: boolean): string; browserFindClose(tab: string): string;
  browserZoom(tab: string, step: number): string; browserReader(tab: string): string; browserSnapshot(tab: string): string;
  browserShare(title: string, url: string): string; browserCopy(text: string): string;
  browserContextAction(tab: string, action: string, url: string, image: string): string;
  browserOpenFile(uri: string, mime: string): string; browserShareFile(uri: string, mime: string): string;
  browserDownloadRemove(id: number, uri: string): string; browserDownloadsInfo(ids: string): string;
  browserChooseFile(tab: string, kind: string, data: string, name: string): string;
  browserPermission(reqId: string, allow: boolean): string;
  browserIncoming(): string; browserDialog(dialogId: string, ok: boolean, text: string): string; browserChromeDone(): string;
  browserOpenUrl(url: string): string;
  browserGoogleSignin(): string; browserSetGoogleSignin(inChrome: boolean): string;
}
interface BrowserDownloadInfo {id: number; state: 'running' | 'done' | 'failed' | 'gone'; name?: string; bytes?: number; total?: number; uri?: string; mime?: string }
const bmore = (fn: (a: BrowserApiMore) => string): void => { if (bapi) { try { fn(bapi as unknown as BrowserApiMore); } catch (e) { console.error(e); } } };
function bjson<T>(fn: (a: BrowserApiMore) => string, fallback: T): T {
  if (!bapi) return fallback;
  try { const r = JSON.parse(fn(bapi as unknown as BrowserApiMore)) as T | null; return r ?? fallback; } catch (e) { console.error(e); return fallback; }
}
export const browser = {
  configure: (tab: string, priv: boolean, desktop: boolean) => bmore(a => a.browserConfigure(tab, priv, desktop)),
  desktop: (tab: string, on: boolean) => bmore(a => a.browserDesktop(tab, on)),
  find: (tab: string, query: string) => bmore(a => a.browserFind(tab, query)),
  findStep: (tab: string, forward: boolean) => bmore(a => a.browserFindStep(tab, forward)),
  findClose: (tab: string) => bmore(a => a.browserFindClose(tab)),
  /** step 1 bigger, -1 smaller, 0 back to the fitted page. */
  zoom: (tab: string, step: number) => bmore(a => a.browserZoom(tab, step)),
  reader: (tab: string) => bmore(a => a.browserReader(tab)),
  snapshot: (tab: string) => bmore(a => a.browserSnapshot(tab)),
  share: (title: string, url: string) => bmore(a => a.browserShare(title, url)),
  copy: (text: string) => { bmore(a => a.browserCopy(text)); if (bapi) recordClip(text); },
  /** action: newtab, copy, share, download (a link), save (an image). */
  contextAction: (tab: string, action: string, url = '', image = '') => bmore(a => a.browserContextAction(tab, action, url, image)),
  openFile: (uri: string, mime = '') => bmore(a => a.browserOpenFile(uri, mime)),
  shareFile: (uri: string, mime = '') => bmore(a => a.browserShareFile(uri, mime)),
  removeDownload: (id: number, uri: string) => bmore(a => a.browserDownloadRemove(id, uri)),
  /** The state now of downloads the page holds. */
  downloadsInfo: (ids: number[]): BrowserDownloadInfo[] => bjson<BrowserDownloadInfo[]>(a => a.browserDownloadsInfo(ids.join(',')), []),
  /** Answers a page's file chooser: photo (data = a JPEG data URL, from ClaudeOS's own photos or camera), or cancel. */
  chooseFile: (tab: string, kind: 'photo' | 'cancel', data = '', name = '') => bmore(a => a.browserChooseFile(tab, kind, data, name)),
  /** The answer to a permission ask (a site's camera, microphone or location). */
  permission: (reqId: string, allow: boolean) => bmore(a => a.browserPermission(reqId, allow)),
  /** A link another app sent to Claude Home, once ('' when none). */
  incoming: (): string => bjson<{ url?: string }>(a => a.browserIncoming(), {}).url || '',
  /** Opens an http(s) link in a new tab of the Browser app. False when this build can't, or the tablet refuses the link. */
  openUrl: (url: string): boolean => {
    if (!bapi || typeof (bapi as unknown as Partial<BrowserApiMore>).browserOpenUrl !== 'function') return false;
    return bjson<{ ok?: boolean }>(a => a.browserOpenUrl(url), {}).ok === true;
  },
  /** The answer to a page's alert, confirm or prompt (text: what was typed, for a prompt). */
  dialog: (dialogId: string, ok: boolean, text = '') => bmore(a => a.browserDialog(dialogId, ok, text)),
  /** Finishes Chrome's Google sign-in side sheet (the Browser's panel's Done); Claude Home comes back to the front. */
  chromeDone: () => bmore(a => a.browserChromeDone()),
  /** Google sign-in: true = the Chrome panel (default), false = load it in the Browser's own pages. */
  googleSigninInChrome: (): boolean => bjson<{ inChrome?: boolean }>(a => a.browserGoogleSignin(), {}).inChrome !== false,
  setGoogleSigninInChrome: (on: boolean) => bmore(a => a.browserSetGoogleSignin(on)),
  /** false on the Nest Hub, a normal browser, or a tablet app without BrowserView. */
  available: !!bapi,
  /** Show tab `tab` over `r` (screen px); creates its page and loads `url` the first time. */
  show: (tab: string, url: string, r: BrowserRect) => bcall(a => a.browserShow(tab, url, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))),
  hide: () => bcall(a => a.browserHide()),
  /** Something of Claude Home's (control center, switcher, a sheet, the keyboard) is over the content: hide meanwhile. */
  cover: (on: boolean) => bcall(a => a.browserCover(on)),
  navigate: (tab: string, url: string) => bcall(a => a.browserNavigate(tab, url)),
  back: (tab: string) => bcall(a => a.browserBack(tab)),
  forward: (tab: string) => bcall(a => a.browserForward(tab)),
  reload: (tab: string) => bcall(a => a.browserReload(tab)),
  stop: (tab: string) => bcall(a => a.browserStop(tab)),
  close: (tab: string) => bcall(a => a.browserClose(tab)),
  /** Cookies, storage and cache of the sites you visited (Claude Home's own storage is kept). */
  clearData: () => bcall(a => a.browserClearData()),
  // ---- Claude control: each call resolves with the page's answer, or rejects with the reason ----
  readPage: (tab: string) => claudeCall<ClaudePage>(req => claudeApi().browserReadPage(tab, req), 'read'),
  click: (tab: string, ref: string) => claudeCall<string>(req => claudeApi().browserClick(tab, req, ref), 'click'),
  type: (tab: string, ref: string, text: string) => claudeCall<string>(req => claudeApi().browserType(tab, req, ref, text), 'type'),
  screenshot: (tab: string) => claudeCall<string>(req => claudeApi().browserScreenshot(tab, req), 'screenshot'),
  on(fn: (e: BrowserEvent) => void): void { browserHandlers.push(fn); },
};

// ---------- Claude control (BrowserView.java: readPage, click, type, screenshot) ----------
/** What browser.readPage returns: the visible page as text, its links and its fields (refs for click and type). */
export interface ClaudePage {
  url: string; title: string; text: string;
  links: { ref: string; text: string; href: string }[];
  fields: { ref: string; label: string; type: string; value: string }[];
}
interface BrowserApiClaude {
  browserReadPage(tab: string, req: string): string; browserClick(tab: string, req: string, ref: string): string;
  browserType(tab: string, req: string, ref: string, text: string): string; browserScreenshot(tab: string, req: string): string;
}
const pendingClaude = new Map<string, { resolve: (data: string) => void; reject: (e: Error) => void }>();
let claudeSeq = 0;
function claudeApi(): BrowserApiClaude {
  if (!bapi) throw new Error('This tablet build has no browser control');
  return bapi as unknown as BrowserApiClaude;
}
/** Sends one call (start gets its request id) and waits for the matching 'claude' event; 15 s at most. */
function claudeCall<T>(start: (req: string) => string, op: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = `c${++claudeSeq}`;
    const timer = window.setTimeout(() => { pendingClaude.delete(req); reject(new Error(`${op} timed out`)); }, 15000);
    pendingClaude.set(req, {
      resolve: data => { window.clearTimeout(timer); try { resolve((op === 'read' ? JSON.parse(data) : data) as T); } catch (e) { reject(e as Error); } },
      reject: e => { window.clearTimeout(timer); reject(e); },
    });
    let answer: { ok?: boolean; error?: string } = {};
    try { answer = JSON.parse(start(req)) as typeof answer; } catch { answer = {}; }
    if (answer.ok === false) { pendingClaude.delete(req); window.clearTimeout(timer); reject(new Error(answer.error || `${op} refused`)); }
  });
}
(window as unknown as { hubBrowser: (e: BrowserEvent) => void }).hubBrowser = e => {
  if (e.type === 'claude' && e.req) {
    const p = pendingClaude.get(e.req);
    if (p) { pendingClaude.delete(e.req); if (e.ok) p.resolve(e.data ?? ''); else p.reject(new Error(e.data || 'failed')); }
    return;
  }
  browserHandlers.forEach(f => { try { f(e); } catch (err) { console.error(err); } });
};

// ---------- the camera (CameraView.java; android/) ----------
// The web page can't use getUserMedia here (it needs a secure origin), so the camera is native: a live preview
// drawn UNDER the page, in the rectangle the page gives (screen px). The page's preview area is see-through
// while the camera is on (html.cam-live), so the page's own UI (the voice indicator, sheets) draws over it.
// A photo is taken with cameraCapture(id, sound): the tablet uploads a JPEG to the PC (POST /api/photos/upload), and
// 'captured' follows. The camera is open only while the page asks for it; Android stops it when Claude Home
// leaves the screen, and then sends 'closed'.
interface CameraRect {x: number; y: number; w: number; h: number }
type CameraEvent =
  | { type: 'opened' }
  | { type: 'closed'; reason: 'closed' | 'paused' | 'error' }
  | { type: 'captured'; id: string; url: string }
  | { type: 'error'; code?: string; message: string; id?: string };   // code: busy, no_camera, denied or failed
interface CameraApi {
  cameraOpen(facing: string, x: number, y: number, w: number, h: number): string;
  cameraMove(x: number, y: number, w: number, h: number): string;
  cameraClose(): string;
  cameraCapture(id: string, sound: boolean): string;
}
const capi = api && typeof (api as unknown as Partial<CameraApi>).cameraOpen === 'function' ? api as unknown as CameraApi : null;
const cameraHandlers: ((e: CameraEvent) => void)[] = [];
function ccall(fn: (a: CameraApi) => string): { ok: boolean; asking?: boolean; error?: string } {
  if (!capi) return { ok: false, error: 'no camera' };
  try { const r = JSON.parse(fn(capi)) as { ok?: boolean; asking?: boolean; error?: string }; return { ok: !!r.ok, asking: r.asking, error: r.error }; }
  catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
}

/** An element's place on the screen in device pixels (the WebView's own pixels), for the native camera. */
export function screenRect(el: Element): CameraRect {
  const b = el.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  return { x: Math.round(b.left * d), y: Math.round(b.top * d), w: Math.round(b.width * d), h: Math.round(b.height * d) };
}

export const camera = {
  /** false on the Nest Hub, a normal browser, or a tablet app without the camera. */
  available: !!capi,
  /** Open the preview over `r`. {ok, asking}: asking = Android's camera permission prompt is up (try again after). */
  open: (facing: 'back' | 'front', r: CameraRect) => ccall(a => a.cameraOpen(facing, r.x, r.y, r.w, r.h)),
  /** Move or resize the preview (after the page's layout changes). */
  move: (r: CameraRect) => ccall(a => a.cameraMove(r.x, r.y, r.w, r.h)),
  close: () => ccall(a => a.cameraClose()),
  /** Take a photo and send it to the PC under this id ('captured' or 'error' follows, with the same id).
   *  sound: play the shutter click (the page has checked chimes and Do Not Disturb). A short tap always plays. */
  capture: (id: string, sound: boolean) => ccall(a => a.cameraCapture(id, sound)),
  on(fn: (e: CameraEvent) => void): void { cameraHandlers.push(fn); },
};
(window as unknown as { hubCamera: (e: CameraEvent) => void }).hubCamera = e => cameraHandlers.forEach(f => { try { f(e); } catch (err) { console.error(err); } });