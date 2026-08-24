---
name: shopos-what-it-used-to-cost
description: SHIPPED — product price history; Product had NO Auditable trait at all, and the work was mostly about what must NOT be filed (creates, renames, imports)
metadata:
  type: project
---

A tax rate, a coupon, a credit limit and a group discount had all been auditable
for a while. **The money authority a shop exercises daily was not on the list** —
`Product` used no `Auditable` trait at all. Sugar went 180 → 210 and the only
record of 180 was the screen it was typed over.

**The hard half was not recording it.** The trait's own docblock had already
argued the danger about customers ("a shop that imports five thousand products
would bury its own trail in one afternoon"), and a catalogue makes it twice as
sharp. So the design is mostly refusals:

- an item ARRIVING with a price is not a price change → `auditCreate()` false;
- a rename is not a money decision → `auditOnly` = `price`, `discount_price`,
  `wholesale_price`;
- an import of 340 items is ONE act → `Product::withoutAuditing(...)` per row,
  plus one `imported` row carrying the counts.

**`cost` is deliberately absent** — it re-blends on every goods-received
(weighted average, see [[shopos-moving-cost]]), so auditing it files a row per
line per delivery, none of them a decision. The purchase order line is the truer
record of what was paid.

> Suppressing without recording would be **making a write quiet** — a different
> and much worse thing. That is why the import files its own row.

**Two things had to change underneath:**

- the trail could be filtered by kind, person and date but **not by subject**, so
  the one question a shopkeeper arrives with ("what has THIS item's price done")
  was the one it could not answer. `?record=` added;
- `audit_logs.auditable_id` was **NOT NULL**, so an act about a KIND rather than
  a record could only be filed by pretending it happened to one row.

Shows under the price boxes on the item, gated by the Activity rule from the same
map (`settings.manage` OR `reports.view`). A stock keeper can change a price and
is not shown who else has — and the section renders NOTHING for them, because one
that appears and then 403s announces the history and refuses it in one breath.

Held by 6 backend tests, `e2e/price-history.spec.ts` (this trail has already been
built-but-unreachable once — see [[shopos-who-changed-what]]), and sweep phase T.
