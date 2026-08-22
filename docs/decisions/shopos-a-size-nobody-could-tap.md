# A size nobody could tap

**2026-08-22.** The ask was a small one: at the till, and on the dine-in tab,
tapping an item should ask **which size** — S / M / L — as buttons, and take that
size's own price. Chips on the tile where there is room, a sheet on a row where
there is not.

Scouting it first turned a small feature into a different job, and the reason is
worth the space: **almost all of it was already built, and one missing branch had
made the rest unreachable — including a live bug that stopped varianted products
being sold at all.**

---

## What was already there

Everything except the question.

```
ProductVariant           own price, own cost, own stock, own low-stock threshold
BusinessTypes            the diner's variant attribute is literally called "Size"
ProductFormPage          creates them
product_batches          variant-aware, for medicine FEFO
CreateSaleAction:352     prices from the VARIANT — proven by SalesTest
AddTicketItemsAction     validates, prices, snapshots the name, prints "Half" on
                         the KOT and the KDS, carries it into the sale on settle
                         — with an end-to-end test asserting 800 + 1400 = 2200
offlineCheckout.ts       mirrors the same pricing rule, refuses an unknown variant
PosPage.addLine          takes (product, variantId, variantName, variantPrice)
```

And the tap handler:

```ts
if (p.modifier_groups?.length) openConfig(p); else addLine(p);
```

No variant branch. Every tap sent `variant_id: null`, so the only path in the
whole product that could produce a variant line was the **barcode scanner**. A
shop could create Small, Medium and Large — each with its own price and its own
rail — and sell all three at the parent's price, with no way for a cashier to say
which one went out of the door.

`TabPage.fireAdd` was the same shape: `{product_id, quantity,
modifier_option_ids, note}`, against a server that had been complete for this the
whole time.

## The bug underneath the feature

This one was live before the picker existed and had nothing to do with it.

`Product::effectiveStock()` states the rule outright:

> A product WITH variants holds no stock of its own — its real quantity is the
> SUM across variants, and the parent `stock_quantity` is **an orphaned leftover
> that must not be read as truth**.

The till read exactly that:

```ts
const shownStock = (p) => onHand(Number(p.stock_quantity ?? 0), stockDeltas, p.id);
const out = !!p.sold_out || (p.type === "product" && p.track_inventory && shownStock(p) <= 0);
//                                                   ↑ tile is disabled={out}
```

`CreateProductAction` seeds the parent row at zero and puts the quantities on the
variants. So a T-shirt with a full rail of S, M and L rendered **"Out of stock"
and unpressable** — not a display problem, an item the shop could not sell. The
offline projection sent the same orphan, so the till was wrong with or without a
connection.

**Fifth time this month** a rule written down in one file has been contradicted by
another file reading the very thing the rule warns about. The others: an expiry
alert whose docblock named the screen it never linked to; billing buckets whose
comment claimed a mutual exclusivity they did not have; a ledger whose delete
action promised history that the relation then hid; a summary comment describing
customers' money while summing one of the two kinds.

## What the branch stock said, depending on which screen you asked

The offline projection resolved stock **per branch**, keyed `productId:variantId`.
The online product list stamped `branch_price` and no stock at all, so
`variants[].stock_quantity` — the shop-wide rollup, which
`InventoryService` itself calls the legacy rollup — was the only figure the till
had online.

Same size, same moment, two different numbers depending on whether the line was
up. A shop cannot be asked which of its own screens to believe, so `/products`
now stamps `branch_stock` per variant, additively, beside the untouched rollup
that the catalogue and inventory screens legitimately want.

The stamping is one method called by both the product list and the quick-keys
strip, because those two had *already* drifted: the list stamped a branch price
and the strip stamped nothing, so the same product tapped from two places on one
screen answered differently.

---

## The build

### One rule, six doors

