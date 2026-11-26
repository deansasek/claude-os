# Bundled page: plan

Step 5 of the PC hub retirement (`docs/specs/pc-hub-retirement.md`). Goal: the tablet starts ClaudeOS with the PC off. Tracking issue: #299.

This is the highest-risk step. ClaudeOS is the device owner (`hub.kiosk/.AdminReceiver`) and runs in lock task mode, so a bad loader can leave the owner looking at a broken screen with no Android to fall back to. Every PR below is small, can merge alone, and can be reverted alone.

## How the tablet loads the page today

1. **The URL is fixed at build time.** `android/build.ts:35-50` (`writeHubConfig`) reads `host` and `port` from `config.json` and writes `HubConfig.DEFAULT_URL = "http://<host>:<port>/?device=tablet"` (today `http://10.0.0.246:8000/?device=tablet`). `MainActivity.java:59` copies it to `DEFAULT_URL`.
2. **A saved URL can override it.** `MainActivity.java:165-168` stores an `url` intent extra in the `hub` preferences and reads `url` from there, with `DEFAULT_URL` as the default.
3. **The WebView loads that URL.** `MainActivity.onCreate` calls `loadHub()` (`MainActivity.java:255`), which starts a 20 s boot watch and calls `web.loadUrl(url)` (`MainActivity.java:359-364`).
4. **The PC serves every file.** `src/core/server/index.ts:268-270` serves `/` as `public/index.html`, `public/core.css`, and `/src/...` files that match `WEB_FILE` (`index.ts:130-141`). A `.ts` file is stripped to plain JS on the fly with `stripTypeScriptTypes` (`index.ts:54-85`). `public/index.html:126` loads `/src/main.web.ts`, and `src/core/web/shell.ts:316-321` fetches each app's `view.html` and `app.css` from the PC.
5. **The bridge trusts the PC origin only.** `MainActivity.isServer` (`MainActivity.java:294-298`) accepts only `http` with the same host and port as `url`. `onPageStarted` and `doUpdateVisitedHistory` set `Bridge.allowed` from it (`MainActivity.java:311-321`), and `Bridge.booted` only counts when allowed (`Bridge.java:637`). Camera, microphone and location grants use the same check (`MainActivity.java:212-223`).
6. **Local storage belongs to the PC origin.** The tablet copies of Lists, Routines, calendar notices and the launcher layout (plan steps 1 to 4) live in the WebView's local storage for `http://10.0.0.246:8000`. A different origin starts with empty storage.
7. **Updates come from the PC.** `updateTick` (`MainActivity.java:285-288`) calls `Updater.check` against `serverOrigin()`, which reads `/apk/version` and `/apk/claude-hub.apk` (`Updater.java:35-51`, `index.ts:225-235`). The tablet runs `versionCode=9` today (`AndroidManifest.xml:6`, and `adb shell dumpsys package hub.kiosk`).

**What fails with the PC off.** The main-frame load fails, `onReceivedError` calls `showOffline()` (`MainActivity.java:322-327`), and the tablet shows "Can't reach your PC" (`MainActivity.java:384-392`). `probe()` asks `/api/core/version` every 5 s (`MainActivity.java:395-412`) and loads the page when the PC answers. Nothing else works until then: the tablet copies of Lists and Routines are on the device, but no page is there to show them. The 7-tap escape to `maintenance()` stays on this screen (`MainActivity.java:236-243`).

Already safe with the PC off once a page is up: `shell.ts:278-291` (`watchVersion`) and `public/index.html:36-50` treat a failed `/api/core/version` as "server restarting", and steps 1 to 4 keep app state on the tablet.

## Design choice: same origin, served from the APK

The bundled page is served **at the PC's own origin** (`http://<host>:<port>`), from APK assets, through `WebViewClient.shouldInterceptRequest`. The WebView never talks to the PC for page files when the bundle is in use, but the address bar origin stays the same.

Why not `file://` or a new `https://appassets.androidplatform.net` origin:

