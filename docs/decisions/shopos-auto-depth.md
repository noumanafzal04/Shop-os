---
name: shopos-auto-depth
description: "Automotive depth SHIPPED 2026-08-06 — trade-in buy-back (a tender, not a discount), vehicle record, DOT tyre dating"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-06T11:03:01.612Z
---

All three approved auto-depth items shipped 2026-08-06 (backend `9f882e1`, panel `e69543a`). Suite 1114 green.

**① Trade-in / buy-back — the money one.**
A trade-in is a **TENDER**, never a discount. Sale keeps its full total; a `trade_in` payment row carries the allowance; the scrap enters stock via `InventoryService`.
- `sale_trade_ins` table + `sales.trade_in_total` + `sale_returns.refund_trade_in`
- `PaymentMethod::TradeIn` — **not** an accepted client tender (`StoreSaleRequest` restricts methods); the server derives the allowance from `trade_ins[]` lines
- `TRADE_IN_EXCEEDS_TOTAL` (that's a purchase, not a sale), `TRADE_IN_NOT_STOCKABLE` (services can't be traded in)
- Three reversal invariants: **drawer** expects only the rupees (`DrawerMath` sums `refund_total - refund_credit - refund_trade_in`); **void** stocks the scrap back out; **full return** gives the old unit back and refunds cash only. **Partial return deliberately leaves the trade-in alone** — you can't hand back half an old battery.
- Tests: `tests/Feature/TradeInTest.php` (14)

**② Vehicle record.**
`customer_vehicles` (unique `tenant_id,registration`) + `sales.vehicle_id` + `sales.odometer`.
- Plates normalise on the way in (`CustomerVehicle::normalizeRegistration`) — normalise **before** the unique rule or a collision surfaces as a 500
- Sale points at the vehicle **directly**, not through the customer (fleets)
- `recordOdometer()` only ever moves forward
- `GET /vehicles/{id}/history` = visits + lifetime value; routes under `permission:customers.manage`, plus `vehicles-lookup`/`vehicles-quick` under `sales.manage` for the till
- UI gated on `businessType === 'automotive' || 'petroleum'` (same precedent as the retail warranty desk) — **no new module**

**③ DOT tyre dating.**
`product_batches.dot_code` + `manufactured_on`; `App\Support\DotCode` (WWYY → ISO week via `setISODate`, NOT "Jan 1 + N weeks" which lands in the prior year).
- An **AGE, never an expiry** — nothing is ever blocked. `age_status` = fresh/ageing/old, computed at read time
- Thresholds are shop settings: `stock_age_warn_years` (5), `stock_age_old_years` (6)
- Unknown ≠ fresh: no code → `age_status` null
- Tests: `tests/Feature/AutoWorkshopTest.php` (18, covers both ② and ③)

**Why:** each was being faked into a field that meant something else — the buy-back as a discount (understating revenue AND losing the scrap as an asset), the vehicle as a phone number, the tyre's age as nothing at all.

Related: [[shopos-retail-depth]] [[shopos-pharmacy-edges]] [[shopos-business-priority]]
