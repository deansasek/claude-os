# ClaudeOS Host

A small Windows tray app that runs the hub server (`npm start` equivalent), restarts it if it crashes, keeps its logs, and exposes a loopback-only control API.

## Build

Run from the `hub` folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\host\build.ps1
```

Uses the .NET Framework `csc.exe` that ships with Windows; no installs. Output: `host/ClaudeHubHost.exe`.

## Run

```powershell
& .\host\ClaudeHubHost.exe
```

The tray icon's tooltip shows the state. Menu: Open hub in browser, Start, Stop, Restart, Open log, Open hub folder, Start with Windows, Exit (stops the server, then exits). A second launch shows a balloon and exits.

Start with Windows: tick the menu item. It writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ClaudeHubHost` for the current user only. Untick to remove.

## Config: `host.config.json`

Created with defaults if missing. Runs the same command as the live server.

| Field | Meaning |
|---|---|
| `nodePath` | Path to node.exe. Empty = find `node.exe` on PATH. |
| `args` | Arguments passed to node. Default runs `src\main.server.ts --port 8000 ...`; the host and cast device come from `config.json`. |
| `workingDir` | Child working directory. Empty = the hub folder. |
| `apiPort` | Control API port on 127.0.0.1. Default 47811. |
| `autostart` | Start the server when the tray app launches. |
| `cattPath` | Optional path to `catt.exe`, appended as `--catt <path>` only when set. Empty by default (the server then uses `catt` from PATH). |
| `serverUrl` | Optional. Empty = derived from `--host`/`--port` in `args` (`0.0.0.0` becomes `127.0.0.1`). Used by "Open hub" and `/health`. |

Use another config file with `ClaudeHubHost.exe --config <path>`.

Logs: `host/logs/server.log` (5 MB cap, one `server.log.1` backup). Host events are tagged `[host]`.

Crash restarts use backoff of 1, 2, 5, 10, then 30 seconds. The backoff resets after 60 seconds of healthy running. The child is killed as a tree on stop, restart and exit, and a job object also kills it if the tray process dies.

## Control API

Bound to `http://127.0.0.1:<apiPort>/` only. Every request needs `Authorization: Bearer <token>`, otherwise 401.

The token is created on first run at `%APPDATA%\ClaudeHubHost\token`, readable by the current user only. `%APPDATA%\ClaudeHubHost\api.json` holds the base URL and the token path (not the token).

| Method and path | Result |
|---|---|
| `GET /status` | `state` (Running/Stopped/Restarting), `pid`, `uptimeSeconds`, `restartCount`, `lastExitCode`, `nextRestartInSeconds`, `serverUrl`, `lastError` |
| `POST /start`, `POST /stop`, `POST /restart` | Status after the action |
| `GET /logs?lines=N` | Last N lines (default 100, max 500) from the in-memory ring buffer |
| `GET /health` | `healthy` (the hub URL answered at all), `httpStatus`, or `error` |

## hubctl

```powershell
$hub = ".\host\hubctl.ps1"   # from the hub folder
powershell -NoProfile -ExecutionPolicy Bypass -File $hub status
powershell -NoProfile -ExecutionPolicy Bypass -File $hub restart
powershell -NoProfile -ExecutionPolicy Bypass -File $hub stop
powershell -NoProfile -ExecutionPolicy Bypass -File $hub start
powershell -NoProfile -ExecutionPolicy Bypass -File $hub logs -Lines 50
powershell -NoProfile -ExecutionPolicy Bypass -File $hub health
```

`health` exits 2 when the hub server does not answer.

## ClaudeOS PIN lock

Settings → Security → "PIN to unlock" sets a 4 to 6 digit PIN that the tablet asks for when it wakes from the ambient screen. The PIN is kept on this PC in `claudeos-pin.json` as a salted hash, never as the PIN itself. The file is read on every check, so no restart is needed to clear it. Five wrong tries give a 30-second wait.

This is separate from the older Claude app PIN in `.hub-pin` (read by `src\apps\claude\server\guard.ts`), which only guards replies and approvals in the Claude app.

### If you forget the ClaudeOS PIN

Run this on the PC from the `hub` folder (the hub must be running, since the tablet checks the PIN with it):

```powershell
Remove-Item -LiteralPath .\claudeos-pin.json -Force
```

The lock goes at once: the next time the tablet wakes it opens without asking. Set a new PIN from Settings → Security when you like. If the tablet says it can't reach the PC, it stays locked until the PC answers, so start the hub first.
