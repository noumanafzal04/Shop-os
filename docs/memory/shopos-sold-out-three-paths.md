---
name: shopos-sold-out-three-paths
description: "FIXED 2026-08-20: 'eighty-six' was enforced only by the till — the app AND the dine-in tab both sold what the kitchen had taken off. Found by grepping for a scope with zero callers"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-20T06:39:03.704Z
---

**2026-08-20.** `sold_out_at` — "eighty-six the fish" — has its own column, its
own controller, its own permission and eight tests. **All eight ask the till.**

The question a shop asks is **may this be sold right now**, and this codebase
had three places that can start selling an item:

| path | what it did |
|---|---|
| `CreateSaleAction` — the counter | refused, `ITEM_SOLD_OUT` |
| `OrderService::place` — the app, and the phone order | **took the order** |
| `AddTicketItemsAction` — the dine-in tab | **printed the kitchen ticket** |

So the cook presses 86, the till stops offering the fish, and the delivery app
keeps taking orders for it all evening while a waiter puts it on table six.

**What made it worse than an omission.** `CreateSaleAction` *deliberately
exempts* the trusted path from this rule and says why: an online order is food
the customer already committed to, and refusing to bill it because the kitchen
has since run out is a shop that cannot close its own tab. Right reasoning —
and safe **only if placement refused first.** Placement never did, so for an
online order the rule was enforced at neither end.

> **A comment that assumes another path did the work is a dependency, and an
> unchecked dependency is a hope.**

**How it was found — worth reusing.** Not by a test and not by reading
`SoldOutController`. By noticing `Product::scopeSellableToday()` had **one
definition and zero callers**.

> **A scope nobody calls is a rule nobody enforces.** Grep for callers on any
> flag that matters.

**The fix, three parts:**
1. `OrderService::place` refuses — marketplace AND phone order.
   `visible_in_marketplace` is relaxed for a shopkeeper on the phone because
   publishing is their business; **running out is not a publishing decision.**
2. `AddTicketItemsAction` refuses unconditionally — adding a line to a tab is
   always *more food*, never the closing of a bill (settlement goes through
   `SettleTicketAction`, not here).
3. `MarketplaceController::publicProduct` publishes `sold_out` — **published,
   not filtered out**, same choice the POS mirror already made: a dish that
   vanishes from a menu is indistinguishable from one the shop never sold, and
   the flag comes off tomorrow.

An order placed **before** the press still completes. That is the reason the
exemption exists, and it now has a test holding it down.

**Tests:** 5 new in `SoldOutTest` (4 red before the fix, the 5th green before and
required to stay green). Sweep phase R asks it of **every** shop — 86 the item,
watch the counter refuse, watch the app refuse, **then put it back and order it
again**. Without that last step there is no telling "refused because it is sold
out" from "refused because this shop is shut": the refusal has to be *caused by*
the flag, not merely coincide with it.

Related: [[shopos-the-customer]], [[shopos-sold-out-and-reachability]],
[[shopos-detector-vs-rule]], [[shopos-reachability-rule]]
