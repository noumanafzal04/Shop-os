---
name: shopos-waiter-holds-a-phone
description: STANDING — "held in a waiter's hands" was answered with an iPad only; restaurant-phone e2e project added, and it found both dine-in bugs immediately
metadata:
  type: feedback
---

`playwright.config.ts` had `restaurant` (desktop) and `restaurant-tablet`
(iPad), with a comment saying the floor and the tab are "held in a waiter's
hands". **A waiter's hands usually hold a phone.** Nothing measured those two
screens below 810px.

Both were broken there and neither failed anything:

- the floor's header was one nowrap flex row → **15px off the side** of a 390px
  screen, with **"+ Takeaway"** — the button reached for most — as the half
  hanging over the edge
- the tab workspace was `w-3/5` / `w-2/5` **with no breakpoint at all** → 234px
  of menu beside 156px of tab

`restaurant-phone` (iPhone 14) added. It found a third defect on its first run
([[shopos-full-screen-pinned-room]]).

Also: the **tab workspace had never been walked by any browser**. It is in
`food.chrome.spec.ts` now, which required `SCREENS.path` to become a function
(`/tenant/dine-in/tickets/:id` needs the fixture's id) — and that broke
`everyScreenIsWalked`'s literal-only parser.

**How to apply:** when adding a device project, ask which device the SCREEN is
actually held on, and add the narrow one — the wide one hides nothing.
See [[shopos-screen-testing]], [[shopos-tablet-chrome]].
