# A product sold in sizes holds no stock of its own

**2026-08-30**

## Measured, on the unfixed code

A shirt with sizes S (5) and M (7). Adjust the **parent**, stock in, 20:

```
status 201  ·  "Stock updated"
effectiveStock  before 12   after 12
products.stock_quantity   0 -> 20
```

The shopkeeper adds twenty shirts, is told it worked, and the till, the
catalogue and the reorder list all still say twelve. `products.stock_quantity`
is an orphaned leftover once a product has sizes — `Product::effectiveStock()`
sums the sizes and never reads it — so the twenty went into a column nothing
reads.

The same hole through the other door: a **lot**. The batch dialog never sent
`variant_id`, so a chemist could book in fifty strips against the parent. The
`product_batches` row was created, the stock went to the orphan, and the size
stayed at zero — with a lot on the books saying otherwise.

## The rule already existed, in one place

`StartStockCountAction` says it outright:

> A product WITH variants holds no stock of its own — each variant …

Stated where it was already true, absent from the path a shopkeeper presses.
That is the recurring shape: a rule written down beside code that honours it,
and nothing enforcing it where it is broken.

`InventoryService::adjust` now refuses (`VARIANT_REQUIRED`) when the product has
variants and no size was named. It sits in the service, not the controller, so
all 28 call sites are covered by one check. The full suite stayed green, which
says nothing legitimate was relying on the parent write.

## A refusal is only honest if the job can be done

The server refusing was half an answer. The panel now:

- hides **Adjust** on a parent row that has sizes — each size row carries its own;
- shows a **required size picker** in the Batches dialog, preselected when there
  is only one size to choose;
- labels every lot in the list with its size, because a list of lot numbers with
  no size cannot tell 10mg from 20mg;
- reads the parent's "currently N" line through `catalogStock`, not
  `stock_quantity`, which told the same lie in smaller type.

## Not changed

`ProductBatch.variant_id` was already supported end to end on the server, and
`PharmacyEdgeCasesTest` has covered per-size lots since the FEFO work. What was
missing was a screen that could send one.

## The one that would have gone white

Found while checking the rest of the module, and the sharpest of the three.

`InventoryPage` draws a sub-row per size — `p.variants.map(...)`, unguarded.
The low-stock endpoint loaded `category` and nothing else, so `variants` was
absent from the payload and that map ran on `undefined`. **The reorder view
threw and the page went blank the moment the list had a sized row to draw.**

It had only ever been seen empty. The shop that reported "reordering shows
empty" was saved by the empty state: the instant they set a reorder level on
anything sold in sizes, the screen would have gone white.

Nothing could have caught it:

- **TypeScript** — `variants: ProductVariant[]` is not optional on the type, and
  a relation nobody loaded is missing at runtime regardless.
- **`chrome.spec`** — walks `/tenant/inventory` with no filter, against a shop
  whose reorder list is empty.
- **The backend tests** — asserted which products the list contains, never the
  shape of a row.

Both halves are fixed: the endpoint loads `variants` (the size matters on its
own terms — a rail is low because the Large ran out, and "order shirts" is not
something a buyer can act on), and every `variants` read on the page is guarded.
`e2e/reorder-view.spec.ts` puts a low sized product in front of the screen —
the only arrangement that has ever shown the fault — and fails on a `pageerror`.

### A side-effect worth recording

`shelf.setup.ts` topped every catalogue product up with a product-level
adjustment. For a sized product that was always a no-op writing to the orphan;
with `VARIANT_REQUIRED` it became an explicit 422, which would have shortened
the setup's own `stocked >= WANTED` count for a reason unrelated to the shelf.
The loop now skips sized products — the block above it already stocks them one
size at a time — and counts only what it actually attempted.
