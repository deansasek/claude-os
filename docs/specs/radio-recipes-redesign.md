# Radio and Recipes redesign: build spec

Base: `main` after #228 (a8ffcce). Each PR is small, goes through a branch, and runs `npm run check` and `npm test`.

## Decisions

1. #228 is merged. Keep it.
2. Station lists open in the browse column. The hero stays.
3. Radio uses the device media volume.
4. Drawer next and previous step through Favourites.
5. Countries show names only.
6. "Want to buy" is one toggle for new picks.
7. Staples do not count as missing.
8. The picker holds at most 8 ingredients.
9. "What do you have" is a section below Saved.
10. Use the free TheMealDB key `1` with V1 `filter.php?i=` only. No premium V2 endpoints.

## Radio

**Layout.** Three zones in `src/apps/radio/view.html`:
- Hero (top left, wide): art, station name, stream title, heart, previous, play/pause, next, Sleep, Stop, volume.
- Strip (below the hero): one row with Favourites, then Recently played. The row scrolls sideways.
- Browse column (right, full height): search, the four tabs, then the list or the station page.

**Behaviour.**
- A tab, a genre, a country or a search fills the browse column. Back returns one level. The hero never moves.
- The volume slider calls `device.setVolume('media', v)`. Radio listens with `onVolume` from `core/web/device.ts`. `audio.volume` stays at 1. Radio ignores the old `radio.volume` store key.
- Radio sends now-playing to the drawer through the media hook (below).

**Media hook.** New file `src/core/web/media.ts`:
- `setNowPlaying(info | null)`, where `info` is `{ title, subtitle, art, playing }`.
- `setMediaActions({ toggle, next?, prev? })`.
- `onNowPlaying(fn)` for the drawer.

`src/core/web/system.ts` shows a media card in the drawer above the volume slider when `info` is not null. Radio passes `next` and `prev` only with 2 or more favourites (`stepFavourite`).

**Data.** No new hub routes. Countries come from the existing `catalogue` route. Show `name` only.

**States.** Idle: "Nothing playing". Loading: a spinner on play. Failure: `rdMsg` shows `failMessage`. Empty list: `rdResEmpty`. Catalogue down: "Radio Browser is not available. Try again."

## Recipes

**Layout.** In `src/apps/recipes/web/index.ts`, Discover in order: compact search bar (one line, 44 px high), today's pick, Saved, "What do you have", ideas.

**Picker.**
- One text field with suggestions from the ingredient list. Tap a suggestion to add a chip.
- A "Want to buy" toggle sits beside the field. On: new chips are "want" (outlined). Off: new chips are "have" (filled).
- Tap the x on a chip to remove it. To change the kind, remove and add again.
- At 8 chips, the field is disabled and shows "8 at most".
- "Find recipes" runs the search. "Ask Claude" sends the prompt.
- The picker saves its chips in the store key `recipes.pantry`.

**Ranking.**
1. Fetch `filter.php?i=` for each "have" ingredient. Count the matches per meal.
2. Keep the top 12 meals by match count. Fetch `lookup.php?i=` for each.
3. Missing = recipe ingredients that are not "have", not "want" and not staples. Staples: salt, pepper, black pepper, water, oil, olive oil, vegetable oil.
4. Sort by missing count (ascending), then match count (descending), then name.

**Hub routes** (`src/apps/recipes/server/index.ts`):
- `GET ingredients` returns `list.php?i=list` as names. Cache the result for 24 hours.
- `GET pantry?have=a,b&want=c` returns `{ status, recipes }`. Each recipe has `missing: string[]`. The route rejects more than 8 names. Cache each filter call for 1 hour.

Put the pure ranking code in `src/apps/recipes/web/pantry.ts`, so the server and tests can import it.

**Claude prompt.** Add `pantryPrompt(have, want)` in `web/recipe.ts`. The prompt asks for one recipe that uses mostly the "have" items. The recipe may use the "want" items and the staples. The reply uses the same JSON shape as `tonightPrompt`. Claude replies go through the existing draft flow.

**States.** Nothing picked: "Add what you have." Loading: skeleton cards. No match: "No recipes use all of these. Ask Claude." TheMealDB down: "Recipes are not available. Try again."

## PRs in build order

| # | Title | Files | Size | Test |
|---|---|---|---|---|
| 1 | `feat(radio): use the device media volume` | radio `web/index.ts`, `web/player.ts` | S | `radio-player.test.ts`: the old key is ignored |
| 2 | `feat(core): add a now-playing media hook to the drawer` | `core/web/media.ts`, `core/web/system.ts` | M | new `media-hook.test.ts` |
| 3 | `feat(radio): send now-playing and favourite steps to the drawer` | radio `web/index.ts` | S | `radio-player.test.ts`: no steps with fewer than 2 favourites |
| 4 | `feat(radio): lay out the hero, strip and browse column` | radio `view.html`, `app.css`, `web/index.ts` | M | `npm run check`, `__dev.hitAreas()` in mock mode |
| 5 | `feat(recipes): add pantry ranking and hub routes` | recipes `web/pantry.ts`, `server/index.ts`, `api.ts` | M | new `recipes-pantry.test.ts`: staples, cap, sort |
| 6 | `feat(recipes): add the What do you have picker` | recipes `web/index.ts`, `app.css` | M | `npm run check`, `__dev.hitAreas()` in mock mode |
| 7 | `feat(recipes): ask Claude from the picker; compact search bar` | recipes `web/recipe.ts`, `web/index.ts`, `app.css` | S | `recipes.test.ts`: `pantryPrompt` |

Add each new test file to the `test` script in `package.json`.

## What each PR must not change

1. The `catalogue` and `title` hub routes.
2. The drawer tile order and the volume slider behaviour.
3. Favourites and recently played store keys.
4. Playback logic in `web/player.ts`.
5. The existing `search` and `random` routes.
6. Saved recipes and their store key.
7. The draft flow: a recipe is saved only after the user taps Save.

## Android UI

None. The drawer card is ClaudeOS UI, not the Android media notification.
