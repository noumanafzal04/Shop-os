---
name: shopos-page-two-per-list
description: FIXED — 3 more page-two bugs inside unreachable-pages.py's own stated limit (folder credit, not list); scanner gained per-CALL and orphan-hook axes
metadata:
  type: project
---

`unreachable-pages.py` had carried this in its docblock since it was written:
the escape hatch is credited to a **folder**, not to a **list**. Three defects
were sitting in that gap.

- **customer reservations** — server `paginate(15)`, client
  `reservations: () => apiGet(…)` with no argument. The rows that fall off are
  the OLDEST, which is where a forgotten hold sits: stock held off a shelf for
  somebody whose only way to cancel has scrolled away.
- **`useMyOrders`** — hook took a page and kept previous data; the screen called
  it bare and rendered no pager. Built, tested, wired to nothing. Eighth time.
- **stocktake** — `useStockCounts()` sent no page against `paginate(25)`, and the
  folder passed as "search only" by crediting the item lookup on the count SHEET
  next door. See [[shopos-scanner-own-blind-spot]] — same shape as the workshop
  board.

**Two new axes**, both mutation-tested: can this CALL's request ask for anything
but page one (needs no attribution at all), and does any hook offer a page nobody
asks for.

**The detector cost more than the fixes, and every step was the same class:**

- 6 findings, **5 of them the detector's fault** — the page was one function away
  (`params: toParams(filters)`) or in the caller's filter type.
- Widening the resolver made it **blind**: folding every capitalised word after a
  colon swallowed `apiGet<CustomerReservation[]>`'s own type. The mutation that
  proves the check works slipped through **twice**.
- A 500-char window is not a unit of meaning — `marketplaceService` keeps
  `reservations` beside a shop SEARCH. The window is now exactly one member.
- **`if ".test." in f.name is False`** — Python parses a chained comparison, so
  it is always False and the file list was EMPTY. Printed "0 hooks" and looked
  clean, including against the mutation. See [[shopos-detector-vs-rule]].

`--prove` now blinds all three by INPUT rather than skipping them: a check that
is stepped over cannot be told apart from one that is broken.

**Still not covered:** the folder "search only" verdict can still be borrowed
from the wrong screen. Fixing it needs to know which call feeds which rendered
list, which regex cannot answer — a stated limit, not a hidden one.

## 2026-09-02 — the fourth time, in the admin console

`admin/enquiries` and `admin/shop-requests`: both `paginate(25)`, both **oldest
first by design** ("the person who has waited longest is the person to answer
next"), and neither had a pager. The ordering is what makes it permanent — once
25 pile up, page one never changes again, so a visitor asking for a walkthrough
is never seen and a demo pressing **Keep this shop** (a business asking to
start paying) sits behind 25 others for ever.

The headline count was wrong too, in the one place it IS the screen:
`unanswered` / `waiting` were `list.length`, which caps at the page size — an
admin with sixty waiting was told **25**. Read the pagination total, not the
rows on screen.

**And the scanner had its own blind spot.** Removing a dead hook made
`marketplace/shops/{slug}/products` look "named by no screen" — the **phone app**
calls it. `unreachable-pages.py` read the panel only, and the natural next step
from "nobody names it" is to delete it. It now reads `shopos-mobile` too, and
blind mode blinds the phone as well so `--prove` still holds.

