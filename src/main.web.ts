import './core/web/mock.ts';
// Page entry point: the core shell plus the list of apps, in rail order.
import home from './apps/home/web/index.ts';
import launcher from './apps/launcher/web/index.ts';
import claude from './apps/claude/web/index.ts';
import weather from './apps/weather/web/index.ts';
import clock from './apps/clock/web/index.ts';
import browserApp from './apps/browser/web/index.ts';
import camera from './apps/camera/web/index.ts';
import photos from './apps/photos/web/index.ts';
import homeAssistant from './apps/home-assistant/web/index.ts';
import lists from './apps/lists/web/index.ts';
import radio from './apps/radio/web/index.ts';
import recipes from './apps/recipes/web/index.ts';
import calendar from './apps/calendar/web/index.ts';
import news from './apps/news/web/index.ts';
import routines from './apps/routines/web/index.ts';
import settings from './apps/settings/web/index.ts';
import { device, onTablet } from './core/web/device.ts';
import { appSettingsChanged } from './core/web/app-settings.ts';
import { initCliSignin } from './core/web/cli-signin.ts';
import { Keyboard } from './core/web/keyboard.ts';
import { mockDevice } from './core/web/dom.ts';
import { checkHitAreas } from './core/web/hit-guard.ts';
import { startHub } from './core/web/shell.ts';
import { maybeWelcome } from './core/web/welcome.ts';
import { closePreviewLock, previewLock } from './core/web/lock.ts';
import { notifications, notify, onBack, openApp, openControlCenter, closeControlCenter, sleep, wake } from './core/web/system.ts';
import type { Notice } from './core/web/system.ts';
import { voiceUi } from './core/web/voice-ui.ts';
import { initPowerSheet } from './core/web/power-sheet.ts';

// Settings controls the tablet itself, so it only appears inside the tablet app; Browser needs the tablet's own web views;
// Camera needs the tablet's camera (Photos works anywhere, it only shows what the PC has; Home Assistant too, its
// devices are switched by the PC). The first-run welcome shows once the app has mounted (startHub resolves after that),
// if the PC hasn't recorded it.
/** The power menu's Screenshot: once the sheet has closed, ClaudeOS's screen goes to the PC's Photos and a banner says so. */
function takeScreenshot(): void {
  setTimeout(() => {
    const id = `shot-${Date.now()}`;
    try {
      const r = device.screenshot(id);
      notify(r.ok ? { title: 'Screenshot saved to Photos', app: 'photos' } : { title: 'Couldn’t save the screenshot', app: 'photos' });
    } catch (e) {
      notify({ title: 'Couldn’t save the screenshot', body: (e as Error).message, app: 'photos' });
    }
  }, 450);
}

void startHub(onTablet
  ? [home, launcher, claude, weather, clock, browserApp, camera, photos, homeAssistant, lists, radio, recipes, calendar, news, routines, settings]
  : [home, launcher, claude, weather, clock, photos, homeAssistant, lists, radio, recipes, calendar, news, routines]).then(() => {
    maybeWelcome();
    initPowerSheet({ reboot: device.reboot, screenOff: device.screenOff, screenshot: takeScreenshot, onBack });   // a long press of the power button
    initCliSignin({   // the tablet's Claude CLI sign-in (Settings → Apps → Claude → Sign in)
      sendCode: device.cliSigninCode, paste: device.cliSigninClipboard, secondsLeft: device.cliSigninState, onBack,
      keyboard: o => Keyboard.open(o), keyboardClose: () => Keyboard.close(),
      notify: (title, body) => notify({ title, body: body || undefined, app: 'claude' }),
      onStatus: appSettingsChanged,
    });
    if (mockDevice) setTimeout(checkHitAreas, 400);   // dev: tap areas after boot (hit-guard.ts)
  });

// Dev only: on the PC stand-in (?device=mock) the hard-to-reach surfaces can be shown from the console, as window.__dev
// (seed, banner, sleep, wake, lock, voice, ...). Not defined on the tablet or the Nest Hub.
if (mockDevice) {
  const KEY_NOTES = 'os.notes';
  // the real os.notes is kept in sessionStorage by seed(), so it survives the reload that restore() does
  const KEEP = 'mock.dev.notesOriginal';
  (window as unknown as { __dev: unknown }).__dev = {
    /** Seed notifications for the drawer and banners: seed() keeps the real os.notes, restore() puts it back. */
    seed(): number {
      if (sessionStorage.getItem(KEEP) == null) sessionStorage.setItem(KEEP, localStorage.getItem(KEY_NOTES) ?? '\u0000none');
      const now = Date.now();
      const sample: Notice[] = [
        { title: 'Reminder: call the dentist', body: 'Tomorrow morning, before nine.', app: 'claude' },
        { title: 'Timer finished', body: 'Pasta, 10 minutes.', app: 'clock' },
        { title: 'Claude needs an OK', body: 'Send the draft to Alex? This one has a longer line of body text to check wrapping in the list.', app: 'claude' },
        { title: 'Battery low · 14%', body: 'Plug in ClaudeOS to keep it on.', app: 'settings' },
        { title: 'Note saved', app: 'notes' },
      ];
      localStorage.removeItem(KEY_NOTES);
      sample.slice().reverse().forEach(n => notify(n, true));   // appVisible: list only, no banner
      return notifications().length;
    },
    /** A banner, as a real notice shows it (app: tap opens it; no app: no chevron). */
    banner(title = 'Timer finished', body = 'Pasta, 10 minutes.', app: string | undefined = 'clock'): void { notify({ title, body, app }); },
    /** Put back the os.notes that seed() found, then reload (system.ts holds the list in memory). */
    restore(): void {
      const kept = sessionStorage.getItem(KEEP);
      if (kept != null) {
        if (kept === '\u0000none') localStorage.removeItem(KEY_NOTES); else localStorage.setItem(KEY_NOTES, kept);
        sessionStorage.removeItem(KEEP);
      }
      location.reload();
    },
    sleep, wake, openControlCenter, closeControlCenter, openApp,
    /** The PIN lock in a phase: 'pin' | 'cooldown' | 'retry' | 'checking'. Nothing is sent to the PC. */
    lock(phase: 'pin' | 'cooldown' | 'retry' | 'checking' = 'pin', secs = 25): void { previewLock(phase, secs); },
    unlock(): void { closePreviewLock(); },
    /** The power menu, as a long press of the power button opens it on the tablet. */
    power(): void { (window as unknown as { hubPower?: () => void }).hubPower?.(); },
    voice: voiceUi,
    /** Tap areas that are wrong right now (hit-guard.ts): [] when all is well. */
    hitAreas: checkHitAreas,
  };
}
