// A pretend desk tablet, so Claude Home can be run and clicked around in a normal browser on the PC
// exactly like the Android app: open http://<pc>:8000/?device=mock
//
// It provides window.HubDevice (every call the Android app's Bridge.java offers, returning JSON strings),
// keeps its state in localStorage ('mock.device'), and adds a small "Mock tablet" panel (bottom right)
// to simulate things: battery level and charging, Wi-Fi, Desk mode setup, and voice ("Hey Claude" +
// what you'd say, or the browser's own speech recognition if it has one). Speech uses the browser's voices.
//
// Loaded as a classic script by index.html BEFORE the app's modules, so device.ts sees HubDevice at startup.
// No imports or exports on purpose: it must run as a plain script.
(() => {
  if (!/[?&]device=mock\b/.test(location.search)) return;

  type Json = Record<string, unknown>;
  interface MockState {
    battery: number; charging: boolean; tempC: number;
    wifiOn: boolean; ssid: string; saved: string[];
    brightness: number; media: number; alarm: number;
    kiosk: boolean; done: Record<string, boolean>;
    wake: boolean; voice: string; rate: number; natural: boolean;
    voiceLang: string; pitch: number; keySuggestions: boolean; keySounds: boolean;   // spoken language ('' = the browser's), voice style, keyboard switches
    hidden: Record<string, boolean>;
    allowed: string[];
    notifVol: number; autoBright: boolean; offSec: number; tz: string; tzAuto: boolean;
    adb: boolean; adbKeep: boolean | null;   // wireless debugging; keep null = never chosen (on by default once enabled)
  }
  const KEY = 'mock.device';
  const defaults: MockState = {
    battery: 64, charging: true, tempC: 27.5,
    wifiOn: true, ssid: 'Home Wi-Fi', saved: ['Home Wi-Fi'],
    brightness: .8, media: .6, alarm: .8,
    kiosk: true, done: { home: true, guard: true, wifi: true, location: true, brightness: true, awake: false, battery: false, lock: true, keyboard: false },
    wake: true, voice: '', rate: 1, natural: false, voiceLang: '', pitch: 1, keySuggestions: true, keySounds: false, hidden: {}, allowed: ['com.google.android.gm', 'com.google.android.calendar'],
    notifVol: .7, autoBright: false, offSec: 300, tz: 'Europe/London', tzAuto: false,
    adb: false, adbKeep: null,
  };
  let s: MockState;
  try { s = { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<MockState>) }; } catch { s = { ...defaults }; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ } };
  const ok = (extra: Json = {}) => JSON.stringify({ ok: true, ...extra });
  const j = (v: unknown) => JSON.stringify(v);
  const emit = (e: Json) => { const h = (window as unknown as { hubVoice?: (e: Json) => void }).hubVoice; if (h) h(e); };
  const resume = () => { const h = (window as unknown as { hubResume?: () => void }).hubResume; if (h) h(); };
  document.documentElement.classList.add('mock-device');

  // ---------- screen brightness: a dark veil over the page, like a backlight going down ----------
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:2147483000;transition:opacity .4s';
  // gentle above half brightness (a PC screen is already lit), darker below, like a backlight
  const paintVeil = () => { const b = s.brightness; veil.style.opacity = String(b >= .5 ? (1 - b) * .25 : Math.min(.85, .125 + (.5 - b) * 1.4)); };
  addEventListener('DOMContentLoaded', () => { document.body.appendChild(veil); paintVeil(); });

  // ---------- speech: the browser's voices ----------
  let mode: 'off' | 'wake' | 'listen' | 'speaking' = s.wake ? 'wake' : 'off';
  const synth = 'speechSynthesis' in window ? speechSynthesis : null;
  const browserVoices = () => (synth ? synth.getVoices() : []);
  function say(text: string, id: string): void {
    emit({ type: 'speaking', id, natural: false });
    if (!synth || s.media <= 0) { setTimeout(() => emit({ type: 'spoken', id, stopped: false }), Math.min(6000, 400 + text.length * 45)); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = browserVoices().find(x => x.voiceURI === s.voice);
    if (v) u.voice = v;
    u.rate = s.rate; u.volume = s.media; u.pitch = s.pitch;
    mode = 'speaking';
    u.onend = () => { mode = s.wake ? 'wake' : 'off'; emit({ type: 'spoken', id, stopped: false }); };
    synth.speak(u);
  }

  // what "you said": typed into the panel, or the browser's recogniser if there is one
  function hear(text: string, withWake: boolean): void {
    if (withWake) emit({ type: 'wake' });
    mode = 'listen';
    emit({ type: 'state', mode: 'listening' });
    const words = text.split(/\s+/).filter(Boolean);
    let i = 0;
    const step = () => {
      i++;
      emit({ type: 'level', v: .3 + Math.random() * .5 });
      if (i <= words.length) { emit({ type: 'partial', text: words.slice(0, i).join(' ') }); setTimeout(step, 160); return; }
      mode = s.wake ? 'wake' : 'off';
      emit(text.trim() ? { type: 'final', text: text.trim() } : { type: 'timeout' });
      emit({ type: 'state', mode: mode === 'wake' ? 'wake' : 'off' });
    };
    setTimeout(step, withWake ? 450 : 150);
  }

  const networks = () => {
    const base = [
      { ssid: 'Home Wi-Fi', bars: 4, secure: true },
      { ssid: 'Home Wi-Fi 5G', bars: 3, secure: true },
      { ssid: 'Neighbour', bars: 2, secure: true },
      { ssid: 'Coffee Shop', bars: 1, secure: false },
      { ssid: 'Office', bars: 2, secure: true, enterprise: true },
    ];
    return s.wifiOn ? base.map(n => ({ enterprise: false, wpa3: false, ...n, saved: s.saved.includes(n.ssid), current: n.ssid === s.ssid })) : [];
  };
  const SETUP: [string, string, string, boolean][] = [
    ['home', 'ClaudeOS is the home screen', 'Home always comes back here, and it opens when the tablet starts.', false],
    ['guard', 'Accessibility permission', 'Turn on ClaudeOS under Accessibility, so it can close the pull-down bar and the recents screen.', false],
    ['wifi', 'Wi-Fi list allowed', 'Network names only show up for apps with location access.', false],
    ['location', 'Location is on', 'Needed for Wi-Fi scanning. Nothing uses your location.', false],
    ['brightness', 'Brightness control', 'Lets ClaudeOS dim the whole screen, e.g. at night.', false],
    ['awake', 'Stay awake while charging', 'Keeps the tablet awake while it’s plugged in.', false],
    ['battery', 'Never put ClaudeOS to sleep', 'Stops the tablet pausing ClaudeOS to save battery.', false],
    ['lock', 'No screen lock', 'Set Screen lock to None, so ClaudeOS never sits behind a lock screen.', false],
    ['keyboard', 'ClaudeOS Keyboard is the tablet’s keyboard', 'ClaudeOS Keyboard types in every app.', true],
  ];

  // ---------- Android apps for the Apps screen: a few pretend ones with drawn icons ----------
  const appIcon = (bg: string, fg: string, glyph: string) => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="${bg}"/>${glyph.replace(/FG/g, fg)}</svg>`);
  const MOCK_APPS: { id: string; name: string; icon: string }[] = [
    { id: 'com.google.android.gm', name: 'Gmail', icon: appIcon('#fff', '#d93025', '<path d="M22 32v34h10V44l16 12 16-12v22h10V32l-26 19z" fill="FG"/>') },
    { id: 'com.google.android.calendar', name: 'Calendar', icon: appIcon('#4285f4', '#fff', '<rect x="24" y="26" width="48" height="46" rx="6" fill="FG"/><text x="48" y="64" font-family="Arial" font-weight="700" font-size="26" text-anchor="middle" fill="#4285f4">21</text>') },
    { id: 'com.google.android.youtube', name: 'YouTube', icon: appIcon('#ff0000', '#fff', '<path d="M40 34v28l24-14z" fill="FG"/>') },
    { id: 'com.android.chrome', name: 'Web Browser', icon: appIcon('#fff', '#1a73e8', '<circle cx="48" cy="48" r="28" fill="#34a853"/><circle cx="48" cy="48" r="12" fill="FG" stroke="#fff" stroke-width="5"/>') },
  ];
  function mockNote(text: string): void {
    const n = document.createElement('div');
    n.textContent = text;
    n.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483001;padding:12px 18px;border-radius:12px;background:#141413;color:#faf9f5;font:14px Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.3);transition:opacity .4s';
    document.body.appendChild(n);
    setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 450); }, 2600);
  }
  const launcherCalls = {
    launchableApps: () => j(MOCK_APPS),
    allowedApps: () => j(s.allowed.map(id => MOCK_APPS.find(a => a.id === id)).filter(Boolean)),
    setAllowedApps: (json: string) => { try { s.allowed = (JSON.parse(json) as string[]).filter(id => MOCK_APPS.some(a => a.id === id)); save(); return ok(); } catch { return j({ error: 'bad list' }); } },
    launchApp: (pkg: string) => {
      const a = MOCK_APPS.find(x => x.id === pkg);
      if (!a || !s.allowed.includes(pkg)) return j({ error: 'not allowed' });
      // the Android app "in front": a plain screen over the page until you go back, which resumes Claude Home
      const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147482990;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font:16px Inter,system-ui,sans-serif;color:#141413';
      cover.innerHTML = `<img src="${a.icon}" width="120" height="120" alt=""><b style="font-size:28px;font-weight:500">${a.name}</b>`
        + '<span style="color:#5e5d59">A pretend app (mock tablet).</span>'
        + '<button style="margin-top:12px;padding:12px 22px;border-radius:12px;border:0;background:#141413;color:#faf9f5;font:inherit;cursor:pointer">Back to ClaudeOS</button>';
      cover.querySelector('button')!.addEventListener('click', () => { cover.remove(); resume(); });
      document.body.appendChild(cover);
      return ok();
    },
  };

  // ---------- camera: a placeholder preview (a gradient card under the page) and placeholder photos ----------
  // Photos go to the PC's /api/photos/upload exactly like the tablet's, so the whole flow can be tried here.
  let camEl: HTMLElement | null = null, camCanvas: HTMLCanvasElement | null = null, camTimer: number | undefined;
  const emitCam = (e: Json) => { const h = (window as unknown as { hubCamera?: (e: Json) => void }).hubCamera; if (h) h(e); };
  const camPlace = (x: number, y: number, w: number, h: number) => {
    if (!camEl) return;
    const d = window.devicePixelRatio || 1;
    Object.assign(camEl.style, { left: `${x / d}px`, top: `${y / d}px`, width: `${w / d}px`, height: `${h / d}px` });
  };
  function paintMockCamera(c: HTMLCanvasElement, label: string): void {
    const g = c.getContext('2d');
    if (!g) return;
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#d97757'); grad.addColorStop(.55, '#e8c4a8'); grad.addColorStop(1, '#6a9bcc');
    g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(20,20,19,.72)';
    g.font = `500 ${Math.round(c.height * .07)}px Georgia, serif`;
    g.textAlign = 'center';
    g.fillText('Mock camera', c.width / 2, c.height * .46);
    g.font = `400 ${Math.round(c.height * .05)}px Inter, system-ui, sans-serif`;
    g.fillText(`${label} · ${new Date().toLocaleTimeString()}`, c.width / 2, c.height * .58);
  }
  const camCalls = {
    cameraOpen: (facing: string, x: number, y: number, w: number, h: number) => {
      if (!camEl) {
        camEl = document.createElement('div');
        camEl.style.cssText = 'position:fixed;z-index:-1;overflow:hidden;background:#141413;pointer-events:none';
        camCanvas = document.createElement('canvas'); camCanvas.width = 960; camCanvas.height = 720;
        camCanvas.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover';
        camEl.appendChild(camCanvas);
        document.body.appendChild(camEl);
      }
      camPlace(x, y, w, h);
      const label = facing === 'front' ? 'Front' : 'Back';
      if (camCanvas) paintMockCamera(camCanvas, label);
      clearInterval(camTimer);
      camTimer = window.setInterval(() => { if (camCanvas) paintMockCamera(camCanvas, label); }, 1000);
      setTimeout(() => emitCam({ type: 'opened' }), 250);
      return ok();
    },
    cameraMove: (x: number, y: number, w: number, h: number) => { camPlace(x, y, w, h); return ok(); },
    cameraClose: () => {
      clearInterval(camTimer);
      camEl?.remove(); camEl = null; camCanvas = null;
      setTimeout(() => emitCam({ type: 'closed', reason: 'closed' }), 0);
      return ok();
    },
    cameraCapture: (id: string) => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
      paintMockCamera(c, 'Photo');
      c.toBlob(async blob => {
        try {
          const r = await fetch('/api/photos/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': id }, body: blob });
          const j = await r.json() as { ok: boolean; url?: string; error?: string };
          if (j.ok && j.url) emitCam({ type: 'captured', id, url: j.url });
          else emitCam({ type: 'error', id, message: j.error || 'upload failed' });
        } catch { emitCam({ type: 'error', id, message: 'upload failed' }); }
      }, 'image/jpeg', .9);
      return ok();
    },
  };

  const HubDevice = {
    ...launcherCalls,
    ...camCalls,
    info: () => j({ app: '1.2 (mock)', model: 'Mock tablet', maker: 'ClaudeOS', android: '14', sdk: 34, owner: false, pinned: false }),
    battery: () => j({ percent: Math.round(s.battery), charging: s.charging, full: s.charging && s.battery >= 100, plugged: s.charging ? 'ac' : '', tempC: s.tempC, voltage: 4.1, health: 'good' }),
    wifi: () => j(s.wifiOn ? (s.ssid ? { enabled: true, ssid: s.ssid, bars: 4, ip: '192.168.1.50', mbps: 433 } : { enabled: true }) : { enabled: false }),
    wifiScan: () => ok(),
    wifiNetworks: () => j(networks()),
    wifiConnect: (ssid: string) => { setTimeout(() => { s.ssid = ssid; if (!s.saved.includes(ssid)) s.saved.push(ssid); save(); }, 1500); return ok(); },
    wifiForget: (ssid: string) => { s.saved = s.saved.filter(x => x !== ssid); if (s.ssid === ssid) s.ssid = ''; save(); return ok(); },
    googleAccounts: () => j({ accounts: (JSON.parse(localStorage.getItem('mock.google') || '[]') as string[]).map(name => ({ name })) }),
    addGoogleAccount: () => { localStorage.setItem('mock.google', JSON.stringify(['you@gmail.com'])); return ok(); },
    googleCheck: () => ok(),
    wifiEnable: (on: boolean) => { s.wifiOn = on; if (!on) s.ssid = ''; else if (!s.ssid && s.saved[0]) s.ssid = s.saved[0]; save(); panelPaint(); return ok(); },
    brightness: () => j({ value: s.brightness }),
    setBrightness: (v: number) => { s.brightness = Math.max(.01, Math.min(1, v)); save(); paintVeil(); return ok(); },
    keepAwake: () => ok(),
    volume: () => j({ media: s.media, alarm: s.alarm, notification: s.notifVol }),
    setVolume: (which: string, v: number) => {
      if (which === 'alarm') s.alarm = v; else if (which === 'notification') s.notifVol = v; else s.media = v;
      save(); return ok();
    },
    screen: () => j({ auto: s.autoBright, offSec: s.offSec }),
    setAutoBrightness: (on: boolean) => { s.autoBright = on; save(); return ok(); },
    setScreenOff: (sec: number) => { s.offSec = sec; save(); return ok(); },
    storage: () => j({ total: 58 * 1024 ** 3, free: 31.4 * 1024 ** 3 }),
    timeZone: () => j({ id: s.tz, auto: s.tzAuto }),
    setTimeZone: (id: string) => { s.tz = id; s.tzAuto = false; save(); return ok(); },
    bluetooth: () => j({ supported: true, on: true, devices: [{ name: 'Mock headphones', mac: '00:11:22:33:44:55' }, { name: 'Mock keyboard', mac: '66:77:88:99:AA:BB' }] }),
    apps: () => j([
      { id: 'com.google.android.inputmethod.latin', name: 'Keyboard', system: true, hidden: !!s.hidden['com.google.android.inputmethod.latin'], protected: false },
      { id: 'com.android.chrome', name: 'Web Browser', system: true, hidden: !!s.hidden['com.android.chrome'], protected: false },
      { id: 'hub.kiosk', name: 'ClaudeOS', system: false, hidden: false, protected: true },
    ]),
    setAppHidden: (pkg: string, hidden: boolean) => { s.hidden[pkg] = hidden; save(); return ok(); },
    setup: () => j({ owner: false, kiosk: s.kiosk, items: SETUP.map(([id, title, detail, optional]) => ({ id, title, detail, optional, done: !!s.done[id] })) }),
    fix: (id: string) => { setTimeout(() => { s.done[id] = true; save(); resume(); }, 900); return ok(); },   // "Android's screen" comes and goes
    setKiosk: (on: boolean) => { s.kiosk = on; save(); return ok(); },
    adbWifi: () => j({ on: s.adb, canControl: true, needsGrant: false, ip: s.wifiOn ? '192.168.1.50' : '', port: s.adb ? '37141' : '', keep: !!s.adbKeep }),
    setAdbWifi: (on: boolean) => { s.adb = on; if (on) { if (s.adbKeep === null) s.adbKeep = true; } else s.adbKeep = false; save(); return ok(); },
    setAdbWifiKeep: (keep: boolean) => { s.adbKeep = keep; save(); return ok(); },
    keyboardStatus: () => j({ enabled: true, isDefault: !!s.done.keyboard, canSet: true }),
    keyboardSetDefault: () => { s.done.keyboard = true; save(); return ok(); },
    keyboardClearLearned: () => ok(),
    keyboardPrefs: () => j({ suggestions: s.keySuggestions, keySounds: s.keySounds }),
    keyboardSetPref: (name: string, on: boolean) => {
      if (name === 'suggestions') s.keySuggestions = on; else if (name === 'keySounds') s.keySounds = on; else return j({ error: 'unknown keyboard setting' });
      save(); return ok();
    },
    setTopColor: () => ok(), setTopRail: () => ok(), setTopBand: () => ok(),
    topInset: () => j({ px: 0 }),
    guardLog: () => j([]),
    reboot: () => { setTimeout(() => location.reload(), 600); return ok(); },
    screenOff: () => { console.info('[mock] On the tablet the screen turns off now.'); return ok(); },
    maintenance: () => { alert('On the tablet this opens Android’s Settings (Desk mode pauses until you come back).'); resume(); return ok(); },
    // voice
    voice: () => j({ permission: true, wake: s.wake, mode, speaking: mode === 'speaking' }),
    voiceSetWake: (on: boolean) => { s.wake = on; mode = on ? 'wake' : 'off'; save(); emit({ type: 'state', mode: on ? 'wake' : 'off' }); return ok(); },
    // as the tablet: tap to talk says "listening" at once, and a cancel ends it with "cancel" then the idle state
    voiceListen: () => { openSay(false); mode = 'listen'; emit({ type: 'state', mode: 'listening' }); return ok(); },
    voiceCancel: () => { mode = s.wake ? 'wake' : 'off'; emit({ type: 'cancel' }); emit({ type: 'state', mode: mode }); return ok(); },
    speak: (text: string, id: string) => { say(text, id); return ok(); },
    stopSpeaking: () => { synth?.cancel(); mode = s.wake ? 'wake' : 'off'; return ok(); },
    voices: () => {
      const list = browserVoices().map(v => ({ id: v.voiceURI, label: `${v.localService ? 'On-device' : 'Natural'} · ${v.name}`, locale: v.lang, language: v.lang, network: !v.localService, quality: 400, installed: true, current: v.voiceURI === s.voice }));
      return j({ ready: true, voice: s.voice, rate: s.rate, voices: list, natural: s.natural, online: navigator.onLine, using: s.voice || (list[0]?.id ?? ''), usingNatural: false,
        lang: s.voiceLang || navigator.language, pitch: s.pitch });
    },
    setVoice: (id: string | null, rate: number) => { if (id != null) s.voice = id; if (rate) s.rate = rate; save(); return ok(); },
    setVoiceLanguage: (tag: string) => {
      s.voiceLang = tag || '';
      // a chosen voice of another language is dropped, as the tablet does
      const want = (tag || navigator.language || 'en').split('-')[0].toLowerCase();
      const cur = browserVoices().find(x => x.voiceURI === s.voice);
      if (s.voice && (!cur || cur.lang.split('-')[0].toLowerCase() !== want)) s.voice = '';
      save(); return ok();
    },
    setVoicePitch: (pitch: number) => { if (pitch > 0) s.pitch = Math.max(.8, Math.min(1.2, pitch)); save(); return ok(); },
    setVoiceNatural: (on: boolean) => { s.natural = on; save(); return ok(); },
    previewVoice: (id: string, text: string) => { const keep = s.voice; s.voice = id || keep; say(text, 'preview'); s.voice = keep; return ok({ kind: 'device' }); },
    voiceDiag: () => j({ mode, rate: 16000, effects: 'mock (typed speech)', level: .1, peak: .2, levels: Array.from({ length: 50 }, () => .05 + Math.random() * .08), heard: lastHeard }),
  };
  const lastHeard: { at: number; text: string; final: boolean; woke: boolean }[] = [];
  (window as unknown as { HubDevice: typeof HubDevice }).HubDevice = HubDevice;
  addEventListener('online', () => panelPaint()); addEventListener('offline', () => panelPaint());

  // ---------- the "Mock tablet" panel ----------
  let panel: HTMLElement;
  function openSay(withWake: boolean): void {
    panel.classList.add('open');
    const f = panel.querySelector<HTMLInputElement>('#mkSay')!;
    f.dataset.wake = withWake ? '1' : '';
    f.focus();
  }
  function panelPaint(): void {
    if (!panel) return;
    (panel.querySelector('#mkBatt') as HTMLInputElement).value = String(Math.round(s.battery));
    panel.querySelector('#mkBattV')!.textContent = `${Math.round(s.battery)}%`;
    (panel.querySelector('#mkChg') as HTMLInputElement).checked = s.charging;
    (panel.querySelector('#mkWifi') as HTMLInputElement).checked = s.wifiOn;
    (panel.querySelector('#mkWake') as HTMLInputElement).checked = s.wake;
  }
  addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = `
      .mk { position: fixed; right: 12px; bottom: 12px; z-index: 2147483600; font: 12px/1.35 Inter, system-ui, sans-serif; color: #141413; }
      .mk-tab { all: unset; cursor: pointer; display: block; margin-left: auto; padding: 6px 11px; border-radius: 99px; background: #141413; color: #faf9f5; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
      .mk-body { display: none; width: 260px; margin-top: 8px; padding: 12px 14px; border-radius: 14px; background: #faf9f5; border: 1px solid #dedcd1; box-shadow: 0 12px 34px rgba(0,0,0,.22); }
      .mk.open .mk-body { display: block; }
      .mk h4 { margin: 10px 0 4px; font: 600 11px Inter, sans-serif; letter-spacing: .05em; text-transform: uppercase; color: #87867f; }
      .mk h4:first-child { margin-top: 0; }
      .mk label { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
      .mk input[type=range] { flex: 1; }
      .mk input[type=text] { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 9px; border: 1px solid #dedcd1; font: inherit; }
      .mk button.mk-b { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 8px; background: #f0eee6; border: 1px solid #dedcd1; margin: 4px 4px 0 0; }
      .mk button.mk-b.primary { background: #d97757; border-color: #d97757; color: #fff; }
      .mk small { color: #87867f; }`;
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.className = 'mk';
    panel.innerHTML = `
      <button class="mk-tab" id="mkTab">Mock tablet</button>
      <div class="mk-body">
        <h4>Battery</h4>
        <label><input type="range" id="mkBatt" min="1" max="100"><span id="mkBattV"></span></label>
        <label><input type="checkbox" id="mkChg"> Charging</label>
        <h4>Network</h4>
        <label><input type="checkbox" id="mkWifi"> Wi-Fi on</label>
        <h4>Voice</h4>
        <label><input type="checkbox" id="mkWake"> “Hey Claude” on</label>
        <input type="text" id="mkSay" placeholder="What you’d say after “Hey Claude”…">
        <div><button class="mk-b primary" id="mkHey">Hey Claude</button><button class="mk-b" id="mkMic">Use my mic</button></div>
        <small>Speech plays through this PC’s speakers with the browser’s voices.</small>
        <h4>Desk mode</h4>
        <div><button class="mk-b" id="mkAllSet">All steps done</button><button class="mk-b" id="mkFresh">Fresh tablet</button></div>
        <h4>Reset</h4>
        <div><button class="mk-b" id="mkReset">Reset mock tablet</button></div>
      </div>`;
    document.body.appendChild(panel);
    const $ = (id: string) => panel.querySelector('#' + id) as HTMLInputElement;
    $('mkTab').addEventListener('click', () => panel.classList.toggle('open'));
    $('mkBatt').addEventListener('input', () => { s.battery = +$('mkBatt').value; save(); panelPaint(); });
    $('mkChg').addEventListener('change', () => { s.charging = $('mkChg').checked; save(); });
    $('mkWifi').addEventListener('change', () => HubDevice.wifiEnable($('mkWifi').checked));
    $('mkWake').addEventListener('change', () => HubDevice.voiceSetWake($('mkWake').checked));
    const send = () => {
      const t = $('mkSay').value; const wake = $('mkSay').dataset.wake !== '';   // typed after "Listen" (mic button) = no wake word
      lastHeard.unshift({ at: Date.now(), text: `hey claude ${t}`.trim(), final: true, woke: true }); lastHeard.length = Math.min(lastHeard.length, 10);
      $('mkSay').value = ''; $('mkSay').dataset.wake = '1';
      hear(t, wake);
    };
    $('mkSay').dataset.wake = '1';
    $('mkSay').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    $('mkHey').addEventListener('click', () => { if (!s.wake) return; $('mkSay').dataset.wake = '1'; send(); });
    $('mkMic').addEventListener('click', () => {
      const R = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike });
      const Ctor = R.SpeechRecognition || R.webkitSpeechRecognition;
      if (!Ctor) { alert('This browser has no speech recognition. Type what you’d say instead.'); return; }
      const r = new Ctor(); r.lang = 'en-US'; r.interimResults = false;
      r.onresult = (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => { $('mkSay').value = ev.results[0][0].transcript.replace(/^(hey|hi|okay)\s+claude[,.]?\s*/i, ''); send(); };
      r.start();
    });
    $('mkAllSet').addEventListener('click', () => { SETUP.forEach(([id]) => { s.done[id] = true; }); save(); resume(); });
    $('mkFresh').addEventListener('click', () => { s.done = {}; save(); resume(); });
    $('mkReset').addEventListener('click', () => { localStorage.removeItem(KEY); location.reload(); });
    panelPaint();
  });
  interface SpeechRecognitionLike { lang: string; interimResults: boolean; onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; start(): void }

  // a slow, believable battery: drains a little on battery, charges on power
  setInterval(() => { s.battery = Math.max(1, Math.min(100, s.battery + (s.charging ? .4 : -.15))); save(); panelPaint(); }, 30e3);
  // ---------- Browser app (BrowserView.java on the tablet) ----------
  // The tablet puts a native WebView over the Browser app's content area; here an iframe stands in at the same
  // place. Many sites refuse to load inside a frame (X-Frame-Options / CSP) and show a browser error here instead:
  // on the tablet they load. Back and forward only know the pages opened from Claude Home's address bar.
  {
    interface MockTab { frame: HTMLIFrameElement; stack: string[]; i: number }
    const btabs = new Map<string, MockTab>();
    let bshown = '', bcovered = false;
    let brect = { x: 0, y: 0, w: 0, h: 0 };
    const note = document.createElement('div');
    note.textContent = 'Mock tablet: many sites refuse to load in a frame here. On the tablet they load.';
    note.style.cssText = 'position:fixed;z-index:2147482001;padding:4px 10px;border-radius:99px;background:rgba(20,20,19,.75);color:#faf9f5;font:12px Inter,system-ui,sans-serif;pointer-events:none;display:none';
    const bemit = (e: Json) => { const h = (window as unknown as { hubBrowser?: (e: Json) => void }).hubBrowser; if (h) setTimeout(() => h(e), 0); };
    const navState = (id: string, t: MockTab) => ({ canGoBack: t.i > 0, canGoForward: t.i < t.stack.length - 1 });
    const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
    const place = () => {
      const d = devicePixelRatio || 1;
      btabs.forEach((t, id) => {
        const on = id === bshown && !bcovered;
        t.frame.style.display = on ? 'block' : 'none';
        if (on) Object.assign(t.frame.style, { left: `${brect.x / d}px`, top: `${brect.y / d}px`, width: `${brect.w / d}px`, height: `${brect.h / d}px` });
      });
      if (!note.isConnected) document.body.appendChild(note);   // this script runs before <body> exists
      const on = !!bshown && !bcovered && btabs.has(bshown);
      note.style.display = on ? 'block' : 'none';
      if (on) { note.style.left = `${brect.x / d + 10}px`; note.style.top = `${(brect.y + brect.h) / d - 32}px`; }
    };
    const load = (id: string, t: MockTab, url: string) => {
      if (!/^https?:\/\//i.test(url)) { bemit({ tab: id, type: 'blocked', url }); return; }
      bemit({ tab: id, type: 'progress', progress: 10, loading: true });
      t.frame.src = url;
    };
    const tabFor = (id: string): MockTab => {
      let t = btabs.get(id);
      if (!t) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.style.cssText = 'position:fixed;z-index:2147482000;border:0;border-radius:13px;background:#fff;display:none';
        document.body.appendChild(frame);
        const tt: MockTab = { frame, stack: [], i: -1 };
        frame.addEventListener('load', () => {
          const u = tt.stack[tt.i];
          if (!u) return;
          bemit({ tab: id, type: 'progress', progress: 100, loading: false, ...navState(id, tt) });
          bemit({ tab: id, type: 'title', title: hostOf(u) });
          bemit({ tab: id, type: 'favicon', icon: `https://${new URL(u).host}/favicon.ico` });
        });
        btabs.set(id, tt);
        t = tt;
      }
      return t;
    };
    const go = (id: string, url: string) => {
      const t = tabFor(id);
      t.stack = t.stack.slice(0, t.i + 1); t.stack.push(url); t.i = t.stack.length - 1;
      bemit({ tab: id, type: 'url', url, ...navState(id, t) });
      load(id, t, url);
    };
    const step = (id: string, by: number) => {
      const t = btabs.get(id);
      if (!t || t.i + by < 0 || t.i + by >= t.stack.length) return ok();
      t.i += by;
      const url = t.stack[t.i];
      bemit({ tab: id, type: 'url', url, ...navState(id, t) });
      t.frame.src = url;
      bemit({ tab: id, type: 'progress', progress: 10, loading: true });
      return ok();
    };
    Object.assign(HubDevice, {
      browserShow: (id: string, url: string, x: number, y: number, w: number, h: number) => {
        const fresh = !btabs.has(id);
        tabFor(id);
        bshown = id; brect = { x, y, w, h };
        if (fresh && url) go(id, url);
        place();
        return ok();
      },
      browserHide: () => { bshown = ''; place(); return ok(); },
      browserCover: (on: boolean) => { bcovered = on; place(); return ok(); },
      browserNavigate: (id: string, url: string) => { go(id, url); place(); return ok(); },
      browserBack: (id: string) => step(id, -1),
      browserForward: (id: string) => step(id, 1),
      browserReload: (id: string) => { const t = btabs.get(id); if (t && t.stack[t.i]) { bemit({ tab: id, type: 'progress', progress: 10, loading: true }); t.frame.src = t.stack[t.i]; } return ok(); },
      // the further Browser features: the PC has no WebView, so most of them only answer (no pictures, uploads or downloads here)
      browserConfigure: () => ok(),
      browserDesktop: () => ok(),
      browserFind: () => ok(),
      browserFindStep: () => ok(),
      browserFindClose: () => ok(),
      browserZoom: (id: string) => { bemit({ tab: id, type: 'zoom', percent: 100 }); return ok(); },
      browserReader: (id: string) => { bemit({ tab: id, type: 'reader', article: '' }); return ok(); },
      browserSnapshot: () => ok(),
      browserShare: (title: string, url: string) => { bemit({ tab: '', type: 'share', title, url }); return ok(); },
      browserCopy: (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); return ok(); },
      browserContextAction: (id: string, action: string, url: string, image: string) => {
        if (action === 'newtab') bemit({ tab: id, type: 'newtab', url });
        else if (action === 'share') bemit({ tab: '', type: 'share', title: '', url });
        else if (action === 'copy') { navigator.clipboard?.writeText(url).catch(() => {}); }
        else if (action === 'download' || action === 'save') window.open(action === 'save' ? image : url, '_blank', 'noopener');
        return ok();
      },
      browserOpenFile: () => { bemit({ tab: '', type: 'viewer', kind: 'none', message: 'The PC has no downloaded files to show.' }); return ok(); },
      browserShareFile: () => { bemit({ tab: '', type: 'message', message: 'Files can’t be shared from ClaudeOS yet' }); return ok(); },
      browserDownloadRemove: () => ok(),
      browserDownloadsInfo: () => '[]',
      browserDownloadsSize: () => j({ bytes: 0, count: 0 }),
      browserChooseFile: () => ok(),
      browserPermission: () => ok(),
      browserIncoming: () => '{"url":""}',
      browserOpenUrl: (url: string) => { bemit({ tab: '', type: 'newtab', url }); return ok(); },
      browserDialog: () => ok(),
      browserGoogleSignin: () => JSON.stringify({ inChrome: localStorage.getItem('mockGoogleSignin') !== 'browser' }),
      browserSetGoogleSignin: (on: boolean) => { localStorage.setItem('mockGoogleSignin', on ? 'chrome' : 'browser'); return ok(); },
      browserStop: (id: string) => { const t = btabs.get(id); if (t) { t.frame.contentWindow?.stop(); bemit({ tab: id, type: 'progress', progress: 100, loading: false, ...navState(id, t) }); } return ok(); },
      browserClose: (id: string) => { const t = btabs.get(id); if (t) { t.frame.remove(); btabs.delete(id); } if (bshown === id) bshown = ''; place(); return ok(); },
      browserClearData: () => { alert('On the tablet this clears the cookies, storage and cache of the sites you visited (ClaudeOS’s own is kept).'); return ok(); },
    });
  }
})();
