# The mirror that never learned, and the refusal nobody saw

**Date:** 2026-08-25
**Status:** shipped — `ProductVariant::$touches`, `refusedRows`/`refusedCount`, the till's refused strip

Two defects on the offline path, found from one flaky browser test. They
compound: the first makes a till sell what the shop has not got, and the second
makes the resulting loss invisible.

## How they were found

A full browser run failed one test — the offline queue-drain spec, on the phone
project only — with:

```
Insufficient stock: only 0 in stock.   retryable: false
```

It passed on its own, so it was order-dependent, and the obvious reading was a
fixture that had run out. It was not: every shelf item still held 240. What the
trace showed was that the till's own catalogue mirror listed stock the server
disagreed with.

## 1. A size's stock never reached the till

The offline catalogue delta pages on `products.updated_at` — that is what
"anything new since?" means for this projection. But a size's stock is written
to the **variant**: `InventoryService` rolls the branch total up onto
`$target = $variant ?? $product`, so selling the last Large moves
`product_variants.updated_at` and leaves the parent's alone.

The parent is the only row the delta looks at. So the till asks, is told
nothing has changed, and keeps the figure it was handed the day it first
synced — until somebody happens to edit the product itself.

The same hole carried a size's **price**, which has nothing to do with stock:
repricing a Large writes `product_variants` and nothing else, so an offline till
goes on ringing last month's money.

**Fix:** `ProductVariant::$touches = ['product']`. One line — a size is part of
its product's projection, so a change to one is a change to the product the till
syncs on.

### Two mistakes worth recording

**I wrote two fixes where one was needed.** The first attempt also put
`$touches` on `BranchStock`, reasoning that the row the projection reads its
stock *from* is the row that must move the cursor. Mutation testing killed that:
removing either one alone left both tests passing, because every stock write
reaches `InventoryService`, which saves the variant anyway. `ProductVariant`
covers strictly more (price and name changes touch no stock row at all), so the
`BranchStock` one was removed rather than shipped unproven.

**My second test passed against its own bug.** It claimed to cover a transfer
between branches, where the rollup is a sum and therefore unchanged — but each
`adjust()` call changes that sum on its own, so the premise the test asserted is
not reachable through that path. It was replaced with the size-price case, which
fails honestly. *A test that names one thing and checks something adjacent* is
the failure this repo keeps meeting; this time it was mine.

## 2. A refused sale disappeared in silence

The worse half, and it does not depend on the first being fixed: an offline till
is *always* somewhat stale, so a refusal will always be possible.

`owedCount()` treats `FAILED` as finished. That is correct for the question it
asks — retrying cannot help — but it left a refused sale **in no count at all**,
and nothing anywhere read those rows. `markFailed`'s own note says a dropped one
would leave "a customer holding a receipt for something the shop has no record
of, and nobody would ever know to look". Then nothing looked.

What that costs a shop, in order:

1. The line drops. A cashier rings an item the mirror still shows on the shelf.
2. The customer pays and walks out.
3. The line returns. The server refuses; the row goes quiet.
4. **The pill reads "Online".** Everything looks finished.
5. The day closes with cash in the drawer against no sale. The drawer is **over**
   and nobody can say why.

`Reports → Offline` could never have caught it: that screen asks the **server**
what happened while the shop was away, and a refused sale is the one thing that
never reached it. The report whose whole job is "did anything go wrong offline"
was blind to the worst thing that can.

**Fix:** a refusal is not finished — it is owed to a **person** rather than to
the server.

- `refusedRows()` / `refusedCount()` beside `owedCount()`.
- `queueTally()` returns owed and refused **together**, because three places ask
  and they were three copies of one wiring. A count updated in two of them is a
  till that says "Online" on the screen the cashier is actually looking at.
- The till carries a standing red strip — not dismissible, because the money is
  already in the drawer — with **See which**: slip number, amount, and the
  server's own words. Not a paraphrase: "Insufficient stock: only 0 in stock"
  tells a shop what to fix; "could not be saved" does not.
- An amount that cannot be read says so rather than printing `Rs 0`, which reads
  as a sale worth nothing — a different and wrong story.

Drawn in **both** layouts, because a phone shows one pane at a time and this
codebase has already lost a warning to exactly that.

## 3. And the strip itself was crushed on a phone

The browser suite's first act was to fail the new strip, which is what it is
for. The screenshot showed it as a **pink sliver a few pixels tall** under the
pane switcher — present, "visible" by every check, and impossible to press.

The till's workspace is a grid declaring exactly three rows
(`auto`, `minmax(0,1fr)`, `auto`), and on a phone it is handed exactly three
children: the pane switcher, the one visible pane, and the footer. A **fourth**
child shifts every assignment along: the strip took `minmax(0,1fr)` and the
product list took `auto`. `auto` takes whatever its content needs and a product
list needs all of it, so the flexible row was left with nothing.

**The same was already happening to `posNotice`** — the till's one way of
speaking, carrying prescription warnings, near-expiry batches and the reason a
line cannot be rung. It survived because it is transient and short, and because
**`data-pos-notice` was added as a test hook that no test ever used**: the fix
that introduced it was never asserted by anything.

Fixed by grouping the switcher and both strips into one grid child, so the child
count is fixed no matter how many strips are on screen.

Worth stating plainly: 1,151 unit tests were blind to this. jsdom has no layout
engine, so *"is this element in the document"* and *"can a thumb reach it"* are
different questions and only one of them was ever being asked.

## Proven by mutation

| Mutation | Failed |
| --- | --- |
| `ProductVariant` no longer touches its product | *a size's stock change reaches the till*, *a size's price change reaches the till* |
| `refusedRows` finds nothing | *counts them, because nothing else does*, *hands back the newest first* |
| an unreadable amount becomes `Rs 0` | *reads the amount off the sale, and admits when it cannot* |
| `setTally` drops the refused half | *carries the refused count through the same read* |
| the phone strips go back to being separate grid children | *a refused offline sale is on screen, on the pane the cashier is looking at* (browser) |

## What this is an instance of

A mirror is only as honest as the question the server asks on its behalf.
`shopos-member-discount-offline.md` put it as: **ask what a mirror was GIVEN and
does not use.** This is the sibling: *ask what a mirror was never told had
changed.*

And `owedCount` is the `*.manage` shape again — one status answering two
questions. "Will we retry?" and "does a person need to act?" are not the same
question, and reading one as the other is how a loss goes quiet.
