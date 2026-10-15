# Tester report — pass 5 (part): Phase 2 leftovers and the start of Phase 5

Comes after the pass-4 report (`TESTER-REPORT-2026-10-14-pass-4-retests.md`, bugs B52–B60). Stopped early by the user
(credit). Next bug number: B63. (Saved by the fixer from the report the user handed over. After this the tester's
credits ran out; the local session tests and fixes from here on.)

## Header

| | |
|---|---|
| Commits tested | backend `5e2bcf6`, panel `3835cbb`, docs `8ead13d` (same as pass 4) |
| Stack | Own stack (PHP 8.4, MySQL 8.4, backend :8000, panel :5177) |
| Shops and people | CarePlus Pharmacy (Rehan, pharmacist) · Johar Café & Grill (owner) |
| How | qa-kit UI, figures read back from the API |
| Change to the café | The admin switched the café's Inventory module ON (PUT /admin/tenants/{id}/modules) — a recipe needs it. |

## Summary for the fixer

| ID | P | Area | One line |
|---|---|---|---|
| B61 | P3 | PO receive sheet (medicine) | "Expiry *" is marked required, but "Receive → stock in" can be pressed with it empty → 422 EXPIRY_REQUIRED; the whole delivery is refused |
| B62 | P2 | Till / ingredients | An ingredient with no price (QA Flour kg, price 0) is offered on the till catalog and in till search at 0. Nothing marks an item "ingredient — not sold". |

| Item | Result |
|---|---|
| Pharmacist receives a real PO with batches (§5b) | PASS |
| Recipe: stock goes down by the ingredients (Phase 5) | PASS |
| "Ingredient — not sold" item (Phase 5) | FAIL / NOT BUILT — B62 |
| Screen walks: waiter, pharmacist, forecourt attendant, purchasing (§5b) | NOT TESTED — ran on an expired saved sign-in (every screen landed on /signin); stopped before a re-run |

**Pharmacist receives a real PO with batches.** Rehan received PO-000121 from the screen ("Receive with details…"):
Panadol (10) 20 received, batch QA-PN-1, expiry 2027-12-31; Panadol (200) 6 of 10 received, batch QA-PN-2, expiry
2026-11-20. PO partially_received. Stock 156 → 176 and 389 → 395. Both batches stored with expiry; QA-PN-2 shows on
Rehan's expiring list.

**Recipe.** Café, QA Paratha with a recipe of 0.1 kg QA Flour: 3 sold (INV-000574) → flour 10 → 9.7; 1 returned →
9.8. The line's unit_cost is 12 (0.1 kg × 120).

## Bug details

**B61 · P3 · Medicine receipt can be sent with no expiry.** Rehan, Purchases → PO-000121 → Receive with details. Fill
line 1 fully, leave line 2's expiry empty, press "Receive → stock in". Expected: the button is held, or the screen
points at the empty field. Actual: enabled; POST /purchase-orders/{id}/receive → 422 EXPIRY_REQUIRED "An expiry date
is required to receive "Panadol 500 mg Tablets (200)""; nothing received, line 1 included; console error. Cause:
`panel/src/modules/purchases/pages/PurchaseOrdersPage.tsx:107-110` — `receiveBlocked` checks serials only; the
expiry field (~line 470) is marked * but never checked. Fix direction: hold the button while any medicine line with
a quantity has no expiry, and mark the field.

**B62 · P2 · An ingredient is sold on the till at 0.** Café owner made QA Flour kg (price 0, cost 120, stock 10) as a
recipe ingredient. GET /pos/catalog includes it; GET /products?search=QA Flour&is_active=1 (the till's search)
returns it at 0.00; the product form has no "not sold" / "ingredient only" option. Expected (brief Phase 5): an
item that is only an ingredient is not offered at the till. Not proven yet: ringing it up (the script failed before
it sent the sale). Fix direction: a "not sold — ingredient only" flag that keeps the item off the till and the
storefront and refuses it on a sale; or at least refuse a sale line with no price.

## What is left — for the local session

- Screen walks for waiter (Waqas, café), pharmacist (Rehan), forecourt attendant (Javed), purchasing (Imran): menu +
  every screen typed in, no 403 or console error. Script: `p2-menus.mjs` (delete the saved sign-ins first).
- B62: ring the ingredient at the till — does a 0 sale go through?
- Phase 4 item 7 at full size: 100+ sales in one day.
- Phase 5 (restaurant), the rest: waiter on a phone (table → order with sizes + questions → kitchen → served → bill →
  split → paid); void after the kitchen has it; a dish refused; table moved; reservations; delivery with a rider
  (accept, deliver, COD); takeaway; café counter; `npx playwright test --project=journey`.
- Phases 6–11 as in TESTER-BRIEF §6: pharmacy FEFO and expired batch refused, the other trades, platform admin and
  billing, bad network and security, volume, phone and tablet.
- Re-test after the fixer's push: B52–B62.

Data left in the tester's stack: Pharmacy PO-000121 partly received (QA-PN-1, QA-PN-2). Café: Inventory module on;
QA Flour kg; QA Paratha; INV-000574 with 1 returned.
