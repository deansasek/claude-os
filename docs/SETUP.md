# Set up ClaudeOS

These steps run the hub on your PC and open ClaudeOS in a browser.

## 1. Install the tools

1. Install Node.js 22.18 or newer from nodejs.org.
2. Install the Claude Code CLI and sign in. Run `claude` once and follow the prompts.

## 2. Install the hub

Open a terminal in the project folder (the one with `package.json`), then:

```
npm install
npm run setup
```

These steps work on Windows, macOS and Linux.

`npm run setup` asks for three things and writes `config.json`:

- **Address**: this PC's address on your home network, such as `192.168.1.20`. `0.0.0.0` listens on every address.
- **Port**: 8000 unless something else uses it.
- **Cast device**: optional. A Nest Hub or Chromecast address to keep the page cast to. Needs `catt` on your PATH.

It never replaces an existing `config.json` without asking. You can also copy `config.example.json` to `config.json` and edit it.

## 3. Start it

```
npm start
```

The hub prints the address it serves. Open `http://<your PC's address>:8000` in a browser on your home network.

On Windows, `host/ClaudeHubHost.exe` can run the hub from the tray and restart it if it stops. See `host/README.md`. The tray app is Windows only. macOS and Linux run the hub with `npm start`.

## 4. Set a PIN

Open Settings → Security and set the ClaudeOS PIN. Anyone on your home network can open the page, so do this first. See [SECURITY.md](SECURITY.md).

## Config

`config.json` keys:

| Key | Default | Meaning |
|---|---|---|
| `host` | `0.0.0.0` | Address to listen on. |
| `port` | `8000` | Port to listen on. |
| `cast` | none | Nest Hub or Chromecast address to keep the page cast to. |
| `cattPath` | `catt` | The `catt` command used for casting. |
| `theme` | `time` | Theme of the cast page. |
| `projectsDir` | `~/.claude/projects` | Where Claude Code keeps its session logs. |
| `ownerName` | empty | Your name. Not used yet. |

Command-line arguments win over `config.json`: `--host`, `--port`, `--cast`, `--catt`, `--theme`, `--projects`. An empty or missing key takes the default.

## Build the tablet app (optional)

The tablet app builds on Windows, macOS and Linux. It needs no Android Studio and no Gradle. The scripts download the JDK and Android SDK into `tools/`, inside the project folder.

```
node android/setup-tools.ts
node android/setup-voice.ts
node android/build.ts
```

`setup-tools.ts` accepts the Android SDK licence for you. Re-running any step is safe: finished parts are skipped.

To install the APK on a tablet connected over USB or Wi-Fi debugging:

```
node android/build.ts --install
node android/build.ts --install --device <serial>
```

The APK is written to `android/build/claude-hub.apk`. The signing key `android/hub.keystore` is made on the first build. Keep it: an update must be signed with the same key.

## The tablet

The full-screen Android tablet is optional and comes in a later release. Until then, open the page in the tablet's browser.
