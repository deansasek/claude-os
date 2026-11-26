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

## PR size

A small PR gets a faster and more careful review, hides fewer bugs, merges with fewer conflicts, and is easy to revert. Keep each PR small. Use the pr-size skill to measure and split.

- **Target:** one self-contained idea per PR. The PR includes its tests and leaves `main` working after merge. A new function or API ships with a caller in the same PR, so the reviewer can see why it exists.
- **Soft limit:** about 300 changed lines (added plus deleted) and about 10 files, measured with `git diff --stat main...HEAD`. Most PRs in this repo are under 150 lines and 5 files, for example a change to one app's files under `src/apps/<app>/`. Over 300 lines, split the PR or say in `## What` why it cannot be split. Count concepts, not only lines: 200 lines in one file can be fine, while the same 200 lines across 20 files is usually too big.
- **Do not count:** deleted files, lockfiles, and generated output (for example a build tool's output). Name these in `## What` so the reviewer can skip them.
- **Split when a PR mixes:**
  - a refactor and a feature or fix;
  - unrelated fixes;
  - a change and a large moved, renamed, or generated file;
  - code changes that need different reviewers or areas, for example `android/` and `src/apps/`.
- **Refactor first:** a refactor that changes no behavior (move, rename, extract) goes in its own PR, before the feature that needs it. A small cleanup in the lines you already touch can stay in the feature PR.
- **Too big:** a PR over the limit gets a stack of small PRs, not one long review.

### Stacked PRs

Use a stack as often as possible to keep PRs small. A stack is a chain of PRs. Each PR builds on the one below it.

This repo uses a manual chain of branches and PRs. GitHub's official `gh stack` extension (`github/gh-stack`) is not installed here. Do not use it unless the repository owner installs it.

1. Use one branch per PR, named `<type>/<kebab-name>`, for example `refactor/clock-extract-timer`, then `feat/clock-lap-times`.
2. The bottom PR targets `main`: `gh pr create --base main --head <bottom-branch> ...`.
3. Each next PR targets the branch below it, not `main`: `gh pr create --base <previous-branch> --head <branch> ...`. Start each branch from the previous branch: `git switch -c <branch> <previous-branch>`.
4. In `## Why`, give the PR's place in the stack, for example `Part 2 of 3. Depends on #120.`
5. Merge from the bottom up. Do not merge a PR until the PR below it is in `main`.
6. When the bottom PR merges, the repo deletes its branch (auto-delete is on), and GitHub normally retargets the next PR to `main`. Check with `gh pr view <n> --json baseRefName`. If the base is not `main`, retarget it: `gh pr edit <n> --base main`.
7. Rebase the rest of the stack onto `main`, so the merged commits drop out: `git fetch origin`, then `git rebase --onto origin/main <old-base> <branch>`, where `<old-base>` is your local copy of the merged branch (it keeps the old commits after GitHub deletes the remote branch). Add `--update-refs` to move the higher branches in the same rebase. Push each rebased branch with `git push --force-with-lease`.

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

## Rule: every feature is mockable

Each app ships `web/mock.ts`. It answers every `/api/<id>/` route the app calls, and every `HubDevice` method or native callback it uses. A new route, bridge method or callback lands in the same PR as its mock. `npm run check:mocks` checks this against `scripts/mock-gaps.json`, the list of gaps that exist today. Shrink the list with each mock; a new gap fails the check.

## Code rules

- The Host serves browser code only from paths matching `WEB_FILE` in `src/core/server/index.ts`: `src/main.web.ts`, `src/core/web/**`, and per app `web/**`, `view.html`, `app.css`, `manifest.ts`, `api.ts`. Any module the page imports must live there. A web import from anywhere else 404s and the whole tablet page fails to boot. Shared code used by both server and web goes in the app's `web/` folder (the server may import from it).
- After web edits, run `npm run check` (it includes `check:web`, which catches imports the Host won't serve). Don't use the built-in browser pane to verify: every action there prompts the user. Check routes with `Invoke-WebRequest`, and the tablet with read-only adb (screencap, dumpsys).
- Check hit areas: `.hit` controls get their tap area from a `::before` that needs `position: relative`; in mock mode `__dev.hitAreas()` (core/web/hit-guard.ts) warns about any that are wrong. An absolutely positioned control takes class `hit-abs`.

## Visual style

ClaudeOS follows the Anthropic style (warm, quiet, editorial, flat). Use the tokens in `public/core.css`; never write a raw hex in an app's CSS. The anthropic-style skill audits a change against these rules.

- **Colour:** warm earth tones only. Surfaces step by tone: `--bg` (ivory), `--card`, `--card-2`, with `--line` hairlines. Text is `--text`, then `--t2` to `--t5` for quieter text.
- **One accent:** `--clay` (`--clay-deep` when pressed) marks the one thing that needs attention, the spark and the critter. Primary buttons are ink (`--text` fill, `--bg` text), not clay.
- **State colours:** `--olive` (good), `--hot` and `--danger` (warning, destructive) only for state. Do not add blues or cool greys; `--blue`, `--sky` and `--track-edge` are known exceptions, not a model.
- **No pure white:** no `#fff` surfaces or text; use `--paper` or `--bg`. No gradients, glows or washes (masks that fade a scroll edge are fine).
- **Type:** `--serif` (Source Serif 4) for titles, big numbers and reading text; `--sans` (Inter) for UI chrome, buttons and labels. Weights 400 to 600. Headings get slight negative letter-spacing. There is no mono token yet: code uses the system mono stack.
- **Case:** sentence case for titles, buttons and labels. All caps only for the small `.label` heading.
- **Spacing:** a 4px grid (4, 8, 12, 16, 24, 32). Keep the page grid in `.app` (`--app-l`, `--app-body`, `--app-label-y`).
- **Shape:** 8 to 14px radius on controls, 16 to 24px on cards and sheets. Circles (50%) for dots and knobs. No new pill (99px) shapes.
- **Elevation:** flat. Show depth with a tone step and a 1px `--line` border, not a shadow. Only surfaces that float over the page (sheets, banners, the switcher, the HUD) keep a soft shadow.
- **Icons:** the hand-drawn ink pen in `src/core/web/app-icons.ts` (`ICON_RULES`); `currentColor`, one accent at most. No raster, emoji or Android icons.
- **Illustration:** the critter and the clay spark are the only illustrations. No photos or gradients as decoration (the Photos app and the photo frame show the user's own photos).
- **Motion:** calm. Use the `--dur-*` and `--ease-*` tokens, animate transform and opacity only, and honour reduced motion.
- **Tone:** the guide sets no copy rules. Write UI copy as the PR bodies: plain, short sentences.

## Facts to keep

- ClaudeOS is the tablet's **device owner** (`hub.kiosk/.AdminReceiver`) and runs in lock task mode. Don't change the Android package id `hub.kiosk`: device owner is tied to it.
- The project folder is still `Claude Home`. Run the host with `npm run host`, stop it with `npm run host:stop`, and check it with `npm run host:status`.
- The tablet starts from the page inside the APK (`pageSource` defaults to `bundle`). The PC serves only the `/api/` routes and APK updates. A web change reaches the tablet only in a new APK. `pageSource=pc` loads the page from the PC for live edits, and `auto` uses the PC page and falls back to the APK's page when the PC is down.

## Labels and statuses
Use the labels skill (`.claude/skills/labels/SKILL.md`) when you label, type, close or link an issue or pull request. It lists the area, type and AI labels, the close reasons, milestones and relationships.

