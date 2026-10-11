---
name: shopos-price-before-the-order
description: 2026-10-08 stage P online 7/7; checkout never showed delivery/minimum/free-threshold (on the wire, no screen); category key printed; new contexts inherit the spec's storageState
metadata:
  type: project
---

**Stage P** `panel/e2e/journey/27-online-the-order-from-the-street.spec.ts`
(JOURNEY_TRADE=online): shop terms set in Settings, bakes stocked at Inventory
(stage A gives EVERY module, so the online shop counts stock — "Out of stock"
on uncounted items was CORRECT, not a bug), a stranger finds it, a customer
signs up at /signup, checkout, shop stages + rider, rider settles, customer
cancels. 7/7. P2/P3/P3b re-runnable (P3 places nothing) → browser mutations.

**Faults (findings 90–95):** checkout never asked the shop anything — no
delivery fee, no minimum, no free threshold, offered delivery+pickup regardless;
`min_order_amount`/`free_delivery_threshold` declared on `PublicShop`, shown
nowhere ([[shopos-recorded-shown-to-nobody]] shape); refusal "add a bit more"
with no Rs; `business_category` key printed; My orders lines ≠ total, raw status.
Fix: `marketplace/orderTerms.ts` mirrors `OrderService` arithmetic.

**By design, don't "fix":** completed order's SALE = goods only; delivery fee
stays on the order and is the RIDER's (settlement shows rider_earned).

**Harness traps:** `browser.newContext()` in a spec INHERITS the file's
`test.use({storageState})` — a "stranger" was the owner. Pass
`{storageState: {cookies:[],origins:[]}}`. innerText glues adjacent spans
(`ORD-000001QA`) — match `/ORD-\d+/`. Basket "Remove all" asks to confirm.

Related: [[shopos-work-taken-in]], [[shopos-the-customer]], [[shopos-import-engine-v2]]
