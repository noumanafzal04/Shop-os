---
name: shopos-an-order-reaches-the-kitchen
description: FOUND + FIXED 2026-10-12 — a phone/online order never reached the kitchen's pass; Take order refused every made-to-order dish, took a sized dish with no size, guessed its total, and cancelled at one press. What was built, and FOUR things left for the user to decide (orders are untaxed, take no promotion, raw ingredients are sold, Reservations ≠ tables)
metadata:
  type: project
---

Found 2026-10-12 by taking ONE phone order through its life in a new restaurant
([[shopos-an-item-is-counted-or-not]] was found on the same walk). Decision doc:
`docs/decisions/shopos-an-order-reaches-the-kitchen.md`. Related:
[[shopos-counter-order-kitchen]], [[shopos-take-order-page]],
[[shopos-what-the-screen-adds-up]], [[shopos-sold-out-three-paths]].

**Built:**
- `SendAnOrderToTheKitchen` — fired from `OrderService::advance()` at
  preparing / ready / out_for_delivery (whichever first), NOT at confirmed.
  A `from_counter` ticket (off the floor, closes itself when served) with
  `ticket_number = order_number` — that is the only tie, no column was added.
  Food items only. `takeBack()` on cancel voids ACTIVE dockets, leaves served.
- `POST /orders/worth` → `OrderService::worth()` → `OrderQuoted` thrown inside
  `place()` just before `Order::create` (after the coupon is applied — the
  rollback un-spends it). Name and address are not required to ask.
- `VARIANT_REQUIRED` on `place()` for a product with active variants.
- Panel `orders/`: `whatIsLeft.ts` (stock questions = the server's),
  `takeOrder.ts` (a line = dish + size + answers), `components/ChooseHow.tsx`,
  the figure block from the server. Cancel asks with a required reason.
- `components/ui/confirm/words.ts`: when the yes starts with "Cancel", the no
  says "Keep it" — for EVERY confirmation.

**Added later on 2026-10-12 (the user asked "send to kitchen? print for kitchen?"
and for "Today and Past orders" tabs):**
- `send_to_kitchen` on `POST /orders` → `OrderService::straightToTheKitchen()`
  (confirmed → preparing through the ordinary `advance()`); only with the
  `kitchen` feature. Take-order ticks **Send to the kitchen now** by default.
  A CUSTOMER's online order still arrives as New.
- The answers to taking an order and to moving one on carry `kitchen_ticket`;
  `orders/kitchenSlip.ts` prints it (`printKots`, `kot_auto_print`) and says
  which of four outcomes happened. Before this an order reached the kitchen's
  screen and never its printer.
- Orders page = two tabs, `?show=past`: **Today** = board of everything still
  open (ANY day — an unfinished order is still somebody's) + "Finished today";
  **Past orders** = table. `GET /orders?when=today|past` is cut by `ShopDay` on
  the SERVER; `closed_only` mirrors `open_only`. Tab count + rider warning are
  whole-shop (`pulse` query), never filter results.
- Take-order is laid out like the till — see [[shopos-work-screens-follow-the-till]].
- `OrdersTable` + `OrderRow`: below `sm` a row is a 2-column GRID of the same
  cells (explicit `role="row"/"cell"`), not a table that runs off the edge.

**Left for the USER to decide (told them 2026-10-12, no answer yet):**
1. Orders are NOT TAXED (till: 5% on the same dish). `complete()` files the sale
   with `tax: 0` on purpose. Fix = `orders.tax` column + customer checkout
   (storefront AND mobile). I recommended taxing orders by the till's rule.
2. Orders take no promotion and no member discount (a coupon, yes).
3. Raw ingredients show as tiles on the till and on Take order (`for_sale` is
   only `is_active`) — the "ingredient — not sold" kind from 11 Oct.
4. "Reservations" on a restaurant's menu = marketplace item holds, not tables.

**Why tests missed it:** every order test used counted products without sizes
(a mart's), and nothing ever looked at the kitchen after an order.
**How to apply:** a selling path is tested with a DISH (uncounted, sized, with a
required question), not only a packet.
