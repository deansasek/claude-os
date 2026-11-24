# Radio in the Spotify style: design spec

Base: `main` at 56fca6c (after #237). Design only. Each PR below is small, goes through a branch, and runs `npm run check` and `npm test`.

## Research

What the big streaming players share, and the sources:

- **Library column (left).** Spotify desktop moved Your Library to a left column in June 2023. The user can collapse the column to icons or resize it ([Spotify newsroom](https://newsroom.spotify.com/?p=23515), [MacRumors](https://macrumors.com/2023/06/21/spotify-desktop-app-redesigned)). Web clones use a fixed column of about 230 px ([gist](https://gist.github.com/tsanak/5cfacabb4b4062fda13d68c6752984f2)). YouTube Music puts navigation in a drawer that collapses ([9to5Google](https://9to5google.com/2023/06/15/youtube-music-web-redesign/)).
- **Main area.** Home is a stack of shelves. Each shelf has a heading and one row of square cards that scrolls sideways. YouTube Music builds its shelves from listening history ("Your favorites") ([9to5Google](https://9to5google.com/2023/06/15/youtube-music-web-redesign/)).
- **Bottom player bar.** The bar spans the full window. It is one three-column grid, `1fr auto 1fr`: track info left, transport centred, volume right. The play button stays centred at every width. A thin progress rail sits under the controls ([DEV](https://dev.to/dev48v/spotifys-now-playing-bar-is-just-one-css-grid-a-ticking-width-5494)). Userstyles set the bar to about 70 px minimum ([Greasy Fork](https://greasyfork.org/de/scripts/402162-spotify-side-mode/code)). Spotify publishes no exact height. Public screenshots measure about 72 to 90 px.
- **Now playing.** Spotify desktop shows Now Playing as a right panel that opens on playback and can be resized or hidden ([Spotify newsroom](https://newsroom.spotify.com/?p=23515), [Spotify Community](https://community.spotify.com/t5/Desktop-Windows/Desktop-New-quot-Now-Playing-View-quot-sidebar/td-p/5600889/page/7)). On mobile and tablet, a tap on the bar opens a full Now Playing view ([Spotify support](https://support.spotify.com/us/article/play-queue/)). YouTube Music web opens a full player: large art, title, scrubber and controls, then Up next, Lyrics and Related. A mini player docks at the bottom when the player is closed ([9to5Google](https://9to5google.com/2024/03/04/youtube-music-web-player-redesign/)).
- **Search.** Spotify searches songs, artists, genres and moods ([Spotify support](https://support.spotify.com/us/article/search/)). An empty search shows a "Browse all" grid of coloured category tiles.
- **Queue.** On desktop the queue button sits in the bar. On mobile the queue opens from the Now Playing view ([Spotify support](https://support.spotify.com/us/article/play-queue/)). Live radio has no queue. The Radio equivalent is "Up next in Favourites", the order that `stepFavourite` follows.

Not adopted: the left library column (the ClaudeOS rail already takes 84 px; a second column leaves too little room for shelves), the progress rail (a live stream has no length), coloured artwork washes and rotated cover art (house style: flat, warm, no decorative illustration).

## Stage and grid

The tablet is 1280×800. The stage is 1024×640 CSS px at 1.25×. The rail takes 84 px, so the Radio page is 940×640. Content uses the core grid: `--app-l` 32, `--app-r` 36, so content is 872 px wide. The header row sits at y 28 to 60. Content starts at `--app-body` (y 80).

```
y 28  [icon Radio]  [Home] [Search]                         (header row, app-hd-after)
y 80  ┌──────────────── main view, 872 wide, scrolls down ───────────────┐
      │ Favourites                                           Show all    │
      │ [124][124][124][124][124][124][pe                                 │
      │ Recently played ...                                               │
y 544 └───────────────────────────────────────────────────────────────────┘
y 560 ═══════════════ player bar, 940 wide, 80 tall ═══════════════════════
y 640
```

All numbers below are CSS px at the stage scale. Multiply by 1.25 for device pixels.

## 1. Player bar

- **Box.** Full page width (940), 80 tall, at the bottom of the page (y 560 to 640). Background `--card`, a 1px `--line` top border, no shadow. Inner padding: `--app-l` left, `--app-r` right, 8 bottom, so the content centres at y 596 and clears the shell's home handle.
- **Grid.** `grid-template-columns: minmax(0,1fr) auto minmax(0,1fr)`, `column-gap: 24px`, `align-items: center`.
- **Left (station).** One button that opens Now playing: art 56×56 (radius 10, the logo over its colour block), gap 12, then two lines: station name in `--serif` 500 17/22, and the state line in `--sans` 400 13/18 `--t3` (`titleLine`). Both lines clip with an ellipsis. While on air, an 8 px `--clay` dot leads the state line; it pulses while buffering. Then the heart, 44×44.
- **Centre (transport).** Previous 44, play or pause 56 (ink circle: `--text` fill, `--bg` icon), next 44. Gap 16. Total 192. Previous and next are disabled with fewer than 2 favourites.
- **Right (tools).** Right-aligned: Sleep (44 tall, radius 12, 1px `--line`, text "Sleep" or "Sleep 28 min", clay border when set), gap 12, volume icon 24, gap 8, slider 140 wide on a 44-tall hit area, gap 12, expand button 44×44 (chevron up). Total about 330.
- **Idle.** No station: art is the blank radio block, name "Nothing playing", line "Pick a station to listen", transport disabled except play (plays the first favourite, else the first top station).
- **Failure.** The state line shows `failMessage` in `--clay-deep` (`--clay` in dark).
- Stop moves out of the bar. It lives in Now playing and on the station page. Pause in the bar keeps the stream; Stop lets it go.

## 2. Home: shelves

The main view (y 80 to 544, 872×464) scrolls down. Each shelf:

- **Heading row.** 32 tall: title in `--serif` 500 20/28 with -0.01em tracking, left; "Show all" in `--sans` 500 14 `--t2`, right (44 tall hit area). Gap 12 to the cards.
- **Card row.** One row, `overflow-x: auto`, no scrollbar, `scroll-snap-type: x mandatory`, snap on card start, `scroll-padding-left: 0`. A 24 px mask fades the right edge.
- **Shelf gap.** 28 between shelves; 16 under the last shelf.

Station card (Favourites, Recently played, Top stations):

- 124 wide. Art 124×124, radius 14, 1px `--line`, logo `object-fit: contain` over the colour block.
- Under the art, gap 8: name in `--sans` 500 15/20, one line; sub line in `--sans` 400 13/18 `--t3` (country, else codec and bitrate), one line. Card height 174.
- Gap 16. Six cards show in full (6×124 + 5×16 = 824) and the seventh peeks by 32, so the row reads as scrollable.
- Tap the card: open the station page. Tap the 40×40 play button on the art's bottom-right corner (inset 8, ink circle, shown on the station on air and on press): play or pause at once.
- The station on air gets a 1px `--clay` border on its art.

Facet card (Genres, Countries), 16:9:

- 200×112, radius 14, background a warm muted tone (the `--hue` formula with a warm hue, decision 5), 1px `--line`.
- Name in `--serif` 500 20/24, top-left, inset 14, two lines at most. Station count in `--sans` 400 13 `--t3`, bottom-left.
- Gap 16. Four show in full (4×200 + 3×16 = 848) and the fifth peeks by 24.

Shelves in order:

| Shelf | Source | Count | Empty state |
|---|---|---|---|
| Favourites | `radio.favs` | all | One 124-wide dashed card: "Tap the heart on a station to keep it here." |
| Recently played | `radio.recent` | all (the store keeps its own cap) | Shelf hidden |
| Top stations | `catalogue?path=stations/topvote/100` | first 20; Show all opens the full list | Skeleton cards while loading; "Radio Browser is not available. Try again." on error |
| Genres | `catalogue?path=tags` | first 12 by count | Shelf hidden on error |
| Countries | `catalogue?path=countries` | first 12 by count, names only | Shelf hidden on error |

"Show all" opens a list view in the main area: the Back button (44 tall), the shelf title, then a grid of 2 columns (428 each, gap 16) of the existing 64-tall station rows, or 4 columns of 52-tall facet rows. A facet card opens the same list for that facet (`bytag`, `bycountry`).

## 3. Search

Search is its own view, picked from the header tabs (Home, Search). The tabs sit in `.app-hd-after`, 40 tall (44 hit), radius 12 (not a pill), ink fill when on.

- **Field.** At the top of the main view: 872×52, radius 14, `--card`, 1px `--line`, search icon 22. A tap opens the ClaudeOS keyboard (`Keyboard.open`), never the Android keyboard. Under it, gap 12, the filter chips (Country, Codec, Bitrate), 40 tall, radius 12.
- **Empty query: Browse all.** Three sections, each a heading (`--serif` 20) and a grid of 4 columns of facet tiles, 206×112, gap 16 (4×206 + 3×16 = 872), the same tile as the facet card above:
  - Genres: top 8, then "All genres".
  - Countries: top 8, then "All countries".
  - Languages: top 8, then "All languages".
- **Recent searches.** Up to 6 past queries as chips above Browse all. New store key `radio.searches`. (See decision 4.)
- **Results.** A query or a filter shows stations in 2 columns of 64-tall rows (428 each, gap 16, row gap 8). The first match also shows as a "Top result" card: 872×136, art 104, name `--serif` 28, Play and Save buttons.
- **States.** Loading: 6 skeleton rows. No match: "No stations match. Try fewer words." Error: "Radio Browser is not available. Try again."

## 4. Now playing

- **Open.** Tap the bar's station area or the expand chevron. The view rises over the main view and the bar (y 80 to 640) with `translateY` and opacity, `--dur-slow`, `--ease-out`. Reduced motion: no rise, fade only. The header row stays, so the Home and Search tabs still work.
- **Close.** The chevron-down button (44×44) at the view's top-left, the shell's back gesture, or a tab tap.
- **Layout.** Two columns, gap 40.
  - Left: art 296×296, radius 24, 1px `--line`, logo `contain` over the colour block.
  - Right (536 wide): a kicker "Now playing" (`--sans` 14 `--t3`, clay dot while on air); the station name `--serif` 500 36/1.1, two lines at most; the state line `--serif` italic 20/1.35 `--t3`, two lines at most; the details line `--sans` 14 `--t2` (country · language · codec bitrate); the heart 48.
  - Controls row, 24 below: previous 64, play or pause 84 (ink), next 64, gap 20; then at the right Sleep and Stop, 48 tall.
  - Volume: the full column width, 44 tall.
  - "Up next in Favourites": a heading (`--sans` 14 `--t3`), then a row of 72×72 art cards with the name under them (`--sans` 13, one line), gap 12, scrolling sideways. The first card is the next favourite after the station on air (`stepFavourite` order). A tap plays it. Hidden with fewer than 2 favourites.
- Height check: 32 + 296 = 328 on the left; on the right 20 + 80 + 54 + 20 + 24 + 84 + 16 + 44 + 24 + 20 + 92 = 478, inside the 544 tall view.

## 5. Station page

Opens in the main view from any card or row. The bar stays.

- **Header.** Back (44 tall) above. Art 168×168, radius 18. Right of it, gap 24: kicker "Station" (`--sans` 14 `--t3`), name `--serif` 500 40/1.1 with -0.025em tracking, two lines at most, then the details line `--sans` 15 `--t2` (country · language · codec · bitrate).
- **Actions.** 20 below the header: Play or Pause (ink, 52 tall, 140 wide, radius 14), Save or Saved (ghost, 52 tall, heart icon, clay heart when saved), Stop (ghost, only while this station is on air). Gap 12.
- **On air.** While this station plays: the stream title in `--serif` italic 18, three lines at most.
- **Genres.** The station's tags as chips (40 tall, radius 12). A tap opens that genre's list.
- **More like this.** A shelf of station cards from the first tag (`bytag`), the same 124 card, without this station.

## 6. The media hook (#227)

`src/core/web/media.ts` already exists (`setNowPlaying`, `setMediaActions`, `onNowPlaying`). Radio already calls it from `syncMedia()`.

- The bar reads the same state as the drawer card. Add one pure function `barModel(current, state, streamTitle, favs)` in `web/player.ts`. It returns `{ title, subtitle, art, playing, canStep, live }`. `syncMedia()` and the bar both use it, so the drawer card and the bar never disagree.
- The bar does not subscribe to `onNowPlaying`. Radio owns its audio, so the bar draws from Radio's own state. The hook stays the one way out to the drawer.
- Later, when #227 grows a state field (playing, paused, buffering, stopped) and `stop`, Radio passes them. The bar needs no change.

## 7. PRs in build order

| # | Title | Files | Size | Test |
|---|---|---|---|---|
| 1 | `refactor(radio): add barModel for the bar and the drawer card` | radio `web/player.ts`, `web/index.ts` | S | `radio-player.test.ts`: idle, buffering, failure, `canStep` with 0, 1, 2 favourites |
| 2 | `feat(radio): add the bottom player bar` | radio `view.html`, `app.css`, `web/index.ts` | M | `npm run check`; `__dev.hitAreas()` in mock mode; adb screencap |
| 3 | `feat(radio): show Home as shelves of cards` | radio `view.html`, `app.css`, `web/index.ts`, new `web/shelves.ts` | M | new `radio-shelves.test.ts`: shelf order, counts, empty states; `npm run check` |
| 4 | `feat(radio): add Show all lists and facet lists` | radio `web/index.ts`, `app.css` | S | `npm run check`; Back returns one level |
| 5 | `feat(radio): add Search with Browse all tiles` | radio `web/index.ts`, `app.css`, `web/catalogue.ts` | M | `radio-catalogue.test.ts`: top-8 pick, recent-search cap of 6 |
| 6 | `feat(radio): add the Now playing view` | radio `view.html`, `app.css`, `web/index.ts` | M | `npm run check`; `__dev.hitAreas()`; reduced motion check |
| 7 | `feat(radio): add More like this to the station page` | radio `web/index.ts`, `app.css` | S | `radio-shelves.test.ts`: the station is left out |

Add each new test file to the `test` script in `package.json`. Size: S is under 150 changed lines, M is under 400.

Media API dependency: PR 1 changes what `syncMedia()` sends only in shape, not content. PRs 2 and 6 read `barModel`. None needs a change to `core/web/media.ts`. A future #227 change (state and `stop` in the hook) is a separate core PR.

## What each PR must not change

1. The hub routes: `catalogue`, `stations`, `title`, `search`, `random`.
2. Store keys `radio.favs` and `radio.recent`.
3. Playback in `play`, `toggle`, `stop` and the audio element.
4. The device media volume (`device.setVolume('media', v)`, `onVolume`).
5. The drawer card order and the volume slider in the drawer.

## 8. Decisions for the user

1. **Left library column: no.** Recommendation: no column. The rail and the header tabs (Home, Search) do the job, and the shelves get the full 872 px.
2. **Bar height: 80.** Recommendation: 80 CSS px (100 device px), full page width. 72 is closer to Spotify desktop but too small for 56 px touch targets plus the home handle.
3. **Now playing: full view, not a right panel.** Recommendation: a full view over the main area. A 300 px right panel would cut the shelves to four cards.
4. **Recent searches: keep them.** Recommendation: yes, 6 at most, in the new key `radio.searches`, with a "Clear" button. Say no if the tablet should not remember searches.
5. **Category tile colour: warm muted tones only.** Recommendation: use the low-saturation `--hue` formula with a warm subset of `HUES` (18, 32, 48, 96, 330), not Spotify's bright tiles. Today `HUES` also holds 150, 190 and 215 (greens and blues), which the house palette does not allow on large tiles.

## Android UI

None. The bar, Now playing, Search and the keyboard are ClaudeOS UI. The drawer card is ClaudeOS UI, not the Android media notification.
