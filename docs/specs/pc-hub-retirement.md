# PC hub retirement: plan

Goal: ClaudeOS works with the PC off. The PC hub becomes a sync target and a helper for the few things only it can do. Each step is one small PR.

## Where the PC is needed today

The PC hub (`src/core/server/index.ts`) serves the page itself and every `/api/<app>/` route.

| App | State on the PC | PC-only work |
| --- | --- | --- |
| Lists | `.lists.json`, `.lists-history.json` | Claude's `claudeos_lists` tools |
| Routines | `.routines.json` | Claude's routine tools, scene checks against Home Assistant |
| Calendar | `.calendar-config.json`, connector cache | ICS fetch, event notices, Google connector writes |
| Claude | sessions, history, registry | the Claude Agent SDK and the PC's Claude install, connectors |
| Launcher | `.launcher-layout.json` (tablet already keeps an offline copy) | none |
| Photos | `photos/` folder | storage space, camera uploads |
| Settings | settings backup, profile, PIN, plugins | the backup file |
| Weather, Radio, Recipes | caches, `meter-config.json` | proxy calls to public APIs (no keys) |
| Home Assistant | `.ha-config.json` with the token | the token never reaches the page |

## What can live on the tablet

- **Lists:** all of it. The data is small (12 lists, 300 items each).
- **Routines:** the routine definitions. A run already happens on the page. The Home Assistant scene check needs the token, so scene steps keep a PC call until Home Assistant moves.
- **Calendar notices:** the last events and the notice state. The ICS fetch can move to the tablet only through a native fetch (CORS), so it stays on the PC at first.
- **Launcher, Settings backup:** already partly on the tablet. Keep the PC copy as a backup.
- **Weather, Radio, Recipes:** public APIs. A native fetch can replace the proxy later.

## What stays on the PC

- Claude sessions on the PC's Claude install, and the connectors (Google Calendar, Gmail) they use.
- The Android build and signing (`android/`), and app updates the tablet pulls.
- Large photo storage.
- The settings backup target.

## Order

1. **Lists.** The tablet keeps the lists; the PC copy is a sync target. Claude's tools still write to the PC, and the tablet takes those edits in on the next sync.
2. **Routines.** The same pattern as Lists.
3. **Calendar notices.** Keep the last fetched events and the notice state on the tablet, so notices still show with the PC off. The fetch stays on the PC.
4. **Voice, Home and routine reads of Lists.** Read the tablet copy instead of `GET /api/lists/lists`.
5. **The page itself.** Ship the web bundle in the app, so the tablet starts with the PC off. Until then a cold start with the PC off shows the "Can't reach your PC" screen (`MainActivity.showOffline`).
6. **Claude sessions last.** The tablet already has its own Claude CLI chat (`apps/claude/web/native.ts`). PC sessions stay until that path covers tools and connectors.

## Sync pattern (Lists first)

- The tablet keeps the lists and a queue of changes in local storage.
- A change applies on the tablet at once and goes into the queue.
- When the PC answers, the tablet sends the queue in order through the existing routes, then takes the PC's answer. Claude's edits made on the PC in the meantime are kept, because the queued changes apply on top of them.
- A queued change the PC refuses (for example a tick on an item Claude removed) is dropped. A network failure keeps the queue.
- If the PC has no lists file, the tablet sends its whole copy.
- The Nest Hub has no tablet storage and keeps the PC-only behaviour.

## Risks

- **Data migration.** On first run the tablet copies the PC lists through `GET /api/lists/lists` once. If the PC is off on first run, the tablet waits and does not start empty over the PC data.
- **Two writers.** Claude and the tablet can both change a list while apart. The queue replays tablet changes on top of the PC state; the last change sent wins.
- **Lost tablet storage.** Local storage can be cleared (app data wipe, a new tablet). The PC copy is the backup, and the tablet copies it again on the next first run. A native file (`device.pageFileWrite`) needs a new allow-listed name in `Bridge.java`, which is a separate Android PR.
- **PC data loss.** If the PC file goes missing, the tablet restores it. If the PC file cannot be read, the tablet does not overwrite it.
- **PC-only features.** Claude's tools, Home Assistant, the calendar fetch and connectors still need the PC. With the PC off these show their own "can't reach the PC" states.
- **Backup path.** The settings backup stays on the PC. Lists and Routines keep their PC copies as backups.
- **Offline behaviour of each app:**
  - Lists: works with the PC off once the page is up. Suggestions need the PC.
  - Routines: runs, but scene, weather and calendar steps need the PC.
  - Calendar: shows the last events after step 3.
  - Claude: tablet CLI chat works; PC sessions do not.
  - Weather, Radio, Recipes, Home Assistant, Photos upload: need the PC.
  - Voice list commands: need the PC until step 4.