- **Local storage stays.** The Lists, Routines and notice copies from steps 1 to 4 stay where they are. A new origin starts empty, and the tablet could then sync an empty copy over the PC.
- **The bridge gate does not change.** `isServer`, `Bridge.allowed` and the permission grants keep working with no edit.
- **No web code changes.** Every `fetch('/api/...')` and every `/src/...` import stays relative. With the PC up, `/api/` requests still go to the PC. With the PC off, they fail as they do today during a PC restart.

Cost: if `config.json` `host` changes, the origin changes too, the same as today. A later step can move to a fixed origin with a planned storage copy; this plan does not.

## The PRs

Five PRs, in order. PR 1 to 2 change no behaviour. PR 3 adds the loader behind a flag that is off. PR 4 and PR 5 each flip one default. Each PR has its own issue.

| # | Title | Touches Android | Owner device check before merge |
| --- | --- | --- | --- |
| 1 | `build(page): write the web page as a static bundle` | No | No |
| 2 | `build(android): put the page bundle in the APK assets` | `android/build.ts` only | Yes (light) |
| 3 | `feat(kiosk): serve the bundled page behind an off-by-default flag` | Yes (Java) | Yes |
| 4 | `feat(kiosk): fall back to the bundled page when the PC is off` | Yes (Java) | Yes |
| 5 | `feat(kiosk): start from the bundled page first` | Yes (Java) | Yes |

### PR 1: write the web page as a static bundle

- **Changes:** a new `scripts/build-page.ts` and an `npm run build:page` script in `package.json`. The script copies `public/**` and every `src/` file that matches `WEB_FILE` into an output folder (default `build/page/`, added to `.gitignore`), strips `.ts` with `stripTypeScriptTypes` (the same call as `serveStatic`), and writes `page-manifest.json` with each path, its size, a SHA-1, and one bundle version (a hash of all files). It reads `WEB_FILE` from `src/core/server/index.ts`, as `scripts/check-web-imports.ts` does, so the two cannot drift.
- **Test:** `test/page-bundle.test.ts` (added to `npm test`): the bundle holds `index.html`, `core.css`, `src/main.web.ts` and every module in the import graph that `check-web-imports.ts` walks; it holds no path with a `server` folder; a stripped `.ts` file equals the server's output for the same file. Plus `npm run check`.
- **Rollback:** revert. Nothing reads the bundle yet.
- **Device check:** no. No Android change.

### PR 2: put the page bundle in the APK assets

- **Changes:** `android/build.ts` runs the bundler before step 4 and stages its output under `assets/page/` in `stage-rest`, next to the existing assets loop (`build.ts:128-139`). The build fails if the bundle is missing `index.html` or `page-manifest.json`. No Java change, no signing change, no `versionCode` change in this PR.
- **Test:** build the APK, then list it with `jar tf android/build/claude-hub.apk` and confirm `assets/page/index.html`, `assets/page/page-manifest.json` and `assets/page/src/main.web.ts`. Record the APK size before and after in `## Tests`. `npm run check`.
- **Rollback:** revert. Nothing reads `assets/page/` yet.
- **Device check:** yes, light. The APK changes, so the owner installs it through the normal update path and confirms a normal boot with the PC on.

### PR 3: serve the bundled page behind an off-by-default flag

- **Changes:**
  - A new `android/src/hub/kiosk/PageAssets.java`: maps a request path to a file under `assets/page/` with the right MIME type (from `page-manifest.json`), refuses `..`, and refuses `/api/` and `/apk/`.
  - `MainActivity.java`: a `pageSource` preference in `hub` (`pc`, `auto`, `bundle`; default `pc`), set by a `pageSource` intent extra in the same way as `url` (`MainActivity.java:166-167`). In `Client.shouldInterceptRequest`, when the request is a GET to `isServer` and the active source is the bundle, answer from `PageAssets`. With the PC known to be down, answer `/api/` with a fast 503 so the page does not wait on LAN timeouts.
  - In this PR `auto` behaves as `pc`. Only an explicit `pageSource=bundle` uses the bundle. The owner can test the loader with the PC on and off before any default changes.
  - No change to `isServer`, `Bridge`, `Updater`, `lockdown()` or `maintenance()`.
