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

**Nothing. 164 checks, 0 bugs, 0 queries** — the customer surface holds under
outside-in driving, including price tampering, the cross-shop smuggle, and every
ownership probe.

That is a real result and it is worth being explicit about why it is trustworthy:
**both new mutations are caught.** Pretend every order was accepted and the
sweep reports `AN ORDER REACHED INTO ANOTHER SHOP`; answer 200 to any customer
asking for any order and it reports `ANOTHER CUSTOMER READ THIS ORDER`. 28 of 28
mutations across the whole sweep.

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

## What this phase does NOT cover, and the run says so

The coverage table prints `R  1  mart`. **One shop of nine.**

A shop is only orderable when four things are true at once — active,
`online_shop_enabled`, `setup_completed`, and the `marketplace` module — and the
sweep's tenants have never needed the last two, because no phase before this one
was a shopper. So the ordering path is exercised against a grocery and nothing
else: no restaurant order with modifiers and a kitchen behind it, no pharmacy
order carrying a prescription item.

It is left that way rather than papered over. Making a second shop visible means
turning a module on with the admin token, which is state that outlives the run
and which phase F is simultaneously using to test module walls. The honest thing
is to report the number every time — which the coverage table now does, without
anyone having to remember.

## Cost of entry

`/auth/register` is under `throttle:auth` — five per minute per IP, shared with
every other login the sweep makes. So the two shoppers have stable addresses and
are registered once, then signed in from the token cache, and a 422 on a second
run means "already there" rather than a failure.
