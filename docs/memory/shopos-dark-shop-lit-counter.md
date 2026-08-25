---
name: shopos-dark-shop-lit-counter
description: Landing page redesign — dark hero as the argument, trade switcher as evidence, dashboard drawn not screenshotted; 2 browser-only bugs
metadata:
  type: project
---

2026-08-25. Landing page rebuilt after "bohot basic". The design decisions are
load-bearing, not taste:

- **The fold is dark because the pitch is.** A shop whose power went and whose
  counter did not — one lit thing on a near-black band. Not a fashion.
- **The header goes light over that band in BOTH themes** (`overDark` prop),
  because grey-600 on near-black is unreadable and the band is dark whichever
  theme the visitor has.
- **The eight-icon grid is gone.** `TradeSwitcher` — pick a trade, the till's
  items, units and one trade-specific line change. Units are the argument;
  whoever never stood behind a counter cannot fake them.
- **`tradeCarts.ts` holds everything about a trade** (label, `where`, cart,
  note, `does`). Split across files is how a pharmacy's cart lands under a tyre
  shop's heading. The footer's trade column reads the same record.
- **The dashboard is DRAWN, not a screenshot.** A capture is unreadable at that
  size, needs a dark copy, and becomes a lie the first time a button moves.
- **No customer numbers, no logos, no testimonials.** Only what is true today
  or a price. FAQ says plainly that no card payments are processed.

**Two bugs only a real browser found** — see [[shopos-screen-testing]]:
- The bar chart rendered NO bars: `items-end` stopped the columns stretching,
  so percentage heights resolved against a zero-height parent.
- The page scrolled sideways 20px on a phone: the decorative glow behind the
  till (`-inset-10`) widened the document. A glow must never widen the page.

Found by MEASURING (`scrollWidth - clientWidth` and computed bar height at four
viewports), not by looking at screenshots. And once again a measurement lied:
the admin screen 404'd because the preview server was serving a build made
before the route existed — [[shopos-measurement-that-lied]].

**Later the same sprint — the top of the page, three times wrong:**
- `-mt-[62px]` was the header measured by hand; the nav grew a pill, it became
  79px, and a white line cut across the fold.
- Wrapping header + hero in one dark box fixed the line and **broke `sticky`** —
  a sticky element holds inside its own parent (at 2400px down its top was
  -1010px). A fix nobody had checked below the fold.
- Now: `ResizeObserver` publishes `--landing-header` and the hero pulls up by
  exactly that. 79px desktop, 69px phone — no literal could have been right.

Also: an `IntersectionObserver` reports **changes, not state** — the nav's
section marker stuck for ever until the whole picture was kept and recomputed.
And `<Wordmark>` follows the theme, so on the permanently-dark footer it drew
near-black letters in light mode; that surface needs `tone="onDark"`, which its
own docblock says.

