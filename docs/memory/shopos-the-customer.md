---
name: shopos-the-customer
description: "Phase R — the QA sweep finally drives the CUSTOMER (role:customer): orders, addresses, reviews, Rx-only medicines, dish modifiers, 86/sold-out. 204 checks, 36/36 mutations"
metadata:
  type: project
---

**2026-08-20.** Seventeen phases and 1,683 checks had all run as somebody who
**works at the shop** — owner, cashier, stock keeper, super-admin. Nobody had
ever been the person the shop exists for. Phase R drives `role:customer`:
`/marketplace/*` to look, `/customer/*` for addresses, reviews, reservations and
**orders**.

**Three questions it exists for:**
- **The order** prices itself from the shop's catalog; a price sent by the
  customer is ignored. (The request rules carry no price field — which is a
  reason to check, not a reason not to.)
- **The boundary**: `shop_slug` and `items.*.product_id` arrive in one body with
  **nothing tying them together**. An order naming shop A and carrying shop B's
  product is one request away.
- **The owner**: orders/addresses/reviews/reservations are all "mine". Reading
  the controllers says they scope by user. Reading is not proving.

**Two customers exist on purpose** — a check that one person cannot see
another's things is meaningless with one person.

**Result: 185 checks across 3 shops, 0 bugs, 0 queries.** Trustworthy because both new
mutations are caught (29/29 sweep-wide): pretend every order is accepted → `AN
ORDER REACHED INTO ANOTHER SHOP`; answer 200 to any customer reading any order →
`ANOTHER CUSTOMER READ THIS ORDER`.

**Two harness bugs first, both old friends:**
1. **404 read as access.** The role fence pointed at `/reports/sales`, which
   does not exist; the check saw "not 401/403" and accused the product. **404 is
   "no such route", not a refusal** — the same mistake phase I made with 403 and
   MODULE_DISABLED.
2. **The best check quietly did not run.** The cross-shop probe looked for a
   second shop among *marketplace-visible* ones — 1 of 8 — found none, and said
   "no second shop to borrow from". Only the printed denominator made it
   obvious. Fixed by borrowing from ANY shop the sweep built: **a shop being
   invisible to shoppers makes its products a better probe, not a worse one.**

**Widened after the first run (1 → 3 shops).** A shop is orderable only when
active + `online_shop_enabled` + `setup_completed` + the `marketplace` module
are ALL true; the phase now flips the first pair itself (admin token) and the
second (owner token), and says which refused. A grocery order is the EASY path —
the interesting ones are a restaurant's and a chemist's.

**The chemist's question, which nothing had ever asked:** can a stranger order a
`requires_prescription` medicine on a phone, with no prescription field anywhere
on the request? **No — `RX_IN_PERSON_ONLY`.**

**But the first version of that check would have passed either way.** It read
only the status, and the medicine it made had `stock_quantity: 0.000` — a 422
for having none reads exactly like a 422 for needing a prescription. Fixed by
stocking the shelf first (so the other rule cannot fire) AND requiring the
refusal to NAME the prescription. **A refusal is not enough; it has to be a
refusal about the thing being tested.**

`/auth/register` is under `throttle:auth` (5/min/IP, shared with every sweep
login), so the two shoppers have stable addresses, register once, and a 422 on a
later run means "already there".

---

**2026-08-20 · the dish that is not only a dish.** Every other order line is
*this thing, n times*. A modifier is the one place where the customer changes
both the **price** and the **recipe**, and three things must all be true while
each fails quietly on its own:

- **SHOWN** — the menu publishes the choice, its `min_select` and its
  `price_delta`. A required group the shopfront never sends is a dish nobody
  can order, refused for missing something never offered.
- **CHARGED** — the delta comes off the shop's own option row. The customer
  sends option ids and never a number.
- **REMEMBERED** — the line keeps the snapshot. **The one failure money cannot
  reveal**: the total is right to the rupee and the kitchen reads a plain pizza.

All three hold, plus the fences (required group, group limit, an option from a
DIFFERENT dish → `MODIFIER_INVALID`). Every refusal is required to NAME its
rule — a 422 for no stock and a 422 for no crust are indistinguishable by
status. The dish is created `track_inventory: false` for the same reason, and
the option ids are read off the PUBLIC menu, never the owner's catalog.

**The completion hop, which nothing had driven.** A completed order rings its
sale down the `trusted_prices` branch, carrying the captured `unit_price` and
`modifiers` forward instead of re-running `ModifierResolver` — re-pricing would
add the +300 twice, re-validating would reject a required crust on a line whose
option ids are long gone. Holds: agreed 1100 → till rings 1100, snapshot intact.

`ModifierResolver` is deliberately ONE implementation shared by POS and online
order. That is why none of these checks test its arithmetic: **shared code
diverges in what it is HANDED, not in what it does.**

`mutate.py` picks `food_restaurant` for phase R now — without it every dish
check reports "could not create one" and its mutations come back UNCLEAR.

And asking what else sat on the customer's side of the wall found a real bug:
[[shopos-sold-out-three-paths]].

Related: [[shopos-qa-sweep]], [[shopos-read-vs-manage]], [[shopos-detector-vs-rule]],
[[shopos-sold-out-three-paths]]
