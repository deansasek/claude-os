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

Run the host with `npm run host` on any OS. It restarts the server if it stops. See `host/README.md`.

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

The tablet starts ClaudeOS from the page inside the APK, so it boots with the PC off. The PC serves the `/api/` routes and the APK updates. The tablet reads `host` and `port` from `config.json` for those. Set `host` to this PC's address on your home network before you build (for example `192.168.1.20`). `0.0.0.0` won't work there, and the build stops with a message if it's set. A web change reaches the tablet only in a new APK. To load the page from the PC instead, start the app with `pageSource=pc`: `adb shell am start -n hub.kiosk/.MainActivity --es pageSource pc`.

To install the APK on a tablet connected over USB or Wi-Fi debugging:

```
node android/build.ts --install
node android/build.ts --install --device <serial>
```

The APK is written to `android/build/claude-hub.apk`. The build signs the APK with `android/hub.keystore` and stops if that file is missing. It never makes a new key, because Android refuses an update signed with a different key. Keep a backup copy of the keystore. For a first install on a new tablet only, make the key once with the JDK's keytool:

```
tools/jdk/bin/keytool -genkeypair -keystore android/hub.keystore -alias hub -storepass <password> -keypass <password> -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Claude Hub"
```

The build reads the password from the `CLAUDEOS_KEYSTORE_PASS` environment variable. Set it on the PC before you run the build. Do not write the password in any file.

### Signing key rotation

The app's signing key was rotated with an APK Signature Scheme v3 lineage. The build signs with three files in `android/`:

- `android/hub.keystore`: the original key. The installed app was first signed with this key.
- `android/hub-new.keystore`: the new key. The build signs with this key as the current signer.
- `android/hub.lineage`: the lineage. It proves that the original key hands over to the new key, so Android 13 and later accept the update without a factory reset. The lineage holds public certificates only and is in git.

The build reads two passwords from the environment:

- `CLAUDEOS_KEYSTORE_PASS`: the password of `android/hub.keystore`.
- `CLAUDEOS_KEYSTORE_PASS_NEW`: the password of `android/hub-new.keystore`.

The build stops with a message if a file or a variable is missing. Keep `android/hub-new.keystore` and `android/hub.lineage`, and keep a backup copy of both keystores outside the repository. The keystores are not in git. If you lose `android/hub-new.keystore`, Android refuses every later update.

Release signing is planned to read the keystores from repo secrets. No release workflow does this yet. See #441.

The lineage was made once with `apksigner rotate`:

```
apksigner rotate --out android/hub.lineage --old-signer --ks android/hub.keystore --ks-key-alias hub --ks-pass env:CLAUDEOS_KEYSTORE_PASS --new-signer --ks android/hub-new.keystore --ks-key-alias hub --ks-pass env:CLAUDEOS_KEYSTORE_PASS_NEW
```

## The tablet

The tablet app starts ClaudeOS from the page in the APK. It asks the PC only for `/api/` routes and APK updates.
