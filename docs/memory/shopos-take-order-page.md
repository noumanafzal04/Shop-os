---
name: shopos-take-order-page
description: take-order modal → page (like New Sale); browsable catalogue with Show-more; stock on the tile; "only 0 in stock" now names the item
metadata:
  type: project
---

2026-08-26, on the user's report ("card taking too much space", "modal main
bilkul acha ni lg raha", "jaise new sale ka page hai").

**Take an order** is now `/tenant/orders/new`, laid out like New Sale: items
left, customer + total right. The catalogue is **browsable** — first page on
load (24), search narrows, `Show more — N to go` appends. It used to be the
whole catalogue in a 160px scroller inside a modal, showing one page of 15 with
nothing saying more existed.

**Stock is on the tile**: an item with none is disabled and cannot be added; a
basket line over stock says so on the line. Behind it, `InventoryService` no
longer throws `"Insufficient stock: only 0 in stock."` — it **names the item**.
That message reached the till, the order form and transfers, and a basket of
nine told the shop one was short without saying which.

**Orders list** is a table, not cards (also the user's report): row = choose,
click = work. Columns step down at `sm`/`xl` — NOT `md`, because the rail takes
290px from `lg` up, so a 1024 tablet has less page than a 768 phone in
landscape. Measured at six widths; 768 was 87px over until fixed.

**How to apply:**
- Dense operational lists = table + detail panel. Cards only where the visual
  IS the content (marketplace products).
- Any picker over a paginated endpoint needs first-page-on-load + search +
  Show-more with a REMAINING count.
- Show the constraint (stock) where the choice is made, not in the refusal.

Related: [[shopos-half-a-rule]], [[shopos-one-filter-bar]],
[[shopos-tablet-chrome]], [[shopos-guards-share-a-blind-spot]].
