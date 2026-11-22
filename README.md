# ClaudeOS

ClaudeOS is a home screen for a wall or kitchen tablet, run by a small hub server on your PC. The hub talks to Claude Code on that PC, so you can follow and answer your Claude sessions from across the room. It also shows the time, the weather, your calendar and your photos.

The hub serves a web page. Any browser on your home network can open it. An Android tablet can run it full screen as its whole interface; that part is optional and comes in a later release.

## Apps

- **Home**: a greeting, the time and an overview of the day.
- **Claude**: your Claude Code sessions; read them, reply, approve tools, start new ones.
- **Weather**: the forecast for your place.
- **Calendar**: events from calendar links (ICS) you add.
- **Photos**: a photo frame of pictures you add.
- **Lists**: shared family lists that Claude can read and change.
- **Routines**: named lists of steps, run by voice, a Home tile or Claude.
- **Home Assistant**: lights, scenes and devices, if you run Home Assistant.
- **Clock**: clock, timer, stopwatch and alarm.
- **Browser**: web tabs with a Claude side panel (tablet).
- **Camera**: photos, and "Ask Claude about this" (tablet).
- **Apps**: the launcher.
- **Settings**: profile, PINs, plugins and the rest.

## What you need

- Node.js 22.18 or newer.
- The Claude Code CLI, signed in to your Claude account.
- A PC on your home network to run the hub. Leave it on.
- Optional: an Android tablet for the full-screen ClaudeOS (later release).
- Optional: a Nest Hub or Chromecast and `catt`, to keep the page cast to it.

## Start

See [docs/SETUP.md](docs/SETUP.md). Read [docs/SECURITY.md](docs/SECURITY.md) before you put the tablet somewhere shared.

The hub code is in `hub/`. The Windows tray app that keeps it running is in `hub/host/` (see its README).
