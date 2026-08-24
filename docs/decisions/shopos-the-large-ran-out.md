# The Large ran out. The Small did not.

**2026-08-24 · backend + panel**

## What it cost

Eighty-sixing was a decision about a PRODUCT. So a pizzeria that ran out of large
bases had exactly one move: take the whole pizza off. **Small and Medium went
with it, all evening, on the busiest item on the menu.**

A size is what a customer orders and what a kitchen runs out of, so a size is
what has to be markable.

The product-level flag is untouched. "No pizza tonight" is a real sentence a shop
needs to be able to say, and it is not the same sentence as "no large".

## One rule, because three paths sell

The counter (`CreateSaleAction`), an online order (`OrderService`) and a dine-in
tab (`AddTicketItemsAction`) each asked "is this off?" in their own words. That
has already cost this shop once: `ITEM_SOLD_OUT` lived on the counter alone, so
the app took the order anyway and the tab printed a kitchen ticket for a dish
that was off.

A two-part rule written three times is **three chances for one of them to check
the product and forget the size.** So it lives in `App\Support\SoldOut`, once,
where `scripts/one-rule-many-paths.py` can see all three consult it.

**The size is asked first**, because it is the more specific answer and the one a
customer hears:

> "No large, but we have medium" is a sale.
> "No pizza" when only the large ran out is a lost evening.

## "Trusted" is deliberately not a parameter

A dine-in settle and an online order's capture are food the customer already
committed to, usually already eaten. Refusing to take their money because the
kitchen has since run out is not a protection — it is a shop that cannot close a
bill. Those paths simply **do not call** the rule. Putting the decision inside
the helper would hide a choice each path has to make out loud.

## Where a chef presses it

Not in the product editor. That argument was already written down when 86 was
built — *a chef is not opening a thirty-field form twice a day* — and it still
holds. So it is the **same button on the row**, which now asks *which* when there
is a which: a small sheet listing the sizes, one tap, no form. The product-level
option sits at the bottom of that list.

## Two shapes, and the translation between them

The offline mirror carries `sold_out: boolean`; the till's `ProductVariant`
carries `sold_out_at: string | null`. A device has no use for *when*. `browse.ts`
translates, as it does for every other field whose two shapes differ — passing
the mirror through untranslated is exactly how `stock_quantity` once came back
`undefined`.

The field is optional, and **absence reads as "on"**. A device that has not
synced since this shipped carries rows without it, and reading a missing flag as
"sold out" would silently empty a menu.

## Route binding needed a fence

`/products/{A}/variants/{B}/sold-out` resolves both independently. Without a
check, a shop could 86 another product's size through a URL — and **the reply
would name one product while the flag landed on another's**. It is a 404 now,
with its own test.
