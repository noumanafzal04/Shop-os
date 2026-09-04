---
name: shopos-responsive-backlog
description: "BOTH FIXED (2026-09-03/04) — purchases/suppliers buttons on a phone, and the POS footer on phone + tablet portrait; the empty-state clipping is what is left"
metadata:
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-09-04T00:00:00.000Z
---

Two responsive defects the user found by holding the device. **Both fixed.**

1. **Purchases / Suppliers and screens shaped like them** — buttons broke
   mid-phrase on a phone ("+ New purchase order" was a three-line slab). Fixed
   by `whitespace-nowrap` on the shared `<Button>` plus `flex-wrap` on the nine
   page headers that lacked it. See [[shopos-button-submit-default]] for the
   other one-line change to that component.

2. **The POS bottom footer** — four rows at 360, three at 390. Now two honest
   rows with the split STATED rather than wrapped; see
   [[shopos-bar-a-hand-can-use]].

**Why nothing had caught either:** `chrome.spec` walks screens at rest and asks
"is anything covered / off the edge / too small". A wrapped button is none of
those — it is fully visible, fully inside the viewport, and enormous. jsdom has
no layout engine at all. `e2e/controls-fit.spec.ts` exists to ask the second
question: not "is it broken", but "is it usable".

**Still open from the same device session:** a table's empty-state message
(`No purchase orders yet.`) is `text-center` inside a `min-w-[48rem]` table, so
on a phone it is centred at 384px in a 390px window and mostly off-screen —
~25 places, reported to the user, not yet fixed. The fix needs an element inside
the cell that is sticky-left and the width of the SCROLLPORT (container query
`100cqi`), not of the table.

Related: [[shopos-waiter-holds-a-phone]] · [[shopos-tablet-chrome]] ·
[[shopos-screen-testing]] · [[shopos-page-behind-overlay]]
