# The aisle: a marketplace, not a directory

**2026-08-26.** `MarketplaceController`, `src/modules/marketplace/*`, `cartStore`.

## What was there

`/shops` listed SHOPS. City chips, a search box, a grid of shop cards. Clicking
one opened a 744-line page that carried its own header, its own cart, its own
checkout form and its own modifier dialog — the only surface in the product
that could sell anything.

The backend matched: `/marketplace/shops/{slug}/products` answered "what does
this shop sell", and nothing answered "who sells this". There was no endpoint
for a single product either, so an item could not be linked to, shared, or
opened from a search result.

**A customer does not shop for a shop.** They arrive wanting a thing and learn
the shop on the way to it.

## The shape now

```
/shops       market home — deals, aisles, new in, shops
/browse      every product, every shop, with the filter rail
/shop/:slug  one shop's storefront
/p/:id       one product — gallery, sizes, options, quantity
/cart        the basket, grouped by shop
/checkout    one order per shop
/saved       hearted items
```

Header, basket sheet and footer are declared once by `MarketLayout`. Every page
before this brought its own header, which is exactly how the shop page ended up
owning the only basket in the product.

## Three decisions worth the argument

### The basket spans shops; an ORDER does not

The cart held one shop at a time and silently emptied itself when anything from
a second shop was added. Defensible in a single-shop storefront, indefensible
in an aisle that spans every shop: a customer who adds a second thing and loses
the first does not add a third.

So the basket is multi-shop and the **split is shown rather than hidden** — on
the mini-cart, on the cart page and at checkout. It is real: an order is placed
against one tenant, with that tenant's stock, delivery fee, minimum and prep
time. Three shops means three orders and three deliveries, and a customer who
discovers that at the end has been misled by every screen before it.

Checkout therefore places them **one at a time**, each with its own idempotency
key, and takes each succeeding shop out of the basket the moment its order is
real. The failure that avoids is the one that loses trust outright: shop two
refuses, a red error appears, the basket still looks full, the customer orders
again, and two vans arrive.

`cartStore` is at `version: 2` with a migration — a returning customer's v1
basket keeps its contents instead of being silently emptied or crashing.

### The rail is counted, never written down

Every option in the filter rail — city, trade, category, size, price range —
comes back from `/marketplace/products/facets` with the number of products
behind it, computed from **the same query the listing runs** (`browseQuery`,
shared, with an `$except` parameter so an axis does not count itself).

A hardcoded rail is wrong the day after it is written: a shop opens in a city
nobody listed, a category is retired, a trade is renamed. And a count that
turns out to be wrong is worse than no count — the first time "Lahore (12)"
sits over a list of nine, the whole rail stops being believed.

`TheAisleTest` asserts the invariant directly: for every option the facets
offer, clicking it must return exactly that many rows, with a denominator so a
loop over an empty facet list cannot pass.

### A card may add what it can fully specify

Sizes are on the card, so a sized item is addable there. Modifier groups are
not: "choose a spice level, pick up to three add-ons" is a form, and a card
that pretended to add a burger would send a kitchen a ticket the customer never
agreed to. Those items say **Choose options** and go to their page.

Sizes are on the card for a second reason: "out of stock" is almost never true
of a product. It is true of the Large. A grid that hides sizes has to decide
whether a shirt with no XL left is in stock, and both answers are wrong.

## What the engines hid from each other

The suite runs on SQLite. Shops run on MySQL. Both engines lied, in opposite
directions, and each hid the other's lie:

**SQLite hid a MySQL bug.** The facets endpoint built its price range with
`selectRaw`, which APPENDS — so `MIN(...)` arrived on top of the base query's
`products.*` and a subselect. MySQL under `ONLY_FULL_GROUP_BY` refuses that.
Nineteen green tests, and a 500 on the first real request. Fixed with `select`,
which replaces.

**MySQL would have hidden a SQLite bug.** A PHP float binds as `PDO::PARAM_STR`,
and SQLite orders every number BELOW every string — so `2400 <= '500'` is true
and "under Rs 500" returned the whole aisle. MySQL coerces and would have shown
nothing wrong. Fixed with `CAST(? AS DECIMAL(14,2))`.

So the suite now runs on **both**, and the deploy waits for both
(`gate` + `gate-mysql` in `deploy-backend.yml`). The MySQL job asserts
`ONLY_FULL_GROUP_BY` is actually on before it runs anything — a MySQL without
it would pass everything and prove nothing.

The second run immediately found two more, neither of them mine:

- **A pharmacy recall could not find who took the bad lot home.**
  `PharmacyController::recall` pre-filtered the JSON allocations with the
  manufacturer's casing as typed, then matched case-insensitively in PHP.
  SQLite's `LIKE` is case-insensitive for ASCII; MySQL's against a JSON column
  is binary. So a lot received as `Bad-77` and recalled as `BAD-77` matched
  nothing — and because the on-hand query already lowercased, the screen
  correctly listed the stock to pull off the shelf beside an EMPTY list of
  people. A screen that looks like it worked is how somebody stops looking.
- **A query-count test counted zero on the engine it mattered on.**
  `PosSyncTest` grepped the query log for `from "products"` — SQLite's
  identifier quoting. MySQL writes backticks. A detector that cannot see its
  own subject reports the same number as a detector watching a fixed bug.

## The browser found what jsdom cannot

`e2e/market.spec.ts` runs in a **new project with no storageState**. Every other
Playwright project here signs in first, because every other screen belongs to
somebody who works at a shop. The marketplace's reader is a customer with no
account, and running it as an owner would test the one visitor it is not for.

Two of the four things it asserts are impossible in jsdom: whether the page
scrolls sideways, and whether the count beside a filter matches the list it
produces after a real click.

Its first two runs failed on the harness rather than the product, which is the
usual ratio: the phone run clicked at the desktop rail, because **both rails are
in the DOM at once** — the `aside` is hidden by CSS below `lg`, not unmounted —
so `.first()` picked the invisible copy. `:visible` fixes it, and the comment
says why so the next person does not "simplify" it back.

## Related

- [shopos-page-two.md](shopos-page-two.md) — one shared `<Pager>`; the aisle uses it.
- [shopos-detector-vs-rule.md](../memory/shopos-detector-vs-rule.md) — give every scanner a denominator.
- [shopos-screen-testing.md](shopos-screen-testing.md) — Playwright is the only thing that sees layout.
