---
name: shopos-the-customer
description: "Phase R — the QA sweep finally drives the CUSTOMER (role:customer): orders, addresses, reviews, reservations. 164 checks, 0 bugs, both mutations caught"
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

**Result: 164 checks, 0 bugs, 0 queries.** Trustworthy because both new
mutations are caught (28/28 sweep-wide): pretend every order is accepted → `AN
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

**Coverage: `R  1  mart` — one shop of nine.** A shop is orderable only when
active + `online_shop_enabled` + `setup_completed` + the `marketplace` module
are ALL true, and sweep tenants never needed the last two. So no restaurant
order with modifiers, no pharmacy order with a prescription item. Left visible
in the coverage table rather than papered over.

`/auth/register` is under `throttle:auth` (5/min/IP, shared with every sweep
login), so the two shoppers have stable addresses, register once, and a 422 on a
later run means "already there".

Related: [[shopos-qa-sweep]], [[shopos-read-vs-manage]], [[shopos-detector-vs-rule]]
