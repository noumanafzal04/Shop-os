---
name: shopos-pos-dinein-flow-todo
description: PENDING (asked 2026-08-18) — verify the POS dine-in vs takeaway flow end to end, especially WHICH table list appears when dine-in is chosen at the till
metadata:
  type: project
---

**Owed to the user, to be done LAST** — after the current QA-sweep and tablet
work is finished. They asked for it explicitly and asked that it be remembered
rather than done immediately.

**The question:** on the POS screen, when the order type is switched between
**dine-in** and **takeaway**, what happens — and for dine-in, *which* table list
is offered, and where does it come from? Verify the whole flow once, from the
till's order-type control through to the tab that gets opened.

**Why it needs a look:** the floor has two entry points that were built at
different times — `PosPage` has `order_type` (`dine_in` | `takeaway`) and a
`table_no` STRING on the sale, while the restaurant module has real
`dining_tables` rows and `restaurant/tickets` tabs keyed by `dining_table_id`.
A free-text table number at the till and a table record on the floor are two
different ideas of "which table", and nothing has yet checked that the till
offers the shop's actual tables rather than a typed number.

**How to check:** phase L of the sweep already drives tabs, the pass, split
bills and table ownership through `/restaurant/*`. What it does NOT drive is the
POS screen's own dine-in path — `channel: pos` with `order_type: dine_in` and
`table_no`. Compare the two and establish whether a till-side dine-in sale ever
becomes a floor tab, or whether they are parallel records. See
[[shopos-food-dinein]], [[shopos-table-ownership]], [[shopos-qa-sweep]].