- **Test:** `npm run check`; build the APK. On the device (owner): with `pageSource=bundle`, boot with the PC on and with the PC off; confirm the page boots, the bridge works (voice, brightness), Lists and Routines show their tablet copies, and the 7-tap escape still opens `maintenance()` from the offline screen. Then set `pageSource=pc` and confirm today's behaviour. Read-only evidence: `adb logcat -s HubKiosk` lines and `adb exec-out screencap -p`.
- **Rollback:** set `pageSource=pc` (the default, so a fresh install is already safe), or revert. `updateTick` still runs from `onCreate` whatever the page does, so a fixed APK reaches the tablet through the PC.
- **Device check:** yes.

### PR 4: fall back to the bundled page when the PC is off

- **Changes:** `MainActivity.java`: the default `pageSource` becomes `auto`. In `auto`, the tablet loads from the PC as today. When the main-frame load fails (`onReceivedError`, or a 5xx in `onReceivedHttpError`), it switches to the bundle and calls `loadHub()` instead of `showOffline()`. `showOffline()` stays for an APK with no bundle. `probe()` keeps running; when the PC answers, the tablet stays on the bundle until the next reload, so the page does not jump under the user.
- **Test:** `npm run check`; build the APK. On the device: cold start (reboot) with the PC off shows ClaudeOS, not "Can't reach your PC"; cold start with the PC on loads from the PC (an edit on the PC still reloads the page); turn the PC off while the page is up and confirm nothing reloads.
- **Rollback:** set `pageSource=pc` on the device, or revert to make `pc` the default again.
- **Device check:** yes.

### PR 5: start from the bundled page first

- **Changes:** `MainActivity.java`: the default `pageSource` becomes `bundle`. The tablet loads the bundled page at once, with no wait on the PC. The PC is used only for `/api/` routes and `Updater`. `showOffline()` shows only when the APK has no bundle. A new web build reaches the tablet with a new APK. `pageSource=pc` stays as the developer path for live edits on the PC. Update `docs/specs/pc-hub-retirement.md` step 5 and `CLAUDE.md` "Code rules" (`npm run check` is not enough to see a web change on the tablet in `bundle` mode).
- **Test:** `npm run check`; build the APK. On the device: cold start with the PC off and on; time to `Bridge.booted` from `adb logcat` is not longer than with `pc`; Lists, Routines and calendar notices work with the PC off; an APK update from the PC still installs.
- **Rollback:** set `pageSource=auto` or `pc` on the device, or revert to the PR 4 default.
- **Device check:** yes.

## Not in this plan

- Web fonts. `public/index.html:7-9` loads Inter and Source Serif 4 from Google Fonts. With no internet the page falls back to the system fonts. Bundling the fonts is a separate style PR.
- A fixed origin that does not depend on the PC's address.
- The native fetch for Weather, Radio, Recipes and ICS (item 5 of `pc-hub-replacement.md` section 4).
- APK serving from somewhere other than the PC.

## Risks

- **Boot path break (biggest).** A Java bug in the loader can stop the page from booting on a device in lock task mode. Mitigations: the flag is off in PR 3; each default flips in its own PR after a device check; `updateTick`, `lockdown()` and the 7-tap `maintenance()` path do not depend on the page; a bad bundle falls back to `showOffline()` and its 7-tap escape.
- **Stale page.** In `bundle` mode the page is as old as the APK. Edits on the PC do not show until a new APK installs. `pageSource=pc` keeps the live path for development.
- **Origin change.** If `config.json` `host` changes, local storage is lost, as today. The plan keeps the origin, so it adds no new storage loss.
- **APK size.** The bundle adds the web files (text, compressed in the APK). PR 2 records the size change.
- **Version mismatch.** With the PC on, a bundled page can call `/api/` routes from a newer or older PC. Routes in this repo change with the page in one PR; in `bundle` mode a route change must stay backward compatible until the APK updates.
