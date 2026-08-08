# The CSV loaded half an item — and three columns were never written at all

`2026-08-09`

The audit question was "does product import/export cover what each trade needs?".
The answer was no, and chasing why turned up a bug well outside the CSV.

## What the CSV could not carry

`ImportProductsAction::COLUMNS` is a strict whitelist: a header it does not know
is dropped **in silence**. The file uploads, the summary says "created", and the
catalog arrives incomplete with nothing anywhere saying so. That is worse than a
refusal — the merchant believes the job is done.

It carried 21 columns: everything general, plus grocery (`plu_code`, `sold_by`)
and *part* of pharmacy (`generic_name`, `requires_prescription`). Missing:

| Column | Trade | What it cost |
|---|---|---|
| `strength`, `dosage_form`, `drug_schedule` | pharmacy | two of five medicine fields worked, so the import looked supported |
| `kitchen_station` | food | every dish routes to one printer |
| `tracks_serial`, `warranty_months` | retail / automotive / petroleum | 500 handsets, none findable at the warranty desk |
| `wholesale_price` | wholesale | |
| `duration_minutes` | services | |
| `tax_group`, `track_inventory`, `description` | all | |

All added, to the importer, the template and the export together — an export has
to round-trip back through the import, so a column added to one and forgotten on
the other is a broken promise.

Two judgement calls in there:

- **A tax group matches by NAME but is never created from one.** A category
  invented from a typo costs nothing; a tax group is a *rate*, and inventing
  "GTS 17%" would price a whole import wrong and look deliberate. An unknown
  name is left off so the item falls back to the shop's default.
- **`track_inventory` and `tracks_serial` are absent-not-false.** Defaulting
  either boolean to false would switch stock tracking off across a whole catalog
  on a re-import, and the summary would call it a successful update.

The test that pinned the export header was a literal copied out of the
controller. It now asks the two ENDPOINTS for their headers and compares them,
which is what its name always claimed it did.

## The bug underneath: three columns with no writer

`CreateProductAction` names its insert columns one by one, and three were missing
from the list. `UpdateProductAction` fills the model wholesale. So each of these
saved fine **the second time you pressed Save** — the field looked like it
worked, which is the worst shape a bug can take.

- **`drug_schedule`** — blanked the controlled-drug marking on every new
  medicine. The till demands prescriber details off this column, so a Schedule G
  drug created through the form sold like an ordinary item.
- **`tax_group_id`** — silently dropped a chosen rate and fell back to the shop
  default. The item was *priced* wrong.
- **`kitchen_station`** — had no writer anywhere at all. No request validated it,
  no form sent it, and `FireKitchenTicketAction` has been reading it to route
  tickets since the food service loop shipped. Every dish went to the default
  station: the bar got the biryani, which is the exact failure stations exist to
  prevent.

Fixed at the source (the insert), plus a validation rule for `kitchen_station` on
both requests and a **Made at** picker on the product form — offered from the
shop's own station list, never typed free-hand, because a station that does not
exist routes a ticket nowhere and the failure only shows up at dinner service.

## The pattern

This is the same shape as the `*.manage` read bug and the three inert settings:
**a capability fully built, with one link of the chain missing.** The column
exists, the reader exists, the UI exists — and nothing writes it. Worth checking
for directly: for any column a feature reads, ask who writes it, and confirm the
create path names it and not just the update path.


## The sweep that closed this out

Two mechanical passes, both run over the whole backend rather than page by page.
Reading pages one at a time has produced a false finding on this codebase three
times; a script that enumerates does not get tired or optimistic.

**Pass 1 — every `Create*Action` against its `Store*Request`.** Any field the
request validates and the insert never names is the bug found on products. Five
actions flagged; all five were false positives on inspection — relations
(`items`, `variants`, `barcodes`, `recipe_items`) handled by their own Sync
actions after the insert, and `CreateTenantAction` delegating `business_type`,
`plan_id` and the owner to their actions. **No second instance of the bug.**

**Pass 2 — a read/write census over the trade-specific catalog columns.** Every
one now has both a writer and a reader. Two outliers checked by hand:
`opening_batch_number` is consumed at `CreateProductAction:124`, and
`reorder_qty` was a column I guessed at that does not exist.

### `EveryTradeLoadsTest`

The panel proves no menu offers a dead link (`shopNavReach`). Nothing asked the
other half: when a shop of a given trade actually calls those endpoints, does the
server answer? All **seventeen** codes — not the eight canonical ones, because
the nine legacy codes are exactly where a "is this shop a pharmacy?" branch goes
wrong, since they resolve rather than match — plus a tenant with a NULL type and
a tenant with no modules at all, across twelve read screens.

It was checked against the real defect: with the day's null guard reverted it
fails with `untyped: GET /api/v1/dashboard answered 500 — a trade branch broke
for this shop.` A test that has never been seen to fail is a decoration.
