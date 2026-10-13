---
name: shopos-zari-clothing-qa
description: 2026-10-13 — a clothing shop (Zari Clothing) made and lived by hand in the dev DB; 7 bugs fixed, 4 DECISIONS AWAIT THE USER (sale price ignored by sizes, profit on a cashier's dashboard, backfill of missed costs, hold label = customer), and the rest of its life NOT yet walked
metadata:
  type: project
---

Zari Clothing — tenant `01a13400-93e4-7396-9310-d3c516185859`, retail · garments, plan Pro, all 21 modules, DEV DB only, made through the app. Owner `sana@zariclothing.test` / `Zari-pass-1`; staff `bilal@` cashier, `usman@` stock keeper, `farah@` accounts, `hina@` manager — all `@zariclothing.test` / `Staff-pass-1`. Two shifts are still OPEN (Sana float 5,000; Bilal float 2,000) and Bilal's cart holds a kurta with a Rs 500 discount.

Record: `docs/decisions/shopos-a-clothing-shop-lived-by-hand.md`; list `docs/qa/journey/RUNS.md` #195–211. Scratch scripts: `scratchpad/dev/panel/e2e/.qa*.mjs` (kit `.qa.mjs` records every API call and can ask the server as the signed-in person); findings `scratchpad/qa/FINDINGS.md`.

**Awaiting the user's decision (asked 2026-10-13):**
1. A design "on sale" with sizes is charged FULL price (list and till tile say 4,990, the bill is 5,490). Make the sale reach the sizes, or stop showing/accepting it?
2. Cashier / stock keeper see Today's Profit + Expenses on the dashboard (no permission check there at all).
3. Backfill `sale_items.unit_cost` for sized lines sold before the fix, from today's cost?
4. Hold's "Whose ticket is it?" text becomes the sale's customer name.

**NOT walked yet (the user stopped to push):** returns + exchange by the owner, khata payment, PO received by the stock keeper (verifies the stockroom fix in a browser — the supplier form has no labelled Name field, my probe died there), expenses/income/cashbook, shift + day close for both drawers, phone/online orders, coupons, quotes, stocktake, labels. Tablet/phone/trade/admin/journey browser projects were not run against this code.

**How to apply:** when asked to "test like a real shop", do THIS — make the shop through the forms, add each day up by hand first, then read every screen and the server and compare. All seven bugs were figures or offers that existing specs never asserted. Related: [[shopos-outcome-not-coverage]], [[shopos-half-a-rule]] (four of the seven were a rule fixed in one place and left standing beside it), [[shopos-kept-not-asked]].
