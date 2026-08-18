# The slip in the customer's bag matched nothing

**2026-08-18.** A till with no server cannot mint an invoice number — the shop's
sequence is one counter, and two offline tablets would both take `INV-1043`,
leaving two sales wearing one identity in the books, on two receipts, and in
every report built on top. There is no repair for that which does not involve
reprinting somebody's paperwork.

So an offline till prints something that cannot collide and is visibly not an
invoice number:

```
OFF-LANE1-A3F2-000042
```

`receiptNumber.ts` explains why the server keeps both numbers on sync, and the
reason is the whole point:

> On sync the server assigns the real number and keeps BOTH, **because the slip
> in the customer's bag is the only reference they have.**

## It was kept, and matched by nothing

Three lookups exist, and all three searched `invoice_number`, `customer_name`
and `customer_phone`:

| Where | What it is |
| --- | --- |
| `SaleController::index` | the sales ledger a shop searches |
| `SaleController::export` | the CSV of the same rows |
| `GlobalSearchService::sales` | the ⌘K palette |

None of them touched `offline_number`. The column was written on sync, read by
the offline report, and **findable by nobody**.

The consequence is not cosmetic. A return is `POST /sales/{id}/returns`, and the
id comes from that search. A customer who bought during an outage, holding the
only paper they were ever given, could not be found — **so their sale could not
be refunded, returned or reprinted.** For as long as offline selling has existed.

## The Help Centre already promised it

The offline article says, in the shopkeeper's own words:

> Keep it: when the connection returns, the sale gets its real invoice number
> and **BOTH are searchable, so a customer holding the slip can always be
> found.**

That sentence was written when the design was decided and was never true. This
is a worse failure than the "built but unreachable" shape found repeatedly this
fortnight: nobody would go looking, because the documentation said it worked.

> **Documented as working is the most expensive way for a feature not to exist.**

## One clause, not three

The fix is `Sale::scopeMatchingSearch()`. Three copies became one, deliberately:

- The export's entire job is to be the same rows as the screen. It can only stay
  the same by being the same clause.
- Two copies of one rule do not remain one rule. The till's status pill proved
  that on the same day, having grown a second copy of its own wording that then
  learned different words while the original learned others.

## Found is not the same as recognised

Matching the slip is half the fix. If the row shows only `INV-1043`, the person
who typed `OFF-LANE1-A3F2-000042` is looking at a number they have never seen,
with no way to tell whether this is the sale in their hand — before refunding
against it.

So the slip travels back:

- the ledger row prints it under the invoice number, in monospace
- the sale detail says `Slip OFF-… · rung offline`
- the palette row leads its subtitle with it — extracted as `saleSubtitle()` so
  the rule is testable and cannot be dropped the next time the row is restyled
- the CSV carries an `offline_number` column, because a shop reconciling a day
  that arrived three days late is matching paper against rows by hand

## What was deliberately NOT done

`isOfflineNumber` stays on `NOT_SURFACED_YET`. Every surface above reads the
`offline_number` **field**, which is either present or not; none of them has to
recognise a string. Giving it a contrived caller to empty a list would be
building for a checklist rather than for a shop. Its exemption line now names
what a real caller would look like: something that must judge text alone — a
scanner reading a slip barcode, or a search box that wants to say "that looks
like a slip number" when it finds nothing.

## Mutation check

Removing `->orWhere('offline_number', …)` from the scope fails all three new
tests. The clause is load bearing, not decoration.

Backend **2056** green · panel **941** green.
