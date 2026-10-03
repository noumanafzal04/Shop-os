# What a plan includes

**2026-10-04.** Branches, staff logins and checkout lanes are on the plan.

They were on neither the plan nor anywhere else — assigned by hand, one shop
at a time — so Basic and Enterprise granted identical organisations until
somebody remembered to type otherwise. The ladder being sold existed in a
salesperson's head and not in the software.

## The arithmetic

```
effective  =  (this shop's override  OR  the plan's included)  +  bought
```

Three terms, each independently testable, and the bug being replaced was not
any one of them being wrong — it was that only one of them existed.

## Null reads two ways, on purpose

On billed usage — products, storage, bills a month — `null` is **unlimited**.
That is what a plan is for.

On organisation size — branches, staff, tills — `null` is **this plan has no
opinion**, and the shop falls to the platform default (1, 5, 2). Never
unlimited, because "however many staff accounts you like" is how a shop ends
up with forty and finds out during an audit.

Collapsing the two would have been tidier and wrong in the dangerous
direction: every plan that pre-dates these columns holds null, so the tidy
reading would have handed every shop on the platform unlimited branches
overnight. That asymmetry is what makes the migration safe.

## Capability is still not capacity

A plan grants no modules and never will. What a shop may **do** is decided
per shop; how **much** it may have is sold.

The single crossing is offline selling, and the exception is argued rather
than assumed: a module describes the SHAPE of a trade — a pharmacy has no use
for a kitchen docket — while offline selling is wanted by every shop in the
country and costs real money to support. That makes it a rung, not a shape.

The offline **hard stop** stays with the shop. It is a safety preference an
owner chooses for themselves, not something anybody sells.

## Grace, because a till must never stop

The bills meter has room past the included figure, and three words instead of
one:

| | |
|---|---|
| `reached` | at the included figure. Nothing is wrong. |
| `grace` | past it, inside the room the plan allows. An upsell, not an incident. |
| `over` | past the grace as well. Still not a block — an account to ring. |

One word covered all three before, so a shop one bill over and a shop four
thousand over read identically, which is how the second goes unnoticed for a
month. Nothing refuses a sale at any point.

## A plan change is not a new month

4,500 bills rung on Basic are 4,500 of Pro's 100,000 the moment the plan
moves — not zero. The meter is counted live from the subscription
anniversary and the plan never touches it. `GraceBeforeTheWallTest` holds
that in place in both directions, including the downgrade that leaves a shop
reading 11 / 10.

`GET /admin/tenants/{id}/plan-change` previews the whole move before it
happens: the price difference, every ceiling that shifts, and every ceiling
this shop would land **over**. It refuses nothing and writes nothing — a
downgrade past a ceiling is an ordinary commercial situation, and the
software's job is to say so, not to decide.
