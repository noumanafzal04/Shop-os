---
name: shopos-responsive-backlog
description: "TO FIX (reported 2026-09-03 by the user on a real device) — purchases/suppliers screens' buttons on a phone, and the POS bottom footer on phone + tablet PORTRAIT"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-09-03T12:47:43.254Z
---

Two responsive defects the user found by holding the device. **Not yet fixed** —
they asked to keep them and fix them after the module work.

1. **Purchases / Suppliers and screens shaped like them** — on a phone the
   **buttons do not show properly**. "like this types screen" = the whole family
   of list-plus-actions screens in that area, not only those two.

2. **The POS bottom footer** — the totals/tender strip. Wrong on a **phone**,
   and also on a **tablet held VERTICALLY (portrait)**. **Tablet landscape is
   fine**, which is exactly why it was never seen: the e2e projects that walk
   the till were tablet-landscape first, and landscape is the shape that works.

**Why:** the user tests on real devices; both of these passed every green suite.
`chrome.spec` walks screens **at rest** and jsdom has no layout engine at all,
so a button that is present but clipped, or a footer that overlaps at one
breakpoint, is invisible to everything except a real browser at a real size.

**How to apply:** fix in the panel, then prove it in Playwright at the sizes
that were wrong — `phone` and `tablet-portrait`, not `tablet-landscape` — the
same way [[shopos-waiter-holds-a-phone]] added the phone project after "held in
a waiter's hands" was answered with an iPad and stopped there. Measure the
button and the footer, do not assert they exist. See also
[[shopos-tablet-chrome]] (one breakpoint, DRAWER_BELOW=1024) and
[[shopos-screen-testing]].
