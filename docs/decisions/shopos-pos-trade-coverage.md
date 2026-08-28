# POS coverage by trade — what exists, what is missing

**2026-08-28 · reference note. Nothing here is a commitment to build.**

Filed from a suggested "POS core + per-trade edge cases" map covering 27
business types. The map's architecture recommendation — *one transaction
engine, capability-based business modules, industry rules on top* — is the
architecture CartZe already has (`Modules`, `itemTypesFor`, `NEEDS_MODULE`,
per-trade settings gating). So the value of the list is not the shape; it is
the **checklist**.

Audited against the codebase below. Three columns of truth:

- **HAVE** — shipped and tested
- **PART** — some of it exists, named gaps
- **NONE** — nothing in the codebase

## POS core

| Capability | State |
|---|---|
| Barcode / SKU / PLU search, scale barcodes | HAVE |
| Cart, quantity, weight quantity | HAVE |
| Single / pack / carton units | HAVE |
| Variants and sizes, per-size price and stock | HAVE |
| Multiple prices, customer-group pricing, price tiers | HAVE |
| Discount, discount ceiling, permission to exceed | HAVE |
| Promotions, BOGO, coupons, combos | HAVE |
| Tax inclusive/exclusive, tax groups | HAVE |
| Cash / card / bank / split / partial, change, rounding | HAVE |
| Khata (credit) with limit and statement | HAVE |
| Hold and resume cart, drafts, quotes | HAVE |
| Sale return, exchange, void, refund | HAVE |
| Invoice reprint, duplicate-copy control | HAVE |
| Cashier shifts, drawer, X/Z read, blind close, relief cover | HAVE |
| Offline sale + sync, outbox, device registry | HAVE |
| Manager approval / permission-based actions | HAVE |
| Branch, lane, receipt printer, scanner, drawer kick | HAVE |
| Audit log | HAVE |
| **Wallet as a tender** | NONE — tenders are cash/card/bank_transfer/credit/other |
| **Loyalty points earn/redeem at the till** | HAVE |

**Core verdict: complete.** Only a named "wallet" tender is absent, and that is
a label on the existing `other` rather than a mechanism.

## Per trade

| Trade | State | What is missing |
|---|---|---|
| Grocery / mart / retail | HAVE | — |
| Restaurant / café | HAVE | Course & seat numbers; comp item (void exists) |
| Pharmacy | HAVE | Recall by batch |
| Electronics / mobile | HAVE | Installments / running balance beyond khata |
| Garments, shoes, cosmetics | HAVE | Variant **matrix** entry (colour × size grid) is one-at-a-time |
| Wholesale | HAVE | — (tiers, credit limit, min qty all present) |
| Petroleum | HAVE | — (pumps, nozzles, dips, meter, rate history, shifts) |
| Automotive / tyres | HAVE | — (vehicle, DOT dating, trade-in, warranty) |
| Hardware / building material | PART | Cutting / partial-length sale; square-foot and custom measures |
| Auto parts | PART | Part number, OEM number, alternates, vehicle compatibility |
| Bakery | PART | Recipes and wastage exist; **production batches** and pre-orders do not |
| Services / salon | PART | Service + staff + commission exist; **no appointments — a standing product decision, not a gap** |
| Bookstore | PART | ISBN is a barcode; no edition/author/publisher fields |
| Meat / fish / poultry | PART | Weight and scale exist; custom cuts, grade, by-products do not |
| Furniture | NONE | Custom dimensions, fabric choice, production status, advance + balance |
| Jewellery | NONE | Gross/net weight, purity, live gold rate, making charges, wastage, buyback |
| Gym / membership | NONE | Membership term, renewal, freeze, attendance |
| Laundry / mobile repair / printing | NONE | **Job tickets** — take in, track, notify, collect |
| Mandi / arti | NONE | Farmer, commission, deductions, settlement — not a checkout at all |

## The three real gaps, ranked

Everything above collapses to **three missing mechanisms**, each unlocking
several trades at once:

1. **A job ticket.** Take an item in, track it through stages, notify, hand it
   back, take payment on collection. Unlocks laundry, mobile repair, printing,
   tailoring, and furniture's production status. The dine-in tab is already
   most of this shape — an order that stays open across time — which makes it
   the cheapest of the three.

2. **Measured and custom line items.** A length cut from a roll, a square-foot
   calculation, a weight with a custom cut. Hardware, meat, fish and fabric all
   want the same thing: a quantity the cashier computes at the counter and a
   price derived from it.

3. **Rate-driven pricing.** A price that comes from a rate times a measure at
   the moment of sale rather than from the catalog — jewellery's gold rate is
   the pure case, and petroleum's fuel rate is the one already built. **The
   forecourt already does this**, which means the pattern exists and would be
   generalised rather than invented.

Membership/gym is a fourth, smaller one and overlaps with subscriptions.

## What NOT to build

- **Appointments and bookings.** A standing product decision. Salon, gym and
  car wash all appear in the map wanting them; the answer remains no.
- **Twenty POS screens.** The map says this and it is right — CartZe's till is
  one screen whose capabilities are gated by trade, and every "specialised POS"
  above is a capability on it, not a new till. The forecourt is the single
  exception and it earned it.

Related: [[shopos-business-priority]], [[shopos-no-roles]],
[[shopos-job-offered-must-be-doable]].
