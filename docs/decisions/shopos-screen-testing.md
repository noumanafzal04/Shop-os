# The tests that need a browser

**2026-08-19** · panel `e2e/`, `playwright.config.ts`

## Why

A shop reported seven defects by holding a tablet. **Not one of them was caught
by 3,079 green tests.**

- the Appearance panel's close button drawn underneath the header
- that same button at 28×28
- POS tiles the shop called "transparent"
- a bottom bar eating the screen
- quick-key hints for keys the device does not have
- content behind the sidebar in portrait
- a payment panel taller than the tablet

None of those are wrong in the **source**. Every one is wrong only once
something computes a position — and everything under `src/**.test.ts` runs in
**jsdom, which has no layout engine**: `getBoundingClientRect()` returns zeros,
no stylesheet is applied, and no media query ever matches.

That is not a gap in the tests. It is a gap in what the tool can see.

## What was built

Playwright, real Chromium and real **WebKit** — the engine an iPad runs, and the
one that taught this codebase `100dvh` never `100vh`. Three viewports, and the
middle one is the one that broke: **tablet landscape is 1024–1279, which is `lg`
in this codebase, not `xl`.**

Five rules, each one generalised from a defect that actually happened:

| Rule | The defect it generalises |
|---|---|
| **Nothing a finger must press is covered** | the close button under the header |
| **Every tap target is ≥ 32px** | that button at 28 |
| **The page does not scroll sideways** | the till header hiding Drawer and Close |
| **What is open fits the screen** | the payment panel taller than the tablet |
| **The page ends above what is pinned to it** | the PWA card sitting on the page |

## What it found on the first real run

**The PWA install card sits on the page**, at `z-[999998]`, on every screen that
draws something near the bottom. On the shop setup page that was the **"Finish
setup" button** — the primary action of the first screen a new shop ever sees,
at exactly the moment that banner appears. On the Help Centre it was the last
paragraph of every article.

Fixed by having the card measure itself into `--pinned-bottom` and the page
reserve that room. Measured rather than hard-coded: the card is two lines on
Chrome and four on Safari, whose copy has to explain Share → Add to Home Screen.

**Two till controls below the floor**: the scan-sound mute at **24×24** and the
sync pill at **72×28**. The first is what a cashier reaches for in a noisy shop
without looking; the second is the one they jab when the line drops.

## Four things the suite got wrong about itself first

Every one of these is the same failure the QA sweep keeps finding, now inside
the tool built to find it.

**It tested the shop setup form fourteen times.** The sign-in step asserted the
URL matched `/tenant` — and `/tenant/setup` matches `/tenant`. The sweep's
tenants have never completed setup, because the API does not gate on it and only
the panel does, so every route redirected there. Fourteen screens reported as
dashboard, catalog, reports and till were one unchanging form, and **everything
passed**: an unchanging page has nothing covered and nothing off its edge.

Caught by the **denominator** — the till measured 1 tap target where it has
fifty. Every screen now says how much it looked at.

**The covering rule went green against the defect it was written for.** Its
first version asked "is this covered right now", and scrolling brought the
control out from under the card, so it passed. The question a shop has is not
"is it covered" but "can I press it at all" — so it now scrolls each suspect to
the middle and asks again, and a second rule asks whether the page ENDS above
what is pinned to it, which is the part that cannot be scrolled away.

**It measured boxes nobody can see.** `getBoundingClientRect()` reports an
element's full box even when an ancestor with `overflow: auto` has clipped most
of it away. The Help Centre's last paragraph ran to y=729 while its scroller cut
it off at y=700 — reported as overlapping a card at y=712 that no reader could
see it behind. Boxes are now intersected with every ancestor that clips them.

**One rule disturbed the next.** `nothingIsCovered` scrolls, including sideways,
so the sideways-scroll rule fired once and never again. A finding nobody can
reproduce teaches the reader to ignore findings. The rules that measure the page
at rest now run first.

## Running it

```bash
cd shopos-backend && php artisan serve --port=8000     # the API, with sweep tenants
cd shopos-admin-and-user-panel && npm run test:e2e
```

It signs in once and reuses the session — `throttle:auth` is 5 a minute per IP —
and completes the shop setup if the tenant has not.

## Related

- `shopos-tablet-chrome.md` — the defects this exists because of
- `shopos-detector-vs-rule.md` — a guard that passes while blind to its subject.
  Three of the four self-inflicted faults above are that, again.
