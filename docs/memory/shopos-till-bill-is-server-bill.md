---
name: shopos-till-bill-is-server-bill
description: STANDING: the till's amount due comes from tillBill.ts only, held to server fixtures; expected_payable + payable (not amount_due) on refusals
metadata:
  type: project
---
2026-10-05 fix for "Amount due Rs 12,610 / Sale failed … total 14,023.94". PosPage had an inline copy of pricing that drifted 5 ways (tax group, rounding, customer group % + level never applied, cash+trade-in rounded, all-cash split not rounded).

Now: `panel/src/modules/pos/tillBill.ts` is the ONLY bill; `TillBillFixturesTest` (backend) rings 22 real sales → `tests/fixtures/till-bill.json` → copied to `panel/src/modules/pos/fixtures/`; `tillBill.test.ts` replays them. Till sends `expected_payable` ONLINE ONLY (never in the offline queue); server refuses `BILL_MISMATCH`. All bill refusals carry `meta.payable` — the till reads `payable`, NEVER `amount_due` (amount_due is after bank share and includes trade-in → double-charged battery / infinite bank loop).

**Why:** the tested engine ran only as a shadow while the cashier read the untested copy ([[shopos-outcome-not-coverage]]); TaxTest paid Rs 1,000,000 on every sale so short could never fail.
**How to apply:** any new term on a bill (tip, charges, rounding rule) goes in tillBill AND a TillBillFixturesTest case; browser money specs pay the EXACT figure shown (e2e/till-tax, till-tenders, till-members). A line's `price_level` undefined = follows customer group; explicit retail is sent as "retail".

Also found the same day: `PromotionService::preview` was a THIRD copy (shelf price × qty). Preview now accepts display-only `items.*.line_total`; offline the screen uses `promotionLocally` (same engine as the queued sale). Browser proof: `e2e/till-promo.spec.ts` (product-scoped promo on "E2E Promo Item" so no other spec's bill moves).
