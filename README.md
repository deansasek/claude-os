<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/logo-dark.svg">
    <img src="docs/media/logo-light.svg" alt="ClaudeOS" width="440">
  </picture>
</p>

<p align="center">
  A home screen for the kitchen wall, run by Claude Code on your PC.
</p>

<p align="center">
  <a href="docs/SETUP.md">Set up</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="https://github.com/deansasek/claude-os/pulls">Pull requests</a>
</p>

---

ClaudeOS shows the time, the weather, your calendar, your photos and your family lists. A small hub server on your PC runs the page. The hub also talks to Claude Code, so you can follow and answer your Claude sessions from across the room.

<p align="center">
  <img src="docs/media/tablet-clock.png" alt="ClaudeOS clock screen with the time, date, weather and battery" width="46%">
  &nbsp;
  <img src="docs/media/tablet-browser.png" alt="ClaudeOS Browser app with the Claude side panel open" width="46%">
</p>

## What it does

Ask by voice or tap the screen. ClaudeOS handles:

- **Home**: a greeting, the time and an overview of the day.
- **Claude**: your Claude Code sessions. Read them, reply, approve tools and start new ones.
- **Weather**: the forecast for your place.
- **Calendar**: day, week, month and year views. Reads ICS links and your Claude calendar connector.
- **Photos**: a photo frame of pictures you add.
- **Lists**: shared family lists that Claude can read and change.
- **Routines**: named lists of steps, run by voice, a Home tile or Claude.
- **Home Assistant**: lights, scenes and devices, if you run Home Assistant.
- **Clock**: clock, timer, stopwatch and alarm.
- **Browser**: web tabs with a Claude side panel (tablet).
- **Camera**: photos, and "Ask Claude about this" (tablet).
- **Apps**: the launcher.
- **Settings**: profile, PINs, plugins and the rest.

## Requirements

- Node.js 22.18 or newer.
- The Claude Code CLI, signed in to your Claude account.
- A PC on your home network to run the hub. Leave it on.
- Optional: an Android tablet to run ClaudeOS full screen. This comes in a later release.
- Optional: a Nest Hub or Chromecast and [`catt`](https://github.com/skorokithakis/catt), to keep the page cast to it.

## Get started

1. Read [docs/SETUP.md](docs/SETUP.md) to install and run the hub.
2. Read [docs/SECURITY.md](docs/SECURITY.md) before you put the tablet somewhere shared.
3. Open the hub address from any browser on your home network.

The hub code is in the repository root. The Windows tray app that keeps it running is in [`host/`](host/).

## Contribute

Every change goes through a branch and a pull request into `main`.

- Write commits in the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format, for example `feat(voice): name a timer`.
- Read [CLAUDE.md](CLAUDE.md) for the code rules, the web import rules and the no-visible-Android rule.
- Run `npm run check` and `npm test` before you open a pull request.
