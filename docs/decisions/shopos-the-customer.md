# Phase R — the customer

**2026-08-20** · `docs/qa/sweep/phase_r.py`

## The hole

Every phase before this one runs as somebody who **works at the shop**: an
owner, a cashier, a stock keeper, a super-admin. Seventeen phases, 1,683 checks,
and **not one of them had ever been the person the shop exists for.**

That is not a gap in coverage of a feature. It is a whole actor, reached with a
role no sweep token has ever carried (`role:customer`), holding a whole surface:
`/marketplace/*` to look, and `/customer/*` to keep addresses, leave reviews,
hold reservations and **place orders**.

## Three kinds of question

**The order.** A customer names products and quantities and **never a price** —
the shop's own catalog decides what it costs. The request rules carry no price
field, so a price cannot be validated in. That is a reason to check rather than
a reason not to: the day somebody adds one for a legitimate path, this is what
notices.

**The boundary.** `shop_slug` and `items.*.product_id` arrive **in one body and
nothing in the validation ties them together**. An order naming one shop and
carrying another shop's product is one request away, and if it were accepted the
shop would be told to hand over goods it does not stock, priced from a catalog
that is not its own.

**The owner.** Orders, addresses, reviews and reservations are all "mine". Every
one of those controllers scopes by the signed-in user — reading them says so.
**Reading is not proving**, and this is the class where a single missing `where`
is somebody else's address book.

Two customers exist in this phase on purpose. *A check that one person cannot
see another person's things is meaningless with one person.*

## What it found

**Nothing. 185 checks, 0 bugs, 0 queries** — the customer surface holds under
outside-in driving, including price tampering, the cross-shop smuggle, and every
ownership probe.

That is a real result and it is worth being explicit about why it is trustworthy:
**both new mutations are caught.** Pretend every order was accepted and the
sweep reports `AN ORDER REACHED INTO ANOTHER SHOP`; answer 200 to any customer
asking for any order and it reports `ANOTHER CUSTOMER READ THIS ORDER`. 28 of 28
mutations across the whole sweep — 29 of 29 with the chemist's added.

## What the phase did to itself first

Two harness bugs before it could say anything true, and both are old friends.

**A 404 read as access.** The role fence pointed at `/reports/sales`, which does
not exist. A 404 came back, the check saw "not 401 or 403" and reported *A
CUSTOMER CAN READ THE SHOP'S TAKINGS*. **404 is not a refusal — it is "no such
route"**, and reading it as one accuses the product of a hole that is really a
typo in the test. Exactly the mistake phase I made with 403 and `MODULE_DISABLED`.

**The best check quietly did not run.** The cross-shop probe looked for a second
shop among the ones a *customer can see* — and only one of the sweep's eight is
listed on the marketplace, so it found none and reported "no second shop to
borrow from". The denominator printed `shops a customer can reach — 1 of 8`
right above it, which is the only reason it was obvious.

The fix is also the better test: the product is borrowed from **any** other shop
the sweep built, visible or not. **A shop being invisible to shoppers makes its
products a better probe, not a worse one** — nothing about that request should
reach them.

## Widening it, and the question that was waiting there

The first run covered `R  1  mart` — one shop of nine. A shop is orderable only
when four things are true at once (active, `online_shop_enabled`,
`setup_completed`, the `marketplace` module), and sweep tenants had never needed
the last two because no phase before this one was a shopper.

That is not a smaller version of the same test. A grocery order is the *easy*
path; the interesting ones are a restaurant's and a chemist's. So the phase now
opens them itself — the platform's switch with the admin token, the shop's own
switch with the owner's — and says which of the two refused when one does.
Coverage went **1 → 3**.

And the chemist had a question waiting that nothing in the sweep had ever asked.

### A prescription-only medicine, ordered by a stranger on a phone

At a counter, a chemist looks at the paper. That is the entire point of
`requires_prescription`. An online order has nobody standing there, and the
request carries **no prescription field at all**.

The product refuses it — `RX_IN_PERSON_ONLY`, *"requires a prescription — please
visit the pharmacy to purchase it."* Good.

**But the first version of this check would have passed either way.** It read
only the status, and the medicine it created had `stock_quantity: 0.000` — so a
422 for having none would have read exactly like a 422 for needing a
prescription, and the check would have gone green having tested the stock rule.

Two fixes, and both are the same lesson: put stock on the shelf first so the
other rule cannot fire, and then **require the refusal to name the
prescription**. A refusal is not enough; it has to be a refusal about the thing
being tested.


## Cost of entry

`/auth/register` is under `throttle:auth` — five per minute per IP, shared with
every other login the sweep makes. So the two shoppers have stable addresses and
are registered once, then signed in from the token cache, and a 422 on a second
run means "already there" rather than a failure.


---

## The dish that is not only a dish

**2026-08-20.** Every other line in this phase is *this thing, n times*. A
modifier is the one place where the customer changes both the **price** and the
**recipe**, and it is the only part of an order where three separate things must
all be true and each fails quietly on its own.

**SHOWN.** The menu has to publish the choice and what it costs. A group with
`min_select 1` that the shopfront never sends is a dish nobody can order — the
order is refused for missing something the customer was never offered, which
reads to them as a broken shop.

**CHARGED.** The delta comes off the shop's own option row. The customer sends
option ids and never a number, exactly as they send product ids and never a
price.

**REMEMBERED.** The line carries what was chosen. If the snapshot is empty the
customer pays for stuffed crust and extra cheese and the kitchen reads a plain
pizza — **the one failure money cannot reveal**, because the total is right.

All three hold, along with the fences: a required group cannot be skipped, a
group's limit holds, and an option belonging to a **different dish** is refused
(`MODIFIER_INVALID`). Each refusal is required to *name the rule it enforced* —
a 422 for having no stock and a 422 for needing a crust are indistinguishable by
status, which is the mistake the prescription check made on its first run.

`ModifierResolver` is deliberately one implementation shared by the POS and the
online order. That is the right design and is also why none of these checks are
about its arithmetic: **shared code diverges in what it is HANDED, not in what it
does**, and nothing had ever handed it anything from outside.

### The hop nobody drove

Completing an order rings a real Sale down the `trusted_prices` branch — the one
that carries the captured `unit_price` and `modifiers` forward instead of asking
the resolver again. The branch exists for two reasons written into the code, and
both are invisible from the customer's side: re-pricing would add the +300 to a
price that already contains it, and re-validating would reject a required crust
on a line whose option ids are long gone.

A deliberate branch with a comment explaining itself is worth exactly as much as
the test that drives it. This one had never been driven by anything. It holds:
the customer agreed to 1100, the till rings 1100, snapshot intact.

### And a second question, which did not hold

Asking what else was on the customer's side of the wall turned up
`Product::scopeSellableToday()` — **one definition, zero callers**. See
[sold out at the counter, on sale in the app](shopos-sold-out-in-three-places.md).
