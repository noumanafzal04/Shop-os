# A customer the platform made can be found again

**2026-10-09 · reported by the owner**

> "Admin side py customer create ho rhy lkn show ni hoty."

## What was wrong

Exactly what was said. The admin "Customers" screen was one form, and the API
behind it was one `POST`. It made an account, said "can sign in now" — and
there was no list for the account to be on. Somebody made for a caller on the
phone could not be checked, corrected, given a new password or switched off; it
could not even be confirmed that the account existed.

## Now

The screen is the list.

- **Who they are, and what they amount to**: orders across every shop, what
  they have spent on *delivered* orders, when they last ordered, when they
  joined, whether they can sign in.
- **Five figures above it**, counted by the server rather than read off the
  open page: customers, have ordered, new this month, can sign in, switched
  off. Two of them are the filter they describe.
- **Search** by name, phone or email; filters for status and ordered-or-never;
  five ways to sort; a pager.
- **New customer** is a dialog. The account just made is at the top of the
  list when it closes.
- **One person's card**: the shops they ordered from, their addresses, and what
  staff do to an account — correct it, set a password (which signs them out
  everywhere), switch it off and back on.
- **Remove account**, for one made by mistake — and only for somebody who has
  never ordered. `orders.customer_id` cascades: removing a customer who has
  ordered would take a sale out of a shop's own history. Those are switched
  off instead, and the card says why there is no button.

A customer here is a `users` row with the role `customer` — somebody who orders
from any shop. It is never a shop's own customer book; and every route that
takes an id is fenced to that role, so this screen cannot reach a shop's owner.

## Also: the admin console's own furniture

`admin/components/kit.tsx` — `PageHeader`, `StatTile`, `Person`, `Pill`,
`Card`, `Empty` — and `face.ts` (initials in a colour worked out from the name,
so the same person is the same colour everywhere). Flat tints, no shadows. This
page is the first to use it; the rest of the console follows.

## Held by

- `AdminCustomersTest` (11) and `e2e/admin-customers.spec.ts` (one walk).
  **Twenty mutations, twenty caught** — one survived the first run (an account
  with neither phone nor email) and the walk was tightened until it did not.
- Two of the panel's own guards caught slips on the way: a row of tiles that
  said nothing about tablets, and a reversible "Switch off" coloured as if it
  destroyed something.

## A trap, recorded

Widening the admin test pattern to `/admin-[a-z-]+\.spec\.ts/` handed the
admin project `journey/11-the-admin-returns.spec.ts` — a stage of the journey,
which is lived once. Anchored on the folder now.
