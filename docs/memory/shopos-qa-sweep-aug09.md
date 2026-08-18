---
name: shopos-qa-sweep-aug09
description: "2026-08-09 four-tenant QA walkthrough — 9 unique bugs (4 P1, 5 P2) + 20 gaps; branch-receiving bug found twice independently"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-11T13:59:59.777Z
---

2026-08-09 QA sweep. Four tenants walked end-to-end through HTTP, one agent each:
food (restaurant), pharmacy, mart, books-only. **39 tests written, all green, every
one mutation-verified** (delete a step → must fail → restore). Files:
`tests/Feature/{Food,Pharmacy,Mart,BooksOnly}TenantWalkthroughTest.php`.

**Both owed audits RAN 2026-08-12** (inline, not via workflow) and are closed.
Migration audit: `migrate:rollback` was broken — two migrations dropped a column
an index still named. Fix order is driver-specific: constraint → index → column
satisfies BOTH (SQLite blocks on the index, MySQL blocks on the FK). CI now runs
up → down → up. POS audit: no defect; four things looked wrong and were not
(checkout DOES surface errors, DOES send an idempotency key regenerated per cart
change, underpayment and schedule-drug blocks are server-side).

**CORRECTION 2026-08-12:** I claimed a cash sale with no shift was ungated and
an open product decision. WRONG — `pos_require_shift` already exists, is
enforced in `SaleController::store` (409 SHIFT_REQUIRED), is tested in
`MultiTerminalPosTest`, and has a toggle on Shop Settings → POS. Ships OFF on
purpose so a one-person shop is not refused on upgrade day. I misread it by
looking at `CreateSaleAction` instead of `SaleController` — the gate lives at
the controller. The 96 failures were from enforcing it unconditionally, not
from the rule being unwanted. Do not rebuild this.

## STATUS 2026-08-11: ALL NINE FIXED, verified in code.

Re-checked each one against the source rather than trusting this file, which
had said "none fixed" long after they were. #1 `ReceivePurchaseOrderAction`
takes `BranchContext` · #2 `SupplierPayment` is its OWN cashbook column and is
in the opening balance · #3 the suppliers feature gate is gone · #4
`ExpenseBudget` falls to `whereNull('branch_id')` in the all-branches view ·
#5 `lowStock(BranchContext)` · #7 the `/sales` prefix carries
`feature:pos,marketplace,products,services` · #8 `expiring(BranchContext)` ·
#9 migration `2026_08_10_000003_the_floor_belongs_to_a_branch`.

## P1 — all four fixed (see status above)

1. **Receiving ignores the operating branch; every delivery lands on Main.**
   Found INDEPENDENTLY by the mart and pharmacy agents — strongest signal in the
   batch. `ReceivePurchaseOrderAction:116` calls `inventory->adjust()` with no
   `branch_id`; `InventoryService:92` falls back to the default branch. Same in
   `BatchController`. There is **no API path at all** to receive into a
   non-default branch.
2. **Supplier payments never reach the cashbook or ledger.**
   `RecordSupplierPaymentAction` writes a SupplierPayment + drawer movement but
   creates no Expense, and `ReportService::cashbook` only sums Expenses. A mart's
   biggest weekly outflow shows as `money_out` = 0.
3. **A books-only tenant can never fill in "Paid to".** `StoreExpenseRequest`
   validates `supplier_id` and the list eager-loads `supplier:id,name`, but every
   `/suppliers` route is gated on the inventory feature. The one tenant whose
   whole product is the expense list can't record who it paid.
4. **A branch budget becomes the company ceiling.** `ExpenseBudget::inForce()`
   filters by branch only `when($branchId !== null)`; the all-branches view passes
   null, so a branch-scoped ceiling applies company-wide.

## P2

5. Reorder list not branch-scoped (`InventoryController::lowStock` takes no
   BranchContext; `products.stock_quantity` is the sum across branches).
6. **FIXED 2026-08-11.** A cashier could read every item's buying price.
   `Permissions::READS_COST` (products/purchases/inventory.manage + reports.view)
   plus the `HidesCostPrice` concern on **both** Product and ProductVariant — a
   variant carries its own cost and rides inside the product, so guarding only
   the parent moves the leak down a level. Guarded at `toArray()`, not `$hidden`
   or a select, so attribute access still costs a sale line. `wholesale_price`
   deliberately NOT hidden: it is a SELLING price the POS reads for the
   wholesale level, and stripping it silently removes wholesale selling.
   `CostPriceVisibilityTest`, 10 tests, three mutations checked.
7. Sale READS have no module gate — books-only shop gets an empty Sales screen
   instead of 403. `POST /sales` does gate; the GETs don't.
8. Pharmacy expiry **tile is branch-scoped, the screen it links to is not**.
9. Dine-in floor + kitchen board are not branch-aware while the money is —
   `dining_tables` / `restaurant_tickets` / `kitchen_tickets` have no `branch_id`.

## Gaps (built nothing, not broken)

No stock write-off/wastage (STOCK_EXPIRED tells the pharmacist to remove it with
nowhere to record it) · no supplier credit note for short-dated returns · no
near-expiry notification (pull-only) · no coursing or seat numbers on restaurant
tickets · no 86/sold-out toggle · reservations + inventory OFF by default for
restaurants · station names free text on both sides, a typo silently routes to
the first station · no budgets CSV export · no recurring income · no receivables
side · reorder list not connected to purchasing.

Relates to [[shopos-multi-branch]] — most P1s are the same root cause: branch was
added to money but not to stock or the floor. See also [[shopos-audit-backlog]].
