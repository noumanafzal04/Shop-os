# Whoever can act on it, not whoever owns the shop

**Date:** 2026-08-25
**Status:** shipped — `NotificationService::notifyWhoCanAct()`
**Closes:** the question left open by [everyone-minus-one-role](shopos-everyone-minus-one-role.md)

## What was wrong

Every operational notification went to shop **owners** and to nobody else.
`notifyTenantOwners` filtered to `UserRole::ShopOwner` by construction, and all
four senders used it: low stock, near-expiry, a new order, a reservation.

So the stock keeper was never told a shelf had run down. The person packing
orders was never told one had arrived. And `/notifications` sits behind no role
gate — the bell renders for every signed-in role — so there was a bell in front
of them the whole time and nothing that could ever be put in it.

## The rule

> **Whoever holds the permission that lets them act on it.**

**Not a role.** There are no job roles in this codebase; cashier, waiter and
stock keeper are permission *sets* a shop assembles
([no-roles](shopos-no-roles.md)). A `notifyTheCashier` would reintroduce exactly
the concept a whole release was spent removing.

**And it answers the question that was left open.** When this gap was first
found, the note said: *"whether a cashier should hear about low stock is the
shop's call."* It is — and the shop has already made it.

> **The permission IS the setting.**

A shop that does not want its counter staff chasing stock does not hand out
`inventory.manage`. A shop that does has said, in the only place the system can
hear it, who deals with stock. A separate notification switch would be a second
answer to a question already answered, and the two would drift — which is the
failure this repo keeps meeting under other names.

Owners hold every permission implicitly, so they keep receiving everything.
**Nothing is taken away from anybody.**

## It follows the branch

`atBranch` is passed for events that belong to one shop in a chain. A shelf that
runs down in Gulberg tells the people who work in Gulberg; an online order tells
the branch that is filling it — which, since
[nearest-branch-fills-it](shopos-nearest-branch-fills-it.md), is chosen by
distance. Telling five branches about one branch's order is how a shop learns to
ignore the bell.

**Staff with no branch recorded are included, not excluded.** An
over-notification makes somebody ask a question; an under-notification makes
nobody ask anything. The same asymmetry the outbox uses for unsent sales.

## `notifyTenantOwners` is deleted

Once the four senders moved, it had **no callers in the app and none in the
tests**. Keeping it "in case an owner-only notification comes along" is how this
repo accumulated seven findings of the shape *built, and nothing reaches it*. If
an owner-only message is needed later it is four lines.

## Proven by mutation — and one mutation proved my comment wrong

| Mutation | Failed |
| --- | --- |
| audience back to owners only | 4 of 6, including *the person who reorders is told* |
| permission ignored | *somebody who cannot act on it is not told* |
| branch scoping dropped | *only the branch whose shelf ran down is told* |
| **one shared dedupe key** | **nothing** |

The last one is the useful one. I had written that the per-recipient dedupe
suffix was what stopped the first person told from silencing everybody else.
Replacing it with a single shared key changed nothing, because
`app_notifications` is already `unique(user_id, dedupe_key)` — the dedupe was
per-person by index all along.

The code was fine; **the comment stated a rule that line does not implement**,
which is precisely the failure recorded in
[promise-in-another-file](shopos-promise-in-another-file.md). Written, this time,
by me. The suffix stays for continuity — every row already written carries it,
and dropping it would make one already-sent alert look new and fire again on the
day it shipped — and the comment now says that instead.

## The shop is told

Assigning a permission now has a consequence that is invisible from the
checkbox, so the Help Centre says it in the staff topic, and says it as the
setting it is: *"if you would rather your counter staff were not chasing stock,
simply do not tick the stock boxes for them — that is the setting, and there is
no second one to find."* A shopkeeper hunting for a notifications screen will
not find one, and should not have to.
