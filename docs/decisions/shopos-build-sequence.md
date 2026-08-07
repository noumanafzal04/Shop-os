---
name: shopos-build-sequence
description: Agreed 2026-08-04 build order (gating → module-selling/Finance type → P0 POS fixes → tenant theming → POS roles → vertical depth) + standing quality bar
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-04T19:50:24.194Z
---

Agreed with the user 2026-08-04, after the 6-lens audit + vision reconciliation. Build in this order, each unit reviewable:

1. **Feature-gating / visibility pass** — backend `feature:` middleware on ungated route groups (collections, inventory/suppliers/purchases/batches, reservations, gallery) + frontend `RequireFeature` route guard + fix nav leaks (warranty→retail-only, collections→marketplace, portfolio→petroleum, serial/warranty form→retail) + permission-filtered sidebar. Unlocks selling modules separately.
2. **Module-based selling** — Finance/Expense business type + named plan presets (Expense-Manager standalone vs POS bundles).
3. **P0 POS correctness** — return-endpoint idempotency, inclusive-tax POS overcharge, combo settle-block.
4. **Per-tenant color theme** — tenant picks own primary/secondary/accent; ShopOS brand-blue (#465fff) + Outfit stays the DEFAULT. Must work light + dark.
5. **Cashier/Manager roles + cash-drawer ops** (no-sale, cash in/out, reprint permissions).
6. **Vertical depth** per business type (pharmacy safety cluster, restaurant KDS/roles/stations, finance module depth).

**Standing quality bar the user asked for every time:** handle the full workflow, all edge cases + test cases, all 6 business types, and UI visibility per business type. Parked for LAST: offline PWA POS, deployment/CI.

See [[shopos-audit-backlog]], [[shopos-plans-and-flow]], [[no-claude-artifacts]].
