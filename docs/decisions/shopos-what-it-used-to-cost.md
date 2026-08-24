# What this item used to cost, and who moved it

**2026-08-29 · backend + panel**

## The number nobody was recording

Every other money authority in a shop has been auditable for a while — a tax
rate, a coupon, a customer's credit limit, a customer group's discount. The one
a shop exercises **daily** was not on the list. Sugar goes from 180 to 210 and
the only record of 180 was the screen it was typed over.

`Product` used no `Auditable` trait at all.

## The hard half was not recording it

The trait's own docblock had already argued the danger, about customers:

> a shop that imports five thousand products would bury its own trail in one
> afternoon

A catalogue makes that argument twice as sharply, so the work is mostly about
what must **not** be filed:

| | |
|---|---|
| an item **arriving** with a price | not a price change — `auditCreate()` is `false` for Product |
| a name, a category, a barcode | not a money decision — `auditOnly` is the three selling prices |
| an **import** of 340 items | ONE act, not 340 — suppressed per row, recorded once |

**`cost` is deliberately absent.** It is not a decision: it re-blends itself on
every goods-received (weighted average, see `MovingCost`), so auditing it would
file a row per line per delivery, none of them anybody's choice, and bury the
ones that are. The shop already has a truer record of what it paid — the
purchase order lines, with a date and a supplier against each.

And suppressing without recording would be **making a write quiet**, which is a
different and much worse thing. `ImportProductsAction` files one row for the
operation: *340 items re-priced, by Asif, at 11:04*.

## Two things had to change underneath

**The trail could not be asked about a thing.** It filtered by kind, by person
and by date — not by subject. So the one question a shopkeeper actually arrives
with ("what has THIS item's price done?") was the one it could not answer.
`?record=` now does.

**`audit_logs.auditable_id` was NOT NULL**, so an act about a *kind* rather than
a record — an import — could only be filed by pretending it happened to one row.
Made nullable; `auditable_type` already carries which kind.

## Where it shows

Under the price boxes on the item itself, because that is where the question
comes up. "Why is this ringing at 210?" is asked by somebody already looking at
the field; a separate history screen is one more place to remember exists. The
whole trail is still on Activity for when the question arrives the other way
round — "what changed last Tuesday".

Who may read it is the Activity rule, **from the same map**: `READS_AUDIT` is
`settings.manage` OR `reports.view`. A stock keeper holds `products.manage` and
neither — they can change a price and may not read who else has, which is the
owner's business rather than the catalogue's. For them the section renders
**nothing at all**, because a section that appears and then 403s tells them the
history exists and refuses it in the same breath.

## Held by

- 6 backend tests, each one about a row that must NOT exist; two mutations
  (creates filed again, import unsuppressed) each kill exactly one.
- `e2e/price-history.spec.ts` — the trail has been through the
  built-but-unreachable failure once already (recorded for the platform,
  unreadable by the shop it was about), so this drives the real drawer.
  Silencing the component fails it.
- Sweep phase T, whose whole subject is who changed what, now asks the same two
  questions of every shop it has built.
