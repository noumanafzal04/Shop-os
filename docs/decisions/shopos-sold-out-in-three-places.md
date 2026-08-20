# Sold out at the counter, on sale in the app

**2026-08-20** · `OrderService`, `AddTicketItemsAction`, `MarketplaceController`, `SoldOutTest`

## The button

"Eighty-six the fish." A kitchen runs out mid-service and somebody presses the
circle-and-slash on the row. It has its own column (`sold_out_at`), its own
controller, its own permission, and a comment explaining why it is not the same
as deactivating a product: **deactivating is a catalog decision made once,
eighty-six is a service decision made mid-shift and undone when the delivery
lands.**

It shipped with eight tests. All eight ask the till.

## One question, three answers

The question a shop asks about an item is **may this be sold right now**, and
this codebase has three places that can start selling one:

| path | what it did |
|---|---|
| `CreateSaleAction` — the counter | **refused.** `ITEM_SOLD_OUT` |
| `OrderService::place` — the app, and the phone | **took the order** |
| `AddTicketItemsAction` — the dine-in tab | **printed the kitchen ticket** |

The counter was the only one that had ever been asked. So the cook presses 86,
the till stops offering the fish — and the delivery app keeps taking orders for
it all evening, while a waiter can still put it on table six.

## The part that makes it worse

`CreateSaleAction` **deliberately exempts** the trusted path from this rule, and
says why:

> a dine-in tab, an online order or a reservation is food the customer already
> committed to, usually already eaten. Refusing to take their money because the
> kitchen has since run out is not a protection, it is a shop that cannot close
> a bill.

That reasoning is right, and it is only safe **if placement refused first**.
Placement never did. So for an online order the rule was enforced at neither
end — not when the customer ordered, and not when the shop billed it. The
exemption was load-bearing on an assumption nobody had checked.

*A comment that assumes another path did the work is a dependency, and an
unchecked dependency is not a design — it is a hope.*

## What changed

**`OrderService::place`** refuses a sold-out product, for a marketplace order
and a phone order alike. `visible_in_marketplace` is relaxed for a shopkeeper on
the phone because publishing is the shop's own business; **running out is not a
publishing decision**, and promising food that does not exist is the same broken
promise down a phone as through an app.

**`AddTicketItemsAction`** refuses it too, unconditionally — adding a line to a
tab is always *more food*, never the closing of a bill. What has already been
eaten is settled by `SettleTicketAction`, which does not come through here.

**`MarketplaceController::publicProduct`** publishes `sold_out`. Published
rather than filtered out, for the same reason the serving window is: the shop
*has* this normally, the customer wants to know it exists, and the flag comes
off tomorrow. Without it the only way to find out was to build a basket and be
refused at checkout. This is the same field name and the same choice the POS
mirror already made — a dish that vanishes from a menu is indistinguishable from
one the shop never sold.

An order placed **before** the press still completes. That is not an oversight
left in; it is the reason the exemption exists, and it now has a test holding it
down.

## How it was found

Not by a test, and not by reading `SoldOutController`. By asking what else was
on the customer's side of the wall while writing the modifier checks for phase R
— and noticing that `Product::scopeSellableToday()` had **one definition and
zero callers**.

*A scope nobody calls is a rule nobody enforces.* Worth grepping for, on any
flag that matters.

## The tests

Five, in `SoldOutTest` beside the eight that only ever asked the till. Four were
red before the fix; the fifth — the order taken *before* the press, completing —
was green before and had to stay green.

Phase R of the sweep asks it from the outside as well, of every shop and not
only the restaurant: 86 the item, watch the counter refuse it, watch the app
refuse it, **then put it back and order it again**. That last step is the whole
check — without it there is no telling "refused because it is sold out" from
"refused because this shop is shut". The refusal has to be *caused by* the flag,
not merely coincide with it.

---

## The grep, kept

**2026-08-20, later.** `Product::scopeSellableToday()` was found by hand. That
technique is worth more than the one finding, so it is now
`shopos-backend/scripts/dead-rules.py`: every method on a model whose **name is
a decision** — `is*`, `has*`, `can*`, `must*`, `requires*` — and which nothing
anywhere calls.

Fifty-seven such names. Ten had no caller. **One of the ten was a real gap.**

### `StockDisposal::isCredited()`

`POST /inventory/disposals/{id}/credit` records what a distributor actually paid
against goods sent back. It checked the permission, checked the disposition was
a supplier return, and **never checked whether a credit had already been
recorded** — so a second call silently replaced a settled money figure with a
different one, and the "to claim" worklist did not reopen.

*The screen was already right, which is what hid it.* The "Credit received"
button disappears the moment `credit_received_at` is set, so a person clicking
through the panel could never do this twice. But the API is the contract, and a
retry, a double tap on a slow connection, or anything that is not this screen
could do it.

Refused, not kept-first: pressing 86 twice is the same intent repeated, and
recording two different amounts is not. The refusal names what is already on the
row, because a bare 409 leaves the shop guessing whether their entry landed. A
khata repayment is append-only — a new ledger row each time — so it has no such
problem; this is a single slot, and a single slot is settled once.

### The other nine were fine, and that is the point

Seven were one-line derivations of a field that other code checks directly:
`isRequired()` returning `min_select > 0` while `ModifierResolver` reads
`min_select` itself. Two more had the rule enforced **in the query rather than
the predicate** — `OtpService::verify` selects `whereNull(consumed_at)` under a
row lock, so an OTP cannot be replayed even though `isConsumed()` is never
asked.

So these are **leads, not findings**, and the tool says so. Every one carries a
line in `SETTLED` giving the answer to a single question — *does another path
enforce this rule, or does nobody?* — including when the answer is "it is
redundant", because that is the common case. A lead with no line is unexamined;
an entry whose method has since gained a caller, or vanished, is reported, since
a stale exception list is worse than none.

### What the tool got wrong, twice

**It read 62 of 74 rules as uncalled.** Its pattern excluded `>` in order to
skip declarations — which is exactly how PHP calls a method. It reported
`isSoldOut()` as unused an hour after it was wired into three call sites.
*Suspect the parser before the code: a detector that finds far more than it
should has usually stopped reading the language.*

**Then it could not find the bug it was built from.** With the credit guard
deliberately removed, the scan still reported no lead — because the controller's
own docblock explains that `isCredited()` had sat unused, and the test beside it
says the same, and both lines contain `isCredited(`. The grep counted the
explanation as a call. **Comments out, code in**, the same rule
`confirm/native.test.ts` had to learn: a file that explains the mistake it
stopped making is not making it.

`--prove` now asserts both, by name, before it reports anything.
