---
name: anthropic-style
description: Check ClaudeOS CSS, icons and UI against the Anthropic visual style (warm palette, serif and sans type, flat surfaces, one clay accent) in CLAUDE.md "Visual style", and report violations with file and line. Use when asked for "anthropic style", "match the style", "does this look right", "style audit", "is this on brand", or to review a UI change for looks. Not for fixing hit areas (see CLAUDE.md "Code rules") or for Android UI that reaches the user (see "Rule: no visible Android").
---

# Anthropic style audit

The rules live in CLAUDE.md "Visual style". The tokens live in `public/core.css` (`:root` for light, `:root[data-theme="dark"]` for dark). This skill reads; it does not change app code unless the user asks for a fix.

## Reference: the guide in short

- Palette: ink `#141413`, ivory `#faf9f5` and `#f0eee6`, oat `#e3dacc`, manilla `#f5e3c7`, warm greys `#3d3d3a`, `#87867f`, `#b0aea5`, `#cccbc8`, and one accent, clay `#d97757` (pressed `#c6613f`). No cool colours, no pure white, no gradients or glows.
- Type: a serif for display and reading text, a sans for UI chrome, a mono for code only. Weights 400 to 700. Slight negative tracking on headings. Sentence case.
- Layout: 4px base unit (4, 8, 12, 16, 24, 32). Cards 24px radius, buttons 8 to 12px, no pills.
- Flat: no shadows; depth comes from a tone step and a 1px border.
- Icons: small, minimal line marks in the warm neutrals. Illustration is warm and hand-made, never photos or gradients.
- Motion: only soft hover and press changes. The guide gives no timings: ClaudeOS uses the `--dur-*` and `--ease-*` tokens.

## Steps

1. **Scope.** Audit the files the user names. With no names, audit the current diff (`git diff --name-only main...HEAD`), and for a full audit use `public/core.css`, `src/apps/*/app.css` and `src/core/web/app-icons.ts`.
2. **Read the rules.** Read CLAUDE.md "Visual style" and the `:root` blocks of `public/core.css`, so you know every token name and value.
3. **Check token usage.** Grep each file (skip the `:root` token blocks themselves) for:

   | Rule | Grep pattern |
   |---|---|
   | Raw colour instead of a token | `#[0-9a-fA-F]{3,8}\b` |
   | Pure white | `#fff(fff)?\b`, `(?<![-\w])white(?![-\w])`, `rgba\(255, ?255, ?255` |
   | Cool colour | `var\(--(blue\|sky\|track-edge)\)`, and raw hex with a blue hue |
   | Gradient | `(linear\|radial\|conic)-gradient` |
   | Soft shadow | `box-shadow\|text-shadow\|drop-shadow` (a `0 0 0 1px` ring is a border, not a shadow) |
   | Pill | `border-radius:[^;]*\b(99\|999\|9999)px` |
   | All caps | `text-transform:\s*uppercase` (allowed only on `.label`) |
   | Blur | `backdrop-filter\|filter:\s*blur` |
   | Font outside tokens | `font-family:` or `font:` without `var(--serif)` / `var(--sans)` |
   | Clay as decoration | `var\(--clay\)` on anything that is not the one action needing attention, the spark or the critter |

4. **Check icons.** For a changed icon, run `npm run check:icons` and read `ICON_RULES` in `src/core/web/app-icons.ts`. Flag `var(--blue)` accents (a cool colour) and any fill, raster or emoji.
5. **Sort out intended exceptions.** Do not report these as bugs, but name them once:
   - The clay spark and the critter (their clay, the `.say` bubble's ink) are the brand marks.
   - The ambient screen (`.amb*` in `core.css`) is always dark and uses its own raw warm hexes.
   - The welcome theme swatches (`.wel-swatch`) draw the light and dark themes with literal colours.
   - Surfaces that float over the page (control center, banners, power sheet, switcher, volume HUD, keyboard) keep one soft shadow.
   - Scroll-edge fades with `mask-image` gradients are not visible gradients.
6. **Report.** Give a count per rule, then each violation as `path:line  rule  what is wrong  the token or fix to use`, worst first (visible on every page beats a rare state; colour beats radius). Say which are intended exceptions. Do not edit files unless asked; if asked, fix one rule per commit and run `npm run check`.
