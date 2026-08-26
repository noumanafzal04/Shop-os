# The rule applied to half of itself

**2026-08-26.** Six screens in one batch — staff permissions, the order queue,
taking an order, subscription, reports, and the route guards behind them. Four
of the six were the same shape, and it is worth naming because this codebase
keeps producing it:

> A rule is applied to one half of a screen and not the other half, and the
> half that was missed looks finished.

---

## The four

| Screen | Filtered / correct | Not |
|---|---|---|
| Staff | the job **presets**, by module and trade | the nineteen **checkboxes** they tick |
| Orders | the server accepted `channel`, `open_only` | the screen sent neither |
| Subscription | eleven modules in the map | **three** named on screen |
| Sales (earlier) | the export honoured filters | the screen could set none |

None of these look broken. The staff form draws nineteen checkboxes and every
one of them works. The subscription page lists three modules under a heading
that says "what your shop runs", and all three are correct. That is what makes
the shape survive: **the missing half is not an error state, it is a smaller
true thing.**

---

## Staff: flagged, never dropped

Filtering the checkbox list has a trap the presets did not. The form submits
the boxes it drew, so a permission that is hidden is a permission that is
**revoked on the next save** — by somebody correcting a phone number.

So the server returns everything and marks what this shop cannot use. The
screen hides the irrelevant ones, *except* any the person actually holds, which
appear in a group of their own: "Held from a part of the shop you no longer
use". A permission can only be given up on purpose.

This is the same trap `categoryOptions(keepId)` avoids on the expense form.
**Filtering a list of choices is safe. Filtering a list that is also the
submitted state is a silent edit.**

### The reversal it forced

`StaffPresets` used to grant a preset's full list even where a module was off,
argued explicitly: the module gate is the real boundary, such a permission is
inert, and trimming would leave an invisible gap.

That argument held *while the checkbox list showed everything*. With the list
filtered, an untrimmed preset grants a permission with **no checkbox to see it
by** — visible only as a chip reading "Serve any table" against a mart that has
never had a table. The invisible gap the old note was avoiding, arriving
through the other door.

The invariant is now asserted directly — *no preset may tick a box its own shop
is not shown* — and that assertion is what found it.

---

## Orders: the card was wrong, and the report came in an hour

The first version drew a card per order: every item, the address, the notes,
the rider picker, both buttons. Four orders filled a laptop. A shop working a
lunch rush has forty.

The row now carries only what is needed to **choose** — stage, number, how long
it has been waiting, who, how much, the one forward step — and a click opens
the rest.

**The columns step down rather than scrolling sideways.** A nine-column table
on a 390px phone is not a table that needs a scrollbar; it is a table with
columns that have not earned their place there. The steps are `sm` and `xl`,
not `sm` and `md`, and that is measured rather than reasoned: the rail takes
290px from `lg` up, so a **1024px tablet has 734px of page — less than a 768px
phone in landscape**. 768 was 87px over until the second step moved to `xl`,
and reading the class names would never have told me that.

### How long somebody has been waiting

The card printed no time at all. Not the age, not the clock — on a screen whose
entire purpose is deciding what to pick up next.

Thresholds are **per stage**, because five minutes unconfirmed is a customer
deciding to ring somebody else and fifteen minutes on a bike is normal. A
single ceiling would either shout on every delivery or say nothing about the
one nobody has answered.

---

## Take an order: a modal holding a whole screen's work

A channel picker, four fields, a product search, the whole catalogue in a 160px
scroller, the basket, a total and the notes — everything a shop does while
somebody is on the phone, in a box smaller than the screen it was drawn on.

It is the same job as ringing a sale, so it is the same layout on the same kind
of screen. The catalogue is browsable: a first page on load, search narrows,
"Show more — N to go" adds. The old list showed one page of fifteen with
nothing saying the rest existed.

And **stock is on the tile**, not in the refusal. Behind that:

> `Insufficient stock: only 0 in stock.`

That reached the counter, the order form and the transfer screen with nothing
in it anybody could act on. A basket of nine items told the shop one of them
was short and would not say which, so the only way through was to pull lines
out one at a time until it stopped complaining. It names the item now — and
still says how many there are, which is the other half of actionable.

---

## The guards, and the parser that was wrong three times

Adding `/tenant/orders/new` to `src/test/routes.ts` made **four suites fail at
once**: the browser walk, the permission map, the menu-reach guard, the
permission count.

That is the system working, and it exposes something worth writing down. All
four ask "is every screen covered" — **of that same set**. So a screen missing
from the set is invisible to all four simultaneously, and every one of them
reports success. Three green guards and an undocumented, unwalked, ungated
screen.

The set is now checked against the router. Four attempts:

1. **Prefix every relative path with `/tenant`.** `<Route path="products">`
   holding `<Route path="new">` came out as `/tenant/new`. Reported screens the
   app does not have and missed ones it does.
2. **A tag regex with depth tracking.** Found eight routes in a file declaring
   fifty — because `element={<Page />}` contains a `>`, and every pattern
   trying to find the end of a `<Route …>` tag stops inside it.
3. **Compare bare segments instead.** Honest, robust, and *useless for this
   bug*: `orders` and `new` were both already known segments, so it could not
   have caught the thing it was written for. Verified by mutation, which is the
   only reason this was noticed rather than shipped.
4. **Strip `element={…}` by matching braces**, then walk the tree with a stack.
   Brace matching is something a scanner can do reliably; JSX nesting is not.

> A scanner that is wrong is worse than no scanner. It fails on screens that
> are fine, until somebody deletes it.

---

## Extracted, because each was about to be written a third time

| Rule | Where it was | What the test found |
|---|---|---|
| `sellingPrice` | the till, New Sale — identical | neither was tested on `discount_price = 0`, which read literally gives the product away |
| `formatQuantity` | three spellings in four files | two disagreed on `String(Number(0.1 + 0.2))`; and `Number("")` is `0`, so an absent quantity printed as a confident zero |
| `elapsed` / `urgencyOf` | nowhere — the admin one is day-scale | — |
| `nextStep`, `orderStage` | inline in one component | — |

---

## Rules worth keeping

1. **When you filter one half of a screen, ask what the other half is.** The
   presets were filtered; the checkboxes were not, for months.
2. **Filtering a list that is also the submitted state is a silent edit.** Flag,
   do not drop.
3. **A refusal has to name the thing it is about.** "Only 0 in stock" is a
   sentence nobody can act on.
4. **Breakpoints are the viewport; the useful width is the viewport minus the
   rail.** A 1024px tablet has less page than a 768px phone in landscape.
5. **Several guards sharing one list share one blind spot.** Check the list
   against its source.
6. **Mutate a new guard before trusting it.** The segment comparison passed
   everything and could not have caught its own bug.
