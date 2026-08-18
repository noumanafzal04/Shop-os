---
name: shopos-unit11-status
description: "Unit 11 progress — 11a pharmacy, 11b retail documents and 11c petroleum forecourt all SHIPPED (1004 tests green)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-16T17:47:04.601Z
---

As of 2026-08-06, Unit 11 (vertical depth) is complete:

- **11a pharmacy** — SHIPPED (substitution by salt, dispensing register, batch
  recall via `stock_movements.batch_allocations`, schedule enforcement).
- **11b retail** — SHIPPED as `sale_documents` (quotation + layaway in one
  table). Key invariants: a deposit is never revenue (settled as its own
  `deposit` PaymentMethod at conversion); a deposit IS drawer cash
  (`deposit_in`/`deposit_out` CashMovement types); layaway stock leaves at
  deposit time and conversion carries `skip_stock` on the trusted path only.
- **11c petroleum forecourt** — SHIPPED. `fuel` module key added to
  `Modules::all()` + `BusinessTypes::FEATURES`, default ON for petroleum only.
  Actions in `app/Actions/Fuel/` (Open/CloseForecourtShift, RecordFuelDelivery,
  ChangeFuelPrice), controllers FuelSetup/ForecourtShift/FuelDelivery/FuelPrice,
  routes under `/api/v1/fuel` gated `feature:fuel`, panel module
  `src/modules/fuel/` (Forecourt / shift detail / setup / deliveries+rates).
  26 tests in `tests/Feature/FuelManagementTest.php`.

**Why the fuel design is shaped that way:** a forecourt is measured twice on
purpose. Meter litres vs litres rung at the till finds fuel that left the pump
unbilled (an attendant problem); tank book stock vs closing dip finds fuel that
left the ground without crossing a meter (a leak). Collapsing them into one
variance destroys the distinction the owner is trying to make.

**Forecourt invariants worth not re-deriving:**
- Test litres cross the meter but return to the tank — subtract from sold
  litres AND leave the tank book untouched, else every calibration check reads
  as a theft.
- A closing meter reading below the opening one is treated as a **roll**
  (999999.999 → 0), not an error; a mis-key is caught by the dip moments later
  while a missed roll erases a whole shift.
- Close refuses on ANY missing nozzle reading or tank dip: the close ends by
  `set`-ting fuel stock to the summed closing dip, so a partial dip set would
  silently erase a tank.
- Permissions reuse existing keys — setup `settings.manage`, shifts
  `inventory.manage`, deliveries `purchases.manage`, rates `products.manage`.
  No new permission keys, so no staff-permission migration.

**Added 2026-08-16 — attendants (audit items 14 + 15).** `attendant_id` on
`forecourt_readings`, nullable. On the READING because that is where the litres
are. `ForecourtShift::attendantTotals()` is computed, never stored; unassigned
rolls up under a null id.

- **The unbilled litres are NOT split per attendant, and cannot be** — a till
  sale doesn't record its nozzle, so meters-minus-till is a station figure.
  A test asserts the split is absent. Don't "improve" this later.
- **Naming an attendant must not require sending `opening_reading`** — an
  echoed reading is written back to the nozzle, so a screen restating a cached
  meter would move a totaliser while assigning a person.
- **The meter override keys on the FIGURE** (`isset($o[$id]['opening_reading'])`),
  never on the entry.

Item 15 is the fifth "built but unreachable" in this codebase and the first
where I was the author: the whole column shipped with the test suite as its only
caller. See [[shopos-reorder-and-labels]] for the same shape.

Related: [[shopos-petroleum-analysis]], [[shopos-build-sequence]].
