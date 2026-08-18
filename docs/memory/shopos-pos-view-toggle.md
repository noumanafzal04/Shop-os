---
name: shopos-pos-view-toggle
description: "POS tiles/rows is now a per-DEVICE choice (terminalStore.posView, null = trade default), not a verdict from business_type. Tiles gained the stock rule rows always had."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T11:50:52.388Z
---

`posLayout = isRestaurant ? "grid" : "list"` was the only answer a shop could
get. Now two buttons beside the POS search box **at every width, desktop
included** — the two views answer different questions ("which one is it?" vs "is
it in stock, and at what price?"), and that depends on the counter, not the
trade.

**Stored per DEVICE** in `terminalStore.posView` — same place as the lane and
the number pad, same reason: it is a fact about the screen and the person at it.
`null` = follow the trade default, and null is what every existing till holds,
so nothing changed for anybody until they press it.

**The bug the toggle nearly shipped:** rows have always had
`disabled={out}`; tiles never did. Invisible while tiles were food-only (a
kitchen counts nothing) — a way to sell stock you don't have the moment a
pharmacy could choose them.

**Why it matters beyond this screen:** *a view is a way of LOOKING at the shop;
it does not get its own idea of what may be sold.* Whenever an alternate render
of the same data becomes reachable by a new audience, re-check its guards
against the original's.

Tiles also gained the stock figure rows always showed.

Related: [[shopos-pos-ux]], [[shopos-tablet-chrome]], [[shopos-hardware]].
