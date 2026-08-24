# When a Large uses more than a Small

**2026-08-24 · backend + panel**

## Measured first

A recipe belonged to a DISH. Before anything was designed, a sized dish with a
`2 dough` recipe was created through the real API and sold, one of each size:

```
CREATE sized dish + recipe → 201
sizes stored: 2 · recipe rows: 1
one SMALL sold → dough 2 consumed
one LARGE sold → dough 2 consumed
```

Nothing refused, nothing logged. **The feature had been built one dimension
short of the thing it describes.** A pizzeria's ingredient stock was right for
one size at most, and its food cost — the number a kitchen is actually run on —
was wrong for every other.

`bomSnapshot()` had even written the fact down: *"A recipe has no sizes and
passes null."* True when it was typed, and by then a comment stating a rule
implemented nowhere.

## And one thing I was wrong about

I read `OrderService` and concluded the online door deducted no recipe at all.
The probe said otherwise: an order deducts at COMPLETION (`97 → 94`), because
completing rings it through `CreateSaleAction`. It holds nothing at placement,
which a deal does — a real difference, but a defensible one and not the bug I
was about to file. **The probe existed to check the thing I was sure of.**

## Override, not addition

A size's rows REPLACE the dish's rows. They are not added to them.

Addition reads fine in a sentence and then cannot express the ordinary case: a
Large that uses **more of the same flour**, not extra flour on top of the
Small's. Override says "the Large is made differently, here is how" — which is
what a chef writing it down means.

A size that names nothing falls back to the dish's own rows. That is what every
recipe in the database is today, so nothing that worked stops working and no
shop retypes anything.

## One answer, four readers

The counter deducts it, the return restores it, the BOM snapshot records it and
`RecipeCost` prices it. Four copies of "which rows apply" is four chances for
one of them to forget the size — the shape that has already cost this codebase
a kitchen ticket for a dish that was off, and a deal that could not be sold at
all. So it is asked once, in `App\Support\RecipeFor`.

The snapshot matters more than it looks: it is what a REFUND restores. Without
the size there, returning a Large would put a Small's flour back.

## Said, not refused

A dish with sizes whose recipe names none of them gets a warning, not a 422.

The deal case was refused at save because the deal was **unsellable** — a
certain 422 at the counter, moved earlier to where somebody could fix it. This
is different: the dish sells fine, it just deducts a figure that is wrong for
some sizes. Refusing would break every shop that has done nothing but write a
recipe the only way the software allowed, and a kitchen may genuinely portion
the same across sizes.

## `distinct` had to go, again

`recipe_items.*.ingredient_product_id` carried `distinct`. With sizes, **the
same flour once for the Small and once for the Large is the commonest sized
recipe there is.** The pair `(ingredient, size)` is what must be unique, which
a validation rule cannot express — so it moved into the action, where a genuine
duplicate is still refused (`RECIPE_DUPLICATE`).

Same removal as the deal's `component_product_id`, for the same reason, five
days apart.

## Where the question is asked

On the row, beside the ingredient — and **only once the dish is saved**. A size
still being typed into the grid above has no id for a recipe line to point at,
so offering it would collect an answer that cannot be stored.

## A test that would have skipped itself out of existence

The e2e spec for this **cannot run**: the fixture shop is a mart, and
`itemTypesFor('mart')` is `["physical_product", "deal"]`. It asks the server for
a food dish, is refused, and skips — forever, printing as a line in a green run
while covering nothing.

Rather than delete it or pretend, the suite gained `e2e/skipReporter.ts`, which
separates the two kinds of skip:

- **by project** — a flow proven once, not re-proven at four widths. Counted.
- **by what the shop or server said** — NAMED, with its reason.

> Checks that did not happen do not appear in a list of checks that did.

The same rule the sweep learned when three phases picked their own shops and a
green summary hid five trades nobody had looked at.

## What is still owed

A food fixture shop. Until there is one, no browser test can reach dine-in,
KOT, menu hours or recipes — a whole vertical that is proven only by backend
tests. The reporter now says so out loud on every run instead of leaving it to
be noticed.
