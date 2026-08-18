---
name: shopos-pos-dinein-flow-todo
description: RESOLVED 2026-08-18 — the POS offered its own free-text table beside the real Floor module; two unconnected ideas of "which table". Till path now gated to food shops with NO dine_in module.
metadata:
  type: project
---

**Answered.** The question was "POS par dine-in choose karo to kaunsi table list
aati hai?" — and the answer was **none**: a free-text `Table #` box, with the
shop's real tables never offered.

Two unconnected ideas of "which table": the till wrote `sales.table_no` (a typed
string, validated against nothing) while the floor keys everything to
`restaurant_tickets.dining_table_id`. The POS does not import, call or know
about the dine-in module at all — so a till-side dine-in sale never became a
tab, never fired a KOT, never marked the table occupied on the Floor board, and
was invisible to the waiter report.

The gate was the TRADE (`businessType === "food"`), not the module, which is why
both doors stood open for one shop. Now `isRestaurant && !has("dine_in")`: a
juice corner keeps the typed number; a shop with a floor does dine-in on the
floor.

**Why:** same shape as every other defect this week — one question answered in
two places, neither erroring, never meeting. See [[shopos-food-dinein]],
[[shopos-table-ownership]], [[shopos-forecourt-branch]],
[[shopos-adjust-wrong-branch]], [[shopos-tablet-chrome]].
