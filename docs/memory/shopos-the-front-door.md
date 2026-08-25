---
name: shopos-the-front-door
description: "2026-08-25 SHIPPED: `/` is now the product landing page (marketplace moved to /shops); Try-the-demo gives each visitor their OWN 24h tenant; Keep-this-shop converts it via an admin request"
metadata:
  type: project
---

`cartze.shop` used to answer with the customer marketplace. Two audiences, one
address, and only one of them pays. Storefront → `/shops`; `/` is the product's
page. **`homeForRole` sent customers to `/`** — that would have landed a
customer on a POS advert; now `/shops`.

## The demo

**Own tenant per visitor**, not a shared sandbox (a shared one is vandalised in
a day and concurrent sales ruin each other's figures). **No email at the door** —
asked on the way OUT instead. **24h absolute from creation**, because sliding
expiry cannot be printed truthfully ("ends Wed 6:19 PM" vs "expires soon").

**NOT the demo seeder.** `DemoDataSeeder`/`migrate:fresh` stay forbidden on
production; this creates ONE tenant. The distinction was put to the user, not
reinterpreted quietly.

Three fences: `is_demo` checked inside `marketplaceVisible()` (one scope, not 5
call sites); shelf stocked via `InventoryService` (writing `stock_quantity`
alone leaves the till showing "out of stock"); owner password random and never
sent.

## Keep this shop

CONVERTS the tenant they built. **While pending the shop keeps working** and the
prune skips it — the bound is on the ADMIN answering, never a timer that deletes
a waiting customer's work. Admin list ordered by longest wait, red at 3 days.

**They set their own email + password at request time** — before this a demo
owner could not sign in AT ALL (throwaway address, random password), so closing
the tab lost them the shop. Approval sends nobody a password.

**Approval sets `setup_completed = false`** so they name their own business —
which is why the request form does NOT ask for a business name. Two forms asking
one question is how two answers disagree.

## Found by RUNNING it

- `CreateDemoShopAction` read through the ambient tenant scope → 404 from a
  public endpoint. Context now cleared AND restored.
- `contact_phone` optional but read as always-present → 500. Every test sent
  one, which is why nothing said so.
- "waiting less than a **days**" — 3 fragments deciding one sentence.
- Animation was load-bearing (`opacity:0` rescued by JS) → now applied only
  after the observer mounts. Reduced-motion = OFF, not slower.
- Blink → pulse: on/off is an a11y failure and reads as "close me".

**A mutation caught MY test passing against its own bug** (3rd time that day):
it believed a bearer token sets tenant context; the public route resolves none.

Related: [[shopos-cartze-brand]], [[shopos-exit-code-not-summary]],
[[shopos-workflow-test-rule]], [[shopos-screen-testing]].
