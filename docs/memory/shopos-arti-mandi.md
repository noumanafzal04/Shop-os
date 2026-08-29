---
name: shopos-arti-mandi
description: BACKLOG idea — Arti/Mandi (grain commission agent) as a separate vertical reusing the core; NOT a POS shape; not started
metadata:
  type: project
---

Proposed 2026-08-29, **not started, no code written**. The Pakistani grain-market
commission agent (آڑھتی). Recorded because it is the first proposed vertical
whose primary screen is genuinely NOT a cart.

**Workflow:** farmer brings maal → weighing (kanta) → quality/grade → mandi sale
or auction → commission + expenses deducted → settlement → farmer khata → payment.

**Why it is a separate vertical, not a business type:** the main screen is
`Arrivals → Weighing → Sale → Settlement → Khata`. There is no barcode, no cart,
no receipt in the POS sense. Forcing it into the till would be the mistake.

**What the core already gives it (large reuse):**
- Parties — `Customer`, `Supplier` exist; farmers are a party type.
- **Khata is already built** (`CustomerLedgerEntry`, sell-on-credit) — opening
  balance, running balance, statement. This is the module's heart and it exists.
- Payments (manual/recorded, no gateway), Expenses (+ categories, budgets,
  recurring), Branches, Staff/permissions, Reports, audit trail.
- Advances/udhaar map onto the ledger model the same way loyalty did — see
  [[shopos-loyalty]].

**What is genuinely net-new:**
- Arrival record: farmer, commodity, bags, vehicle, gross/tare/net weight.
- Weighing slips (multiple weighings per arrival).
- Commodity + quality/grade/moisture/damage → deduction.
- Mandi sale: buyer, qty, rate, commission %, mandi charges, other deductions.
- Settlement sheet: sale value − commission − charges − transport − expenses −
  advances = farmer net.
- Reports: arrivals today, commodity-wise qty/sales, farmer & buyer balances,
  commission earned, outstanding advances.

**Judgement:** genuinely distinct from the three mechanisms in
[[shopos-pos-trade-coverage]] (job ticket / measured lines / rate-driven), though
it uses the last two — weight is a measured line, and the sale rate is set at
sale time. Real market, real gap, but a **whole vertical**, not a small feature.
Do not start it while the three cheaper mechanisms are unbuilt.

Standing constraint that still applies: no appointments/bookings.
