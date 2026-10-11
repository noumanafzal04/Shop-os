---
name: shopos-a-size-is-said-everywhere
description: BUILT 2026-10-11 evening, NOT pushed — clothing (stage T) + café (stage U) journeys; exchange by SIZE, refund figure from the server before the press, sizes keep typed order (sort_order), counter "for here" reaches the kitchen; three traps
metadata:
  type: project
---

**2026-10-11 evening. Built, tested, and PUSHED that night at the user's word** (backend `4b42792`, panel `6871883`; [[shopos-resume-here]]).
Decision doc: `docs/decisions/shopos-a-size-is-said-everywhere.md`.

The user's "QA 6 trades" list named **clothing** and **café**; neither had been
lived. Journey stage T (`32-clothing-sizes-and-colours.spec.ts`,
`JOURNEY_TRADE=retail`) and stage U (`31-cafe-the-counter.spec.ts`,
`JOURNEY_TRADE=food`) — nine cases each, green from a clean start.

**What they found (all fixed):**
- **Exchange could not name a size** — panel sent `{product_id}`; server said
  `VARIANT_REQUIRED`; the sheet had nowhere to answer. Server had taken
  `variant_id` all along. → `panel/src/modules/sales/replacements.ts`.
- **Exchange/refund money worked out in the browser without tax** ("collect
  200" where the sale wanted 210 → refused). → `ProcessSaleReturnAction::worth()`
  + `POST /sales/{sale}/returns/worth` (reads only, `sales.refund`); the
  replacement total is `tillBill()`.
- **Sizes came back alphabetical** (L, M, S). → `product_variants.sort_order`,
  migration `2026_10_11_000003` (applied to dev, backfills from `variant_axes`).
- **Counter order rung "Dine-in" (café, no floor) never reached the kitchen**;
  a test asserted the empty board. → `settles_tab` said by `SettleTicketAction`
  only; `RestaurantTicket::goesTo()` is where an order is carried.
- Short cash tender read "Change due Rs 0" → "Still to pay" (`shortBy`).

**Three traps, each cost a failed run:**
1. Inside an Eloquent model `$this->table` is the DB table NAME, not the
   relation — use `getRelationValue('table')`. (Board 500'd.)
2. Laravel's validator hands rows back rule by rule; `id` is the first rule, so
   rows WITHOUT an id come after rows with one. `ksort()` before reading
   position.
3. A read-only "quote" query keyed under a key the mutation invalidates is
   re-asked the instant the mutation succeeds — for lines that no longer exist.
   Key it apart and put a version (count of returns) in the key.

**Left as it is, said to the user:** a required modifier opens on its first
option at the TILL and must be answered by hand on a TAB.

Related: [[shopos-size-picker-gap]], [[shopos-code-for-each-size]], [[shopos-menu-and-door]], [[shopos-estimate-at-wrong-layer]]
