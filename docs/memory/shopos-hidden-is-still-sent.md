---
name: shopos-hidden-is-still-sent
description: STANDING (tester pass 2, 2026-10-14): a figure the screen hides is a leak if the API still sends it — strip on the MODEL (HidesCostPrice::costKeys, HidesSupplierMoney) or in asSeenBy, send null not 0, draw no tile for what never arrived
metadata:
  type: feedback
---

The cloud tester's route probe (359 routes × every staff set) found the same fault four times: cost on every sale line to a cashier (B38), takings/payables/audit feed on the dashboard to the kitchen (B39), supplier debt to the stockroom (Q9), a supplier balance that read 0 because its sums were never loaded (B46).

**Why:** the screens hid these; the answers carried them. Anyone with the network tab read them.

**How to apply:**
- A money/cost field is stripped where it is SERIALISED: model traits (`HidesCostPrice` with `costKeys()` on every line model; `HidesSupplierMoney` on Supplier + PurchaseOrder, gate `Permissions::SEES_SUPPLIER_MONEY`) or `DashboardService::asSeenBy` (adds to `sees`).
- Null (or an empty list), never 0 — 0 is a figure. A computed figure whose inputs were not loaded is null too.
- The panel draws a tile/column only when the value arrived (`sentMoney`, `sees.*`, `!== null`), never as "Settled"/"Rs 0".
- New staff-visible endpoint → ask: what in this answer is cost, profit, debt or another place's figure? Test it as the cashier and the kitchen.
- Related: [[shopos-no-roles]], [[shopos-tester-and-fixer]].
