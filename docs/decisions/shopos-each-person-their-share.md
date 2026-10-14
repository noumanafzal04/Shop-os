# Each person their share — and a press that records once

**Date:** 2026-10-14 · fixes for cloud tester passes 2 and 3 (`docs/qa/BUGS.md`)

The tester probed every shop route as every staff set (4,341 calls) and walked
the offline cases on the built app. What came back was mostly one fault in
several places: a figure the screen hid was still in the answer.

## What is sent, to whom

| Figure | Sent to | Where |
|---|---|---|
| Cost on a line (sale, order, tab, count, disposal, batch, fuel delivery, PO line) | READS_COST | `HidesCostPrice::costKeys()` on each model (B38) |
| Dashboard takings, recent sales, till | sales.manage or reports.view | `DashboardService::asSeenBy` (B39) |
| Highlights (leaders by revenue, staff ranked) | reports.view | same |
| Khata owed to the shop | customers.manage or reports.view | same |
| What the shop owes suppliers — dashboard, supplier balances, an order's total / paid / status | `SEES_SUPPLIER_MONEY` = suppliers.manage, purchases.manage, reports.view (owner, Q9) | `HidesSupplierMoney` on Supplier and PurchaseOrder |
| Audit feed | READS_AUDIT | `asSeenBy` |
| Every place side by side | the owner; staff keep their own place's row | `asSeenBy` |
| Subscription (plan, payments to the platform) | settings.manage (owner, Q7) | route + screen map |

The rule, as before: null (or an empty list) — not zero, which is a figure — and
the screen draws nothing around what never arrived. A supplier balance that was
never worked out is null too (B46: it read 0 inside an order).

## Other rules

- **Sent food is a supervisor's to void** (B40). A line never sent is the
  waiter's; once fired, voiding it or cancelling its tab needs sales.void, and
  `voided_by` is kept.
- **Tank fuel comes in by tanker only** (B41, owner). Refused on a purchase
  order when it is made and when it is received, for everyone. The pharmacist
  still receives medicine (batches are their job).
- **A split or khata sale can come back** (B03, B04). Cash for a split sale; for
  khata the part still owed comes off the account first, and the sheet says so.
- **One press, one record** (B07). `AnswerOnce` middleware + `answered_requests`:
  the first answer kept against (user, key); the same key gets it again; a second
  press in flight gets 409; a refusal releases the key. Seven forms send a key
  (`useOnceKey`): khata payment, supplier payment, expense, income, document
  deposit, bank deposit, exchange.
- **The receipt adds up** (B08). `discount` already holds the promotion; the
  coupon line is the rest; the bank's share is named and is never a balance due.
- **The exchange sheet asks the server** (B31) what the replacement comes to, so
  automatic promotions are in it; the local estimate is gone.
- **One synced sale cannot sink the batch** (B48). Each sale is validated on its
  own after the duplicate check; a sale whose product is gone is FAILED, not
  retried; the till splits a batch the server refused as written.

## Waiting

- **Q10 (B47)** — an offline sale at a price that changed meanwhile is refused,
  because the server re-prices offline sales on purpose. Recommended: record it
  as rung, the difference shown on the sale and flagged for the owner.
- **B01** — the cashier's drawer with a supervisor PIN (owner's answer), to build.

## Proven

Each fix has a test that fails with it taken out (mutations: B38 3, B39 8 + panel
3, B40 5, B41 4, Q9 5, Q7 1, exchange warning 2, B03/B04 3, B07 5, B08 4, B48
server 3 + both price layers 1 + till 3). Five gates exit 0.
