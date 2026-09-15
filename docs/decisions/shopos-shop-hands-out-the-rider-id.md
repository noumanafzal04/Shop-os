# The shop hands out the rider id, instead of asking for one

**2026-09-15 · SHIPPED** · backend `fa9ba89`, panel `61626ca`, mobile `caf3bb1`

## The flow that was

A shop wanting its own rider on the app had to wait for that rider to:
install it, sign up, apply, send a CNIC, be approved by platform staff, find
`RDR-000123` on their own screen, and read it out. Only then could the shop
type it in.

Five steps belonging to somebody who is not the shop, for an outcome only
the shop wanted. Most never got past the first one.

## The flow that is

The shop adds a rider the way it already does — a name and a phone — and the
id is minted there and then, shown large and selectable the moment it
exists. The shop writes it down and hands it over. The rider installs the
app and **claims** it: `POST /rider/claim`.

Same code, opposite direction, and neither side learns a new idea.

## What it cost the schema

`rider_profiles.user_id` became nullable. That is the whole change — a
minted id is a profile with nobody behind it yet. The unique index stays:
MySQL and SQLite both allow many NULLs in one, so any number of ids may sit
unclaimed while no two accounts can ever share one.

Done with `change()` rather than a driver-conditional `ALTER`. Laravel 11
dropped the DBAL dependency and implements this natively, SQLite included —
and a MySQL-only statement would have left `user_id` NOT NULL in every test,
so the first unclaimed id would have failed on a constraint no test could
have seen coming.

## The hole it would have opened

A shop-minted rider is `approved`, because the shop knows them and is
vouching for them. That is exactly what the platform check is FOR when
nobody does.

But `setPlatform()` asked only `status->canRide()`. Right while every
approved profile had been approved by a person; **wrong the moment a shop
can mint one**. Any shop could add anybody, and that person could flip
themselves into the CartZe pool and start carrying strangers' goods and
strangers' cash — no CNIC, no licence, nobody having looked at them once.

`vouched_by_tenant_id` closes it. An approval with a shop's name on it and
no `approved_by` is **a shop's word**: good for that shop, good for nothing
else.

Two things fall out of that sentence and both matter:

- **Only joining is fenced.** Leaving the pool always works. A rider who
  wants to stop being offered strangers' work is never somebody to argue
  with, whatever state their account is in.
- **The fence had to be a door.** `apply()` refused *every* approved
  profile, so a shop-vouched rider would have been told "you are already
  approved" by the same system that had just told them they are not approved
  enough. It refuses only a platform-approved one now.

## A control that always fails

The board's empty state offered **"Take CartZe deliveries"** — which, for a
shop-vouched rider, can only ever answer 403.

That is the Purchasing-job shape exactly (`shopos-job-offered-must-be-doable`):
offered by four surfaces, bounced by every screen behind it. A control that
always fails is worse than no control, because the user concludes the app is
broken rather than that there is a step left.

`can_join_pool` comes down from the server and the button becomes **"Apply
to CartZe"**, which is a road that goes somewhere.

## Two tests broke, and both were right to

**`has_app` read `$p !== null`.** The same question, while a profile only
ever existed because a rider had made one. Not any more: an id nobody has
claimed is a piece of paper in a drawer. It means CLAIMED now, and the
original migration's promise holds —

> a shop with no app-using riders behaves tomorrow exactly as it does now

— because no live pin, no handover code and no rider-driven status are each
gated on something only the app can set. Now asserted out loud rather than
left to be rediscovered.

**"The card has no profile behind it, which is the normal case and always
will be."** The prediction expired. It asserts no *person* behind it now,
which is the property it was always about.

And in mobile, `blocked?.code === "not_platform"` broke when the branch grew
a third arm. Nothing it was written to protect had changed — only the
operator. It matches the reason and the action now, not the comparison.
A test pinned to an operator is pinned to the wrong thing.

## Mutations

Ten, all caught.

| Mutation | Result |
|---|---|
| Pool fence removed | 1 fail |
| A shop's word counted as the platform's | 4 fail |
| Minted rider not approved | 4 fail |
| Claim ignores an id somebody already holds | 1 fail |
| Panel: code dropped from the Add reply | 1 fail |
| Panel: code put back behind `has_app` | 1 fail |
| Panel: a timer added to the code panel | 1 fail |
| Mobile: pool gate removed | 3 fail |
| Mobile: claim card gone | 2 fail |
| Mobile: server's reason swallowed | 1 fail |

Backend 2723 passed / 2 skipped · panel 1536 · mobile 772.

## Not built

- **Claiming by phone instead of a code.** Considered and set aside: the
  shop already has the rider's number, so it would remove the paper
  entirely. It needs a signup hook that links on first registration, and it
  leaks nothing only because the shop typed a number they already had.
  Worth revisiting.
- **A shop revoking an id.** Removing the rider soft-deletes the `Rider`
  bridge row; the profile and its code survive. That is correct for history
  and wrong as a permission story, and nothing currently asks.
