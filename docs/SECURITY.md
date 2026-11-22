# Security

ClaudeOS trusts your home network. Read this before you set it up somewhere shared.

## The trust model

- The hub serves plain HTTP, with no sign-in. Anyone on your home network who can reach the PC can open the page.
- The page can read and answer your Claude Code sessions. Claude Code then acts on your PC with your account.
- Never expose the hub to the internet. Don't forward its port on your router, and don't put it behind a public tunnel or proxy.
- Run it only on a network you trust. Guest Wi-Fi, a shared house or an office network is not one.

## Other websites

A web page from another site must not reach the hub, even one open on the tablet. Two rules stop it:

- **Origin guard.** A browser sends an `Origin` header on cross-site requests. The hub refuses (403) any request whose `Origin` is not its own. Its own origins are the configured address, `localhost` and `127.0.0.1` on its port, and the address the request was sent to when that is an IP address. A domain name never counts, so a site that points its name at your PC is still refused. Tools on the PC send no `Origin` and are not affected.
- **JSON only.** A POST must be `application/json` (or a raw upload a route asks for). Anything else gets 415. A plain HTML form cannot send JSON.

## The two PINs

- **ClaudeOS PIN.** Set in Settings → Security. 4 to 6 digits. The tablet asks for it when it wakes. Stored on the PC in `claudeos-pin.json` as a salted PBKDF2 hash. Five wrong tries give a 30-second wait. Delete the file to clear a forgotten PIN.
- **One PIN for replies too.** Once a ClaudeOS PIN is set, it also guards replies and approvals in the Claude app. An unlock lasts 10 minutes past the last action. Until a ClaudeOS PIN is set, the older `.hub-pin` file (or the `HUB_PIN` environment variable, 4 to 8 digits) still guards replies. With no PIN set at all, anyone at the screen can reply and approve.

Every reply and approval from the page goes in `logs/hub-actions.log`.

## The tablet app

The hub serves the tablet's Android app at `/apk/claude-hub.apk` to anyone on your network, once it has been built. Anyone on the network can download it, so don't build secrets into it.

## Files to keep private

These hold tokens, the PIN hashes or your own data. They are in `.gitignore`; never share them:

`config.json`, `claudeos-pin.json`, `.hub-pin`, `.ha-config.json`, `.calendar-config.json`, `profile.json`, `profile-photo.jpg`, `instructions.txt`, `hub-sessions.json`, `photos/`, `logs/`, and any keystore.

The hub never serves them: it serves only `public/` and the browser code under `src/`.