There are six ways a line gets into a cart: a tile, a row, a size chip, a quick
key, the barcode scanner and the dine-in tab. The stock and sold-out fences were
on four of them. **The scanner had neither** — the one door a mart uses all day
would ring a sold-out dish and an empty shelf without a word.

I then wrote the rule twice myself, once in `PosPage` and once in `TabPage`,
inside twenty minutes. That is exactly how the 86 rule and the discount ceiling
came to disagree between these same two screens, so it now lives in
`src/modules/pos/availability.ts` and the doors call it. The caller supplies its
own stock reader — the till subtracts its unsent offline queue, a tab has none —
and everything else is shared.

The backend half was already consistent and already guarded:
`VARIANT_UNAVAILABLE` sits in the common set of `one-rule-many-paths.py`, thrown
by the counter, the tab and the order alike.

### The shape follows the view

`posLayout` is a per-device choice, and both branches render from the same array.

| | |
|---|---|
| **Tiles** | The sizes are buttons on the tile. One tap **is** the add — no dialog, no second step |
| **Rows** | A row is a line of text with a price at the end. It asks in a sheet |
| **Dine-in** | Tiles only, so chips — plus a sheet for a waiter who taps the dish itself |

A chip cannot live *inside* the tile, because the tile is a `<button>` and a
button inside a button is invalid HTML and unreliably clickable. So the tile keeps
its own element and the sizes became siblings inside a cell. Three things fall
out of that, all wanted: the chips are real buttons and therefore in the tab
order; one tap adds; and the tile still does something useful for anyone who taps
the picture.

The dine-in tile was `h-24` — the only one of the three grids that physically
could not absorb a chip row without clipping it. Now `min-h-24`.

A size that has run out is **shown and struck through**, not hidden. A cashier
asked for a Large needs to see that Large is the thing that has gone.

### Everything else the scouts turned up

- **The tab's menu was capped at fifteen.** `catalogService.products({})` sends no
  `per_page` and the endpoint defaults to fifteen, so a waiter filtering to
  "Curries" was narrowing a list that had already been cut. A menu is a working
  surface, so it drains — reusing the same hook the combo/recipe picker uses, and
  now with a `staleTime`, because a tab is opened every time a guest sits down.
- **The tab showed no availability at all.** `AddTicketItemsAction` refuses a
  sold-out dish and an empty shelf; the tile read neither and `fireAdd` reported
  it as "Couldn't add the item." A server fence with no screen signal, which is
  the shape of three earlier bugs. The tile now marks it, and the error shows the
  server's own sentence.
- **A scanned size was dropped into the options sheet.** Scan a Large, choose
  toppings, ring a Small: `openConfig(product)` never took the variant. The
  configurator now carries it, and prices from it.
- **The pharmacy substitute picker** built its line from a small drug reference
  with no variants on it, so substituting a medicine stocked in two strengths
  charged the parent's price silently. It now fetches the real product and asks.
- **An always-mounted `role="dialog" aria-modal="true"` drawer.** The Appearance
  panel animates with `translate-x-full` and is never unmounted, so it sat in the
  accessibility tree on every screen telling a reader the rest of the page was
  inert, with its controls still in the tab order. Found because a browser test
  asked for "the dialog" and was handed two. Now `inert` and `aria-hidden` when
  closed.

---

## The method, and one thing it caught about itself

Five scouts read the plumbing in parallel; five verifiers then tried to refute
whatever they claimed already worked. The verifiers earned their keep — they
found the three additional UI breaks inside a path a scout had called "done", and
they counted five tap-to-add entry points where the scout had said three.

One verifier also read the working tree mid-run and correctly reported that fixes
for the bugs it was checking had appeared underneath it.

**And a mutation of mine passed when it should not have.** Testing the new
bay-board preset cases, removing `SALES_MANAGE` from the cashier preset left every
test green — which should have meant the tests were vacuous. They were not: the
mutation's anchor matched three presets and it had stripped the permission from
the wrong one. Retargeted by line, the same mutation fails 19 of 28 cases.

