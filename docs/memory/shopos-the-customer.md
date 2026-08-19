---
name: shopos-the-customer
description: "Phase R — the QA sweep finally drives the CUSTOMER (role:customer): orders, addresses, reviews, reservations, Rx-only medicines. 185 checks, 0 bugs, 29/29 mutations"
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

Related: [[shopos-qa-sweep]], [[shopos-read-vs-manage]], [[shopos-detector-vs-rule]]
