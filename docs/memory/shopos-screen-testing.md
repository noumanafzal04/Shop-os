---
name: shopos-screen-testing
description: Playwright browser suite (e2e/) — the only tests that can see layout; jsdom has no layout engine, which is why 7 tablet bugs passed 3079 tests
metadata:
  type: project
---

**BUILT 2026-08-19.** `shopos-admin-and-user-panel/e2e/` — Playwright, Chromium
**and WebKit** (the iPad engine; it taught this codebase `100dvh` never
`100vh`). Three viewports; tablet landscape 1024–1279 is **`lg`, not `xl`**.

Run: API up on :8000 with sweep tenants, then `npm run test:e2e`.

Five rules, each generalised from a defect a shop actually reported:
nothing pressable is covered · every tap target ≥32px · no sideways page scroll ·
what is open fits the screen · the page ends above what is pinned to it.

**Why:** jsdom has **no layout engine** — `getBoundingClientRect()` returns
zeros, no CSS applies, no media query matches. All 7 tablet defects were
invisible to 3,079 green tests because none of them are wrong in the SOURCE.

**Found on the first real run:** the PWA install card (`z-[999998]`, fixed
bottom) sits ON the page — over the **"Finish setup" button** (first screen a
new shop sees) and over the Help Centre's last paragraph. Fixed via
`--pinned-bottom`, measured by the card itself. Plus two till controls under the
floor: scan-mute 24×24, sync pill 72×28.

**How to apply — four ways the suite fooled itself first:**
1. It tested the **shop setup form 14 times**: sign-in asserted URL `/tenant`,
   and `/tenant/setup` matches it. Sweep tenants have `setup_completed=false`
   (API doesn't gate, panel does). Everything passed — an unchanging page has
   nothing covered. Caught only by the **denominator** (1 tap target where the
   till has 50). Every screen now reports how much it examined.
2. The covering rule **went green against its own defect** — scrolling brings a
   control out from under a pinned card. Ask "can it be pressed at all", then
   ask separately whether the page ENDS above what is pinned.
3. It measured **unclipped rects** — `getBoundingClientRect()` ignores an
   `overflow:auto` ancestor. Intersect with every clipping ancestor.
4. One rule **scrolled and disturbed the next**, making a finding unreproducible.
   Rules that measure at rest run first.

Related: [[shopos-tablet-chrome]], [[shopos-detector-vs-rule]], [[shopos-qa-sweep]]