> A mutation that passes is either a missing check or a missing mutation, and
> telling those two apart is the whole job. This one was a hair from being written
> up as reassurance.

## Gates

```
backend    2146 tests / 9054 assertions
panel      1057 tests / 84 files
browser    Playwright, 4 viewports, including a size chip measured on a 390pt phone
a11y       0 of 367 visible controls unnamed
```

Every fix mutation-tested: the parent-stock read, the `is_active` projection, the
branch-stock stamp, the per-size fence and the rule's three properties each turn
their test red when reverted, with a message naming the defect.

---

# The other half: a size nobody could ADD

**2026-08-23.** The picker above made sizes sellable. The next question was
whether a shop could create them decently — a garment shop wants colour × size, a
pizza wants Small/Medium/Large, a drink wants 500ml/1L. Three scouts read the
form before anything was written, and the first thing they found made the rest
academic.

## `+ Add variant` was a submit button

```tsx
<Button size="sm" variant="outline" onClick={…}>+ Add variant</Button>
```

No `type`. `Button` had no default. The HTML default for a button inside a form
is **submit**, and this one sits inside `<form onSubmit={submit}>`.

So pressing it queued the state update, then submitted the form — creating the
product with **zero variants** and closing the drawer. Reopening lands in edit
mode, where the section was hidden. **The variant editor had never worked once.**
Every variant in the system arrived through the API, which is exactly why nobody
had noticed: the e2e fixture POSTs its sized product straight to `/products`.

Two more buttons had the same omission: `+ Group` (modifier groups) and
`Save modifiers`, which fired its own mutation *and* created the product.

The systemic fix rather than three patches: of **305 `<Button>` usages in the
app, exactly one asked for `type="submit"`**. So the default was backwards.
`Button` now defaults to `"button"`, and the nine buttons that really are a
form's submit say so. The rule that sorted them is clean — a `<Button>` with its
own `onClick` is never the submit; a bare one inside a form always is.

## What replaced the editor

Name the axes, and the rows fall out. `regenerate()` keeps every price already
typed, matched by name — a shop that adds Black after pricing six rows loses
nothing. `whatIsMissing()` counts the unpriced rows before the save rather than
after, because the server has always refused a variant with no price and the form
never rendered `variants.*.price`, so a blank price produced a save that appeared
to do nothing at all.

Nothing about the UI is invented; each piece is copied from the panel's own best
example. Real `<th>` headers from the stock count sheet — the only repeating
editor here that keeps its column names visible past row one. Generated rows from
the till's serial capture. "Apply to all" from the staff form's Select all,
including its habit of disabling when it would be a no-op. And a name on every
cell — `Price for Red / S` — from the shift-count denomination grid, which
settled that rule the first time: twelve boxes all announced as "Price" is not a
form anybody can fill in without sight.

The **axis names already existed per trade** and were being spent on one line of
grey hint text: a diner's are "Size · Flavor", a chemist's "Strength · Pack
Size", a tyre shop's "Size · Brand · Load Rating". They now seed the axis, and
the values that go with them are one tap each. Colour and Flavor deliberately
have no suggestions — a shop's colours are its own, and a guessed list is wrong
in a way that looks authoritative.

## And the backend that made it more than a create form

A grid you cannot reopen is a worse feature than no grid, so editing was built
alongside: `SyncProductVariantsAction`, rules on `UpdateProductRequest`, and four
lines in `UpdateProductAction`. Three things it has to get right, each with a
test that fails loudly when reverted:

- **It touches the parent.** The offline catalog is a delta on
  `products.updated_at|products.id`, and variants ride inside the product's
  projection — nothing compares `product_variants.updated_at`. Without the touch,
  retiring a size closes the fence on the server while every offline till keeps
  selling it, and each of those queued sales dies on sync with
  `VARIANT_UNAVAILABLE`, non-retryably, after the cash crossed the counter.
