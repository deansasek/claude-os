# PC hub replacement: research

Goal: replace the custom PC hub (`src/core/server`, `host/ClaudeHubHost.exe`) with a Claude Code extension that runs on Windows and macOS. The tablet takes over everything that does not need the PC. This builds on `docs/specs/pc-hub-retirement.md` (the plan) and tracks under issue #299 and the milestone "Deprecate the PC app".

## 1. What the PC hub does today

The hub is one Node process (`src/main.server.ts`) that loads 11 server apps into `startServer` (`src/core/server/index.ts`). Every route is `/api/<app>/<path>`. The hub also serves the page itself (`resolveStatic`, `WEB_FILE`), the tablet's APK (`GET /apk/version`, `GET /apk/claude-hub.apk`, read by `android/src/hub/kiosk/Updater.java`), and keeps the Nest Hub cast alive through `catt`. The tablet starts at `HubConfig.DEFAULT_URL` (the PC's address); with the PC off, `MainActivity.showOffline` shows "Can't reach your PC".

`host/ClaudeHubHost.exe` is a Windows-only C# tray app (`host/README.md`): it runs the server, restarts it on a crash, keeps `host/logs/server.log`, and has a loopback control API (`hubctl`). It is a process supervisor only. It holds no app logic.

### 1a. Things only the PC can do

| Feature | Routes or modules | Why it needs the PC |
| --- | --- | --- |
| Claude Code sessions on the PC: live list, usage, history, transcripts, images | `GET /api/claude/usage`, `session`, `history`, `image`, `projects`, `models`; `claude/server/sessions.ts`, `usage.ts`, `history.ts` (read `~/.claude/projects/**/*.jsonl` through `paths.ts PROJECTS`) | The transcripts are files on the PC. |
| Reply to, start, stop, fork, pin, archive, delete PC sessions | `POST /api/claude/reply`, `new`, `stop`, `approve`, `fork`, `pin`, `archive`, `delete`; `claude/server/turns.ts` (Claude Agent SDK `query`), `manage.ts`, `hubsessions.ts` | The session runs in a PC folder with the PC's tools and files. |
| Drive a session already open in the PC's CLI or desktop app | `POST /api/claude/pc/wait`, `pc/permission`; `claude/server/pclink.ts`, `pcbridge.ts`, `scripts/claude-os-pc-hook.ts` (Stop `asyncRewake` and PermissionRequest hooks) | The session is a PC process. |
| ClaudeOS tools in PC sessions | in-process MCP servers added in `turns.ts:379`: `claudeos_browser`, `claudeos_tablet` (relay through `POST browser/next`, `browser/result`), `claudeos_lists`, `claudeos_routines`, `claudeos_calendar`, `claudeos_weather`, `claudeos_ha` (`<app>/server/tools.ts`) | Claude runs on the PC; the tablet tools come back through a long-poll relay. |
| The PC's Claude connectors (Google Calendar, Gmail) | `GET /api/calendar/connector`; `calendar/server/connector.ts` | The connector sign-in lives in the PC's Claude account. |
| Plugins and MCP settings of the PC's Claude Code | `GET/POST /api/settings/plugins*`, `plugins/market*`; `settings/server/plugins.ts`, `market.ts` | They edit and probe the PC's `~/.claude`. |
| Home Assistant with the token | all `/api/home-assistant/*`; `home-assistant/server/ha.ts` (token in `.ha-config.json`) | Design rule: the token never reaches the page. Not a hard PC need (see 1b). |
| Large photo storage | `/api/photos/upload`, `list`, `file`, `thumb`, `delete`; `photos/server/store.ts` (`photos/YYYY-MM-DD/`) | Disk space. |
| Android build, signing, APK serving | `/apk/*` in `core/server/index.ts`, `android/` | The toolchain and the signing key are on the PC. |
| Nest Hub cast keep-alive | `startServer` cast loop (`catt`) | The Nest Hub has no ClaudeOS app; something must re-cast. |
| Windows tray host | `host/` | Process supervision on Windows only. |

### 1b. Things the tablet can do itself

The tablet already runs Claude: `android/src/hub/kiosk/cli/ClaudeCli.java` downloads `@anthropic-ai/claude-code-linux-arm64-musl`, signs in with `claude auth login`, and runs one `claude -p --input-format stream-json` per chat. The page side is `src/apps/claude/web/native.ts`. Note: the native chat runs with `--tools=` and no MCP config (`ClaudeCli.java:454`), so today it has no ClaudeOS tools.

