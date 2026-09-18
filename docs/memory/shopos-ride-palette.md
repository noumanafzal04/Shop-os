---
name: shopos-ride-palette
description: "2026-09-17 palette direction from the rüder refs — customer #10B981 green, rider/driver #EF4444 carmine; NOT yet implemented"
metadata:
  type: project
---

Design direction given 2026-09-17 alongside inDrive/rüder reference screens
("design is very neat and clean"):

| Side | New | Today in code |
|---|---|---|
| Customer | **#10B981** green (crayola) | `#557F1D` leaf |
| Rider / driver | **#EF4444** carmine pink | `#E94E00` ember |
| Supporting | `#FD9733` saffron, `#101010` near-black, `#FFFFFF` | — |

**Status: RECORDED, NOT BUILT.** The user said "just keep in memory". Nothing
in `core/src/theme` or `mode/palettes.ts` has moved.

**Why:** the palette is the one thing a person judges before reading a word,
and both sides are being redesigned for rides anyway — so the swap is cheap now
and expensive once ride screens exist in the old colours.

**How to apply:** the mapping lives in exactly one file —
`mobile/src/modules/mode/palettes.ts` (`useModePalettes()` → `paletteFor` /
`oppositePaletteFor`), which `App.tsx` hands to the shared ThemeProvider. Swap
the two palette objects there and every screen on both sides follows; no screen
names a colour itself.

**The one problem to solve first:** #EF4444 IS the danger colour. The app
already ships `variant="danger"` buttons, destructive confirms and error text
in red. A rider side themed carmine means "delete this" and "this is the app"
are the same hue, and the first casualty is a confirm dialog nobody reads
properly. Either the rider primary shifts off pure red, or `danger` moves to a
distinct hue (deeper crimson / amber) BEFORE the swap — not after.

Also carried over from the refs, into the ride flow doc rather than here: a
"Raise fare" control when no driver bids, and offers arriving as stacked
Accept/Decline cards over the map rather than a separate list screen.

See [[shopos-mobile-customer-shape]], [[shopos-mobile-design]].