- **It never force-deletes.** Five tables cascade off a variant, `stock_movements`
  among them; three more carry a `variant_id` with no foreign key at all.
- **It refuses to leave a product with no sellable size**, because a varianted
  product holds no stock of its own and would render as a live, in-stock,
  unbuyable tile.

`PUT /products/{id}` carrying variants used to answer **200 "Item updated"** and
discard every one — `validated()` returns only rule-covered keys. A success
response for work thrown away is worse than a refusal, because nobody goes
looking.

The axes themselves live in the product's existing `attributes` json, so no
migration; the create-parity guard was told where they land rather than being
silenced.

## A scanner, from a question the shop asked

Writing the sync action I nearly typed `$product->branch_id` — a column
`products` does not have. Eloquent answers that with **null**, silently, for ever.
Asked the obvious follow-up — *"then it could be missed on other pages too"* — and
turned it into `scripts/silent-nulls.py`: for every read whose variable names its
model, is that name a column, a cast, an accessor, a relation, an append, or a
field something stamps on? Anything ambiguous is counted as UNJUDGED and printed
as a denominator rather than guessed at.

**836 reads judged. One real finding, and it was the interesting kind:**

```
$sale->customer?->phone      Sale has no customer() relation
```

`sales.customer_id` has existed since the table was created. `Sale::customer()`
never did. The only caller is `SendSaleReceiptAction`, which opens with
`$sale->loadMissing('tenant', 'customer')` — so it would have thrown
`RelationNotFoundException` on its very first line. It has no callers, so the
throw had never happened: SMS and email receipts were written, wired to nothing,
and would have failed the first time anybody wired them.

The other seven were `withCount` and `selectRaw … as alias` — legitimate
manufactured attributes, and the scanner was taught both, because a tool that
cries wolf five times is not opened the sixth.

## Gates

```
backend    2154 tests / 9081 assertions   (+ silent-nulls: 0 of 836, --prove passes)
panel      1081 tests / 85 files
browser    Playwright, 4 viewports, incl. building a 2-axis shirt through the form
```

## What this does not do

- **A variant cannot be edited, renamed, re-priced or removed after creation.**
  There is no variant route, `UpdateProductRequest` has no rules for them, and the
  product form submits them on create only. `is_active` is read in five places
  and written in none. A shop must get its sizes right first time, and the Help
  Centre now says so in as many words. **This is the next thing to build** — a
  picker over data nobody can maintain is half a feature.
- **A single size cannot be 86'd.** `sold_out_at` lives on products;
  `product_variants` has no such column. "Large is off tonight" needs a migration,
  a variant-scoped controller and a third refusal registered in
  `one-rule-many-paths.py`.
- **A recipe has no size dimension.** `recipe_items` keys on the dish, and
  `hasRecipe()` wins before the plain-product branch, so a half and a full plate
  consume identical ingredients.
- **Wholesale pricing ignores sizes** — variants have no wholesale column, and
  that is the stated design rather than a defect. The UI does not imply otherwise.
- **A variant change never moves `products.updated_at`**, so it could not reach a
  till through delta sync even once editing exists. Whoever builds editing has to
  touch the parent's timestamp.
- **A DEAL CANNOT NAME A SIZE.** Found while seeding demo data: `combo_items` has
  `combo_product_id`, `component_product_id`, `quantity` and no `variant_id`
  column, and `CreateSaleAction`'s component depletion calls
  `inventory->adjust(['product_id' => $component->id, …])` with no variant. So a
  deal bundling a varianted product — "3 noodles and a Cola" — sells fine and
  takes **no actual bottle of any size** off the shelf; it moves the parent's
  orphaned row, the same figure this whole entry is about.

  Same family as everything above, one level out: the deal knows *which product*
  and cannot know *which one of it*. Needs a column, a rule, a picker in the
  product form and a variant on the depletion call. Until then a shop should
  bundle plain products only — the demo deal that exhibited this was rewritten
  rather than left in a real shop's catalogue.
