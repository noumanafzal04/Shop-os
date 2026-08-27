---
name: shopos-full-screen-pinned-room
description: FIXED — the PWA install card sat on the dine-in tab's Running total / Fire / Settle; four full-screen pages never subtracted --pinned-bottom; FULL_SCREEN_PAGE is the one spelling
metadata:
  type: project
---

The install prompt is `fixed bottom-3` at `z-[99998]`. `useReservesBottomRoom`
already existed and AppLayout already padded by `--pinned-bottom`.

**Four pages run OUTSIDE AppLayout** — the till, the floor, the tab workspace,
the kitchen board — and none subtracted it. On a page with ordinary scroll that
costs a flick; on a page that is exactly `h-dvh` **there is no flick**, so
whatever the layout pins to its own bottom is under the card permanently. On the
dine-in tab that was **"Running total" and the Fire-to-kitchen and Settle
buttons**. `HelpCenterPage`, also full-screen, had it right — the same rule
applied to one half of the screens it belongs to.

Now `FULL_SCREEN_PAGE` / `FULL_SCREEN_PAGE_MIN` in `src/layout/fullScreenPage.ts`,
guarded by `fullScreenPage.test.ts` which **reads the router** for the page list
rather than holding its own copy. Mutation-proven.

**How to apply:** any page rendered outside AppLayout must use
`FULL_SCREEN_PAGE`. `h-dvh` alone has no scroll room to recover with.

**Two detectors were wrong first** — see [[shopos-detector-vs-rule]]:
- the new guard found **zero** pages: `App.tsx` mounts `AppLayout` TWICE
  (/admin and /tenant) and `indexOf` found the admin one. Only its denominator
  caught it.
- `everyScreenIsWalked` reported **the floor and kitchen** as unwalked when the
  tab's `path` became a function — its literal-only regex stopped matching the
  whole array.

Also fixed here: the card said *"Put CartZe on this iPad"* to anyone on iOS,
including iPhones (`iosDeviceName()` now).
