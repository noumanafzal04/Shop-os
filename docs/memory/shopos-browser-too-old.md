---
name: shopos-browser-too-old
description: Safari 16.4 is the floor (Tailwind v4 = 304 color-mix + 41 oklch); a banner now says so, and it doubles as the diagnosis for "background show nahi ho raha"
metadata:
  type: project
---

2026-09-04. Shop on an iPad: *"dashboard branding show nahi ho rahi / POS mein
background issue, left side product side ka."* **Neither screen is wrong.**

Tailwind v4 compiles every opacity modifier (`bg-white/5`, `bg-brand-500/15`)
to `color-mix()` — **304** in the built CSS, plus **41** `oklch()`. Safari
learned `color-mix()` in **16.2**; Tailwind v4 documents **16.4** as its floor.
Below it those declarations are INVALID and dropped **in silence** — no error,
no warning — so tinted surfaces just vanish and the app looks broken.

**No honest polyfill exists:** the colours are computed at paint time from
custom properties the app rewrites at runtime (per-tenant branding), so a
"fallback" means re-deriving the whole palette in JS for a browser we chose not
to support. Tailwind v3 would be a design-system rebuild.

So: `src/components/system/OldBrowserNotice.tsx`, mounted above the router
(reaches the full-screen till too). All styles INLINE, all colours literal — a
component about "this browser cannot compute our colours" must not ask it to.

**It is also the diagnosis.** iOS Safari cannot be run on this Mac and
Playwright's WebKit is a modern build, so "is the iPad old, or is this a bug?"
was unanswerable from here. Now: banner shows → the browser; banner absent →
ours to find. **Turning a blocking question into one the user answers by
looking beats waiting for the answer.**

Related: [[shopos-secure-context]] · [[shopos-screen-testing]] ·
[[shopos-page-behind-overlay]] · [[shopos-tablet-chrome]]
