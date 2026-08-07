---
name: shopos-training-mode
description: 2026-08-07 SHIPPED — training mode; the unit is the SHIFT not the sale; fenced by a Sale global scope + null business_day_id. Web side now feature-complete.
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T13:50:27.017Z
---

**Training mode shipped 2026-08-07. With it, the WEB SIDE IS FEATURE-COMPLETE**
(excluding offline). Only deployment/CI-CD remains, and that is ops.

## The rule

**The unit is the SHIFT, not the sale.** `POST /pos/session/open` takes
`is_training`; every sale rung on that shift inherits it. The mode cannot change
while a shift runs (`SHIFT_MODE_MISMATCH`) — a mid-shift switch is how practice
and real money end up in one drawer.

## Two structural fences (never "remember to filter it")

1. **Global scope `not_training` on `Sale`.** Invisible to every query that does
   not opt in via `Sale::withTraining()`. Same mechanism the codebase trusts for
   tenancy. NOTE: a global scope does NOT protect raw builders — the one
   `DB::table('sales')` read (`LedgerService`) filters by hand.
2. **`business_day_id = NULL`** on a training shift. Day roll-up and banking
   gather sessions BY business_day_id, so practice was never in the day.

## Deliberate choices

- **`TRN-` invoice sequence**, separate counter column. The real sequence is
  gap-free because a tax authority reads a hole as a deleted sale.
- **Refuses** khata, loyalty redemption, serials, trade-ins →
  `TRAINING_NOT_AVAILABLE`. Each reaches OUTSIDE the sale; skipping silently
  would be a lie (a khata sale charging nobody, a serial sold twice).
- **`DrawerMath` lifts the scope** — the one place that must see practice, safe
  because every query there is keyed by `cash_session_id`.
- **Receipt prints TRAINING** top and bottom in words; POS wears a full-width
  bar, not a chip. Z-read says "NOT PART OF THE DAY'S TAKINGS".
- Shift history **lists** a training shift but never **sums** it.

## The drift-catcher

`test_a_practice_sale_writes_nowhere_but_the_sale_itself` asserts zero rows in
stock_movements, ledgers, serials, trade-ins, bank_deposits, business_days. The
next feature that writes somewhere new during a sale fails there rather than in
a revenue figure. Keep it.

## Loose end noted

`useShiftDay()` (panel `src/modules/registers/hooks/useRegisters.ts`) has NO
component — `/pos/sessions` returns a full shift history that nothing renders.
`ShiftRow` already carries `is_training` for whoever builds the screen.

Related: [[shopos-web-completion]], [[shopos-table-ownership]],
[[shopos-deployment]], [[shopos-offline-plan]].
