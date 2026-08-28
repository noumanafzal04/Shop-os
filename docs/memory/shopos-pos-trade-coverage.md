---
name: shopos-pos-trade-coverage
description: REFERENCE — POS audited against a 27-trade case map; core is complete, and every gap collapses to 3 mechanisms (job ticket, measured lines, rate-driven pricing)
metadata:
  type: reference
---

A suggested "POS core + per-trade edge cases" map (27 business types) was
audited against the codebase. **Not a commitment to build** — the user asked
for it to be recorded and listed.

**The map's architecture recommendation is what CartZe already is**: one
transaction engine, capability-based modules, industry rules on top
(`Modules`, `itemTypesFor`, `NEEDS_MODULE`, per-trade settings gating). So the
value is the checklist, not the shape.

**POS core: complete.** Barcode/PLU/scale, packs, variants, tiers, discounts +
ceiling, promotions/BOGO/coupons, tax groups, split/partial tenders, khata,
hold/quote, return/exchange/void, reprint control, shifts/drawer/blind
close/relief cover, offline+sync, permissions, hardware, audit. Only a named
**wallet tender** is absent (a label on the existing `other`).

**Fully covered trades:** grocery/mart/retail, restaurant, pharmacy,
electronics, garments/shoes/cosmetics, wholesale, petroleum, automotive/tyres.

**Every remaining gap collapses to THREE mechanisms:**

1. **Job ticket** — take in, track stages, notify, hand back, pay on
   collection. Unlocks laundry, mobile repair, printing, tailoring, furniture
   production status. **Cheapest**: the dine-in tab is already this shape.
2. **Measured / custom line items** — a length cut from a roll, square feet, a
   custom cut by weight. Hardware, meat, fish, fabric all want the same thing.
3. **Rate-driven pricing** — price = live rate × measure at sale time.
   Jewellery's gold rate is the pure case; **petroleum already does exactly
   this**, so it would be generalised, not invented.

(Fourth, smaller: membership/gym terms — overlaps subscriptions.)

**Explicitly NOT to build:** appointments/bookings (standing decision — salon,
gym, car wash all ask for them; answer stays no), and twenty separate POS
screens (the forecourt is the one earned exception).

Full table in `docs/decisions/shopos-pos-trade-coverage.md`.
See [[shopos-business-priority]], [[shopos-job-offered-must-be-doable]].