| Feature | Routes or modules today | What the tablet needs |
| --- | --- | --- |
| Lists | `/api/lists/*`; `lists/server/store.ts` | Done in part: `lists/web/local.ts` keeps the tablet copy and a queue (#307, #308). |
| Routines | `/api/routines/list`, `save`, `delete`; `routines/server/store.ts` | Same pattern as Lists. A run already happens on the tablet (`routines/web/run.ts`). |
| Settings backup | `GET/POST /api/settings/backup`; `settings/server/backup.ts` | Keep in tablet storage; the PC copy becomes optional. |
| Profile, instructions, welcome | `/api/settings/profile`, `photo`, `instructions`, `welcome`; `settings/server/profile.ts`, `instructions.ts` | Local storage plus a page file. "Your Claude" instructions can go into the native chat's system prompt. |
| ClaudeOS PIN | `/api/settings/pin*`; `settings/server/pin.ts`, `claude/server/guard.ts` | Hash and cooldown on the tablet (a native file, so a page reload cannot reset the count). Today a PC-off tablet stays locked (`host/README.md`), which is the worst case. |
| Launcher layout | `/api/launcher/layout`; `launcher/server/layout.ts` | Already has a tablet copy; the PC copy becomes a backup. |
| Weather | `/api/weather/*`; `weather/server/weather.ts` (Open-Meteo, no key) | A direct fetch, or a native fetch if CORS blocks it. |
| Radio, Recipes | `/api/radio/*`, `/api/recipes/*` (Radio Browser, TheMealDB, no key) | Same as Weather. |
| Calendar by ICS address | `/api/calendar/status`, `config`, `events`, `range`; `calendar/server/ics.ts`, `calendar.ts` | A native fetch (CORS) plus the ICS parser in a `web/` module. |
| Home Assistant | `/api/home-assistant/*` | The token in an app-private native file, calls through a native fetch. The page still never sees the token. |
| Claude chat with ClaudeOS tools | `claudeos_lists`, `claudeos_routines`, `claudeos_tablet`, `claudeos_weather` | A tablet-side MCP endpoint for the tablet CLI (see section 3). |
| The page itself | `resolveStatic`, `WEB_FILE` | Ship the web bundle in the APK (plan step 5). |

## 2. The three replacement shapes

Sources: the hooks reference (code.claude.com/docs/en/hooks), the plugin manifest reference (code.claude.com/docs/en/plugins-reference), and channels (code.claude.com/docs/en/channels), read on 2026-11-24.

### Claude Code hook

- **Events:** 33, including `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Notification`, `SubagentStart`, `SubagentStop`, `PreCompact`.
- **Types:** `command`, `http` (POSTs the event JSON to a URL), `mcp_tool`, `prompt`, `agent`. Command hooks may be `async` or `asyncRewake` (exit 2 wakes Claude with the hook's stderr). `scripts/claude-os-pc-hook.ts` already uses `asyncRewake`.
- **Can:** see each event, block or decide a permission, push status out (an `http` hook can POST to the tablet).
- **Cannot:** serve HTTP or hold state between events. Each call is one process (or one POST) per event. Hooks run only while a Claude Code session runs.
- **Platforms:** Windows (Git Bash, or PowerShell when Git Bash is missing), macOS, Linux. A Node script in exec form works the same on both.
- **Fit:** session events (turn finished, permission asked) pushed to the tablet. Not a server.

### MCP server

- **Exposes:** tools (and resources, prompts). Claude calls a tool during a turn; nothing runs between turns unless the server keeps its own process alive.
- **Transports:** `stdio` (Claude Code spawns the process per session), or `http`/`sse`/`ws` (Claude Code connects to a URL that something else runs).
- **Channels (research preview):** an MCP server declared as a channel can push messages into a running session and relay permission prompts to a remote approver. Requires `--channels` at launch, a claude.ai login or Console key, and, for a custom channel during the preview, `--dangerously-load-development-channels` (custom plugins are not on the allowlist).
- **Can:** give a PC session ClaudeOS tools (lists, timers, notices) by calling the tablet. A stdio server can also open its own HTTP port for the tablet while the session lives.
- **Cannot:** be reached by the tablet over stdio. The tablet needs an HTTP surface. A stdio server's HTTP port dies with its session, so it cannot be the always-on tablet backend.
- **Fit:** ClaudeOS tools for PC sessions, and (as a channel) the tablet-to-session reply path that `pclink.ts` does today.

### Claude Code plugin

- **Bundles:** skills, commands, agents, hooks (`hooks/hooks.json`), MCP servers (`.mcp.json`), LSP servers, output styles, workflows, `bin/` executables, `userConfig` (prompted values, `sensitive` ones go to the OS credential store), `channels`, and `experimental.monitors` (a persistent background command per session; monitors do not start with `-p`).
- **Install:** `/plugin marketplace add <owner/repo>` then `/plugin install <name>@<marketplace>`, or `claude plugin install`. The repo can be its own marketplace. State goes in `${CLAUDE_PLUGIN_DATA}`, which survives updates.
- **Can:** ship the hook, the MCP server and a setup skill as one cross-platform install, with no edits to `~/.claude/settings.json` by our own script.
- **Cannot:** run anything when no Claude Code session is open. No plugin component is a system service.
- **Fit:** the packaging for everything that stays on the PC.

### What the tablet needs to talk to each

| PC feature | Shape | Tablet link |
| --- | --- | --- |
| Tablet sees PC sessions start, finish, ask | Hooks (`SessionStart`, `Stop`, `PermissionRequest`, `Notification`) as `http` hooks | The tablet runs a small HTTP endpoint on the LAN (Java, like `LoopbackProxy`) with a paired key. |
| Tablet replies to and approves a PC session | MCP channel with permission relay (when it leaves preview); until then the current `asyncRewake` Stop hook plus `PermissionRequest` hook | The hook or channel polls the tablet endpoint, or holds a WebSocket to it. Direction: PC to tablet, so the tablet needs no PC address. |
| ClaudeOS tools in PC sessions | Plugin MCP server (stdio, Node) | The server calls the tablet endpoint (lists, timers, notices, browser jobs). |
| PC transcripts and history on the tablet | Not a fit for any shape: they are files, read between sessions | Option A: Remote Control (claude.ai) instead of a custom view. Option B: a `SessionEnd` hook uploads a short summary to the tablet. A full history view needs an always-on reader. |
| Starting a new PC session from the tablet | Not a fit: needs a process that runs when no session runs | Remote Control or claude.ai cloud sessions; or keep a tiny launcher. |
| Calendar connector | Not needed on the PC: the tablet CLI signs in to the same claude.ai account | The native chat (or a one-shot `claude -p`) on the tablet uses the connector. Unverified, see section 5. |

## 3. Recommended architecture

The tablet becomes the hub. The PC becomes an optional Claude Code plugin.

**On the tablet (the hub):**
- The page ships in the APK and runs with no PC (plan step 5).
- App state (lists, routines, settings, PIN, launcher, calendar notices) lives on the tablet.
- A native fetch in `Bridge.java` (an allow-list of hosts) replaces the PC proxies for Weather, Radio, Recipes, ICS and Home Assistant.
- A small tablet HTTP service (Java, LAN-bound, paired key) exposes two things: a ClaudeOS MCP endpoint over streamable HTTP for the tablet's own CLI (on loopback) and for PC sessions (on the LAN), and an event inbox for PC hooks.
- The tablet CLI chat gets ClaudeOS tools through `--mcp-config` pointing at that loopback endpoint.

**On the PC (a plugin, `claudeos-pc` in this repo's own marketplace):**
- `hooks/hooks.json`: `SessionStart`, `Stop`, `PermissionRequest`, `Notification` as `http` hooks to the tablet, and the existing `asyncRewake` reply hook, moved from `scripts/claude-os-pc-hook.ts`.
- `.mcp.json`: points PC sessions at the tablet's MCP endpoint (http transport, no PC process), so `claudeos_lists` and the tablet tools work from any PC session, not only hub-run ones.
- `userConfig`: the tablet address and the pairing key (`sensitive`).
- A `pair` skill that walks the user through pairing.
- Later: a channel server for replies and approvals, once channels leave research preview and accept a non-allowlisted plugin without the development flag.

**What goes:** `src/core/server`, every `<app>/server/index.ts` route, `host/ClaudeHubHost.exe`, `hubctl`, `.pc-bridge.json`, and the `pc/*` long-poll routes.

**What stays on the PC for now:** photo storage, the Android build and APK serving (a developer task; can move to a GitHub release), and the Nest Hub cast keep-alive.

**The Windows tray host:** remove it once the tablet serves the page and the state. A plugin cannot supervise a server, so any feature that still needs an always-on PC process (photos, Nest Hub cast, APK serving) either moves or keeps a much smaller cross-platform process. The recommendation is to move them (photos to tablet storage with an optional backup, APK to GitHub releases, Nest Hub cast from the tablet with a Cast sender), so nothing on the PC runs outside Claude Code.

**The smallest viable step** that starts removing the custom PC server: the tablet serves its own page and owns Lists and Routines (plan steps 1, 2, 5). After that the PC hub is optional for daily use. The plugin replaces `scripts/claude-os-pc-hook.ts` next, then the tablet MCP endpoint replaces the in-process MCP servers.

**Order:**
1. Finish plan steps 1 to 5 (state on the tablet, page in the APK).
2. Native fetch in `Bridge.java`; move Weather, Radio, Recipes, ICS.
3. PIN, settings backup, profile on the tablet.
4. Tablet HTTP service with the ClaudeOS MCP endpoint; the tablet CLI chat gets tools.
5. The `claudeos-pc` plugin: hooks plus `.mcp.json` to the tablet; retire `scripts/claude-os-pc-hook.ts`.
6. Home Assistant on the tablet.
7. Decide the PC session view: Remote Control, a summary hook, or keep a read-only reader.
8. Remove `src/core/server` and `host/`.

## 4. Phasing the PC features out

Each item is one issue and, unless noted, one PR. Size: S under 150 changed lines, M 150 to 300, L needs a stack.

| # | Item | Risk | Size |
| --- | --- | --- | --- |
| 1 | Routines on the tablet with a PC sync target (plan step 2) | Low: copies the Lists pattern | M |
| 2 | Calendar notice state on the tablet (plan step 3) | Low | S |
| 3 | Voice, Home and routine reads of Lists use the tablet copy (plan step 4) | Low | S |
| 4 | Ship the page in the APK; load from `file://` or an asset loader, fall back to the PC (plan step 5) | High: boot path, every `fetch('/api/...')` needs a base, offline screen changes | L (stack: Android loader, then web base URL, then build step) |
| 5 | `Bridge.java` native fetch with a host allow-list | Medium: a new network surface in the page | M (Android only) |
| 6 | Weather, Radio, Recipes call their APIs through item 5 | Low | S each |
| 7 | PIN on the tablet (hash and cooldown in a native page file) | Medium: security; a lost file must not unlock | M |
| 8 | Settings backup and profile on the tablet; PC copy optional | Low | S |
| 9 | ICS calendar fetch and parse on the tablet | Medium: move `ics.ts` to `web/`, timezone tests | M |
| 10 | Tablet MCP endpoint (Java, loopback) with lists and timer tools; native chat passes `--mcp-config` | Medium: unverified that the arm64 musl CLI reaches a loopback HTTP MCP server (see section 5) | L (stack: Java service, tools, chat flag) |
| 11 | `claudeos-pc` plugin replacing `scripts/claude-os-pc-hook.ts` (same hooks, packaged) | Low | M |
| 12 | Plugin `.mcp.json` points PC sessions at the tablet endpoint over the LAN with a paired key | Medium: LAN auth | M |
| 13 | Home Assistant on the tablet (token in a native file, native fetch) | Medium: the token's new home | L |

Must stay on the PC for now:
- Live PC sessions: reply, approve, start, stop (hooks and, later, a channel; or Remote Control).
- PC transcript history and images (files on the PC).
- Plugin and MCP settings of the PC's Claude Code (`settings/server/plugins.ts`, `market.ts`).
- Photo storage, until the tablet has room or a backup target.
- Android build, signing and APK serving.
- Nest Hub cast keep-alive (the Nest Hub also has no tablet storage, so it keeps the PC-only behaviour).

Top three to do now: items 1 (Routines), 4 (page in the APK), 5 (native fetch). Item 4 is the one that ends "Can't reach your PC" on a cold start.

## 5. Risks and unknowns

- **Channels are a research preview.** A custom ClaudeOS channel needs `--dangerously-load-development-channels`, and the flag and protocol may change. The reply path keeps the `asyncRewake` hook until then.
- **Remote Control** may replace the custom PC session view, but it is claude.ai UI inside the ClaudeOS Browser, not ClaudeOS's own design. Not checked against "Rule: no visible Android" and the visual style.
- **Connectors on the tablet CLI.** Not verified that the tablet's `claude -p` loads the claude.ai Google Calendar connector for the same account. `ClaudeCli.java` runs chats with `--tools=` today.
- **Loopback MCP from the tablet CLI.** Not verified that the musl CLI connects to an HTTP MCP server on `127.0.0.1`. `NO_PROXY` includes it (`ClaudeCli.java:98`), so it should bypass `LoopbackProxy`.
- **CORS of the public APIs.** Not verified whether Open-Meteo, Radio Browser and TheMealDB allow a direct page fetch from the tablet's origin. A native fetch avoids the question.
- **Hook process lifetime.** The docs describe hooks per event; a long-lived hook-spawned daemon is allowed but not supported as a server. Not a basis for the tablet backend.
- **Monitors** (`experimental.monitors`) run a persistent command per session and do not start with `-p`. Not a system service.
- **Two writers** stay a risk for every state that Claude on the PC also changes (lists, routines), as in the plan.
- **Tablet storage loss** (app data wipe) loses state that no longer has a PC copy. Keep an optional backup target.
- **LAN auth.** The tablet endpoint for PC sessions needs pairing and a key; today `browser.ts` notes that without a PIN any LAN device can poll jobs.
- **Nest Hub.** No answer yet for casting from the tablet; needs its own research.
- **Plugin name.** `claude plugin validate` refuses a name that starts with `claude-` (so not `claude-os`) and warns on "claude" as a whole word. `claudeos-pc` avoids both; not yet run through the validator.
