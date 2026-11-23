# ClaudeOS

ClaudeOS (formerly "Claude Home") is a full frontend running on an Android tablet. Android is only the backend: the user must never see or interact with Android.

# Repository link
The GitHub repository for ClaudeOS exists at https://github.com/deansasek/claude-os.

# Rule: branches and pull requests

Every change goes through a branch and a pull request into `main`. Do not push commits directly to `main`, unless the repository owner explicitly asks for a direct push.

# Rule: PR bodies and commits

Commits must follow Conventional Commits (https://www.conventionalcommits.org/en/v1.0.0/).

Write PR bodies in plain, direct language aligned with ASD-STE100 style:
- Use short sentences, active voice, and present or imperative tense.
- Name specific components, files, or behaviors instead of vague pronouns ("it", "this", "they").
- Keep descriptions factual and concise; omit filler and speculation.

Do not include code attribution (such as AI tool names, generator tags, or co-author lines) in PR bodies or commit messages.

Follow this exact structure:

## Why
[State the problem, requirement, or ticket reference in 1-3 short sentences.]

## What
[List the concrete changes made. Do not repeat code line-by-line.]

## Tests
[State the exact tests run or added, or write "None." with the reason.]

Issue titles and PR titles follow Conventional Commits, for example `fix(home): weather detail overflows the glance column`.

## Issue template

Use this template for every GitHub issue. Write it in the same plain style as PR bodies. Delete a section only if it does not apply (for example, Steps for a feature request). Android UI that reaches the user is a bug by default (see "Rule: no visible Android").

```markdown
## Problem
[What is wrong or missing, in 1-3 short sentences.]

## Where
- Device: [tablet / cast device (Nest Hub, Chromecast) / PC hub]
- Screen or app: [for example Home, Clock, Claude, lock screen, `src/apps/<app>`]
- Build: [commit or PR number, if known]

## Steps
1. [Step]
2. [Step]

## Expected
[What ClaudeOS should do.]

## Actual
[What ClaudeOS does. Say if Android UI shows (status bar, dialog, toast, stock keyboard, other app).]

## Evidence
[Screenshot, `adb exec-out screencap -p`, `adb shell dumpsys` lines, or hub log lines.]

## Proposed solution
[Optional. The fix or change you suggest.]
```

## Rule: no visible Android

Treat anything Android-looking that reaches the user as a bug to remove, not a style to theme. This includes:

- System UI: the status bar, notification shade, navigation bar, taskbar, gesture handles, recents, and the lock screen.
- Android dialogs, permission prompts, toasts, "isn't responding" pop-ups, share sheets, file pickers, and the app chooser.
- Other apps' UI, such as Chrome's toolbar and menus, Android Settings, and the stock volume panel.
- The stock keyboard and its look.

When building a feature:

1. Do it inside ClaudeOS (web UI or our own native views) first.
2. If Android UI truly cannot be avoided, hide it with device-owner and lock task powers, or wrap it in ClaudeOS's design. Keep it as brief as possible.
3. Say clearly in the report what Android UI is still visible and why.

The only allowed exception is the deliberate recovery path to Android Settings (`maintenance()`), so the device can't be bricked.

## Code rules

- The hub serves browser code only from paths matching `WEB_FILE` in `src/core/server/index.ts`: `src/main.web.ts`, `src/core/web/**`, and per app `web/**`, `view.html`, `app.css`, `manifest.ts`, `api.ts`. Any module the page imports must live there. A web import from anywhere else 404s and the whole tablet page fails to boot. Shared code used by both server and web goes in the app's `web/` folder (the server may import from it).
- After web edits, run `npm run check` (it includes `check:web`, which catches imports the hub won't serve). Don't use the built-in browser pane to verify: every action there prompts the user. Check routes with `Invoke-WebRequest`, and the tablet with read-only adb (screencap, dumpsys).
- Check hit areas: `.hit` controls get their tap area from a `::before` that needs `position: relative`; in mock mode `__dev.hitAreas()` (core/web/hit-guard.ts) warns about any that are wrong. An absolutely positioned control takes class `hit-abs`.

## Facts to keep

- ClaudeOS is the tablet's **device owner** (`hub.kiosk/.AdminReceiver`) and runs in lock task mode. Don't change the Android package id `hub.kiosk`: device owner is tied to it.
- The project folder is still `Claude Home` and the hub server runs from the repository root under `host/ClaudeHubHost.exe`. Restart the server with `node host/hubctl.ts restart`.
