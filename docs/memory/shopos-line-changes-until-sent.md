---
name: shopos-line-changes-until-sent
description: Tab order-taking rebuilt for tablets: taps JOIN one line, −/+ and kitchen note on unsent lines only; PATCH takes a STEP (adjust) never a target; queue in useTabLines
metadata:
  type: project
---

**2026-10-06, reported:** "the person taking order … that screen also not looks good, this will be mostly use on tab".

**What was really wrong (beyond looks):** a tab could only ADD and VOID. Every tap = a new line of one (8 naan = 8 taps, 8 rows, 8 rows on the KOT), and the menu greyed out for each round trip. `note` was in the API from day one and NO screen ever sent one.

**Backend:** `PATCH /restaurant/tickets/{t}/items/{i}` `{adjust?, note?}` (`UpdateTicketItemAction`).
- Only while `kot_status === 'pending'` → else 409 `ITEM_ALREADY_SENT`.
- `adjust` is a STEP (+1/−1), never `quantity: N` — commutative, so four quick taps cannot race to two. Down to 0 = a void.
- Re-priced through `AddTicketItemsAction::priced()` (tiers + % discounts depend on quantity) — one copy of the arithmetic.

**Panel:** `useTabLines(id)` queues taps and decides merge-vs-add at execution time against the cached tab; `tabLines.joinable()` = same dish + size + extras, and NEVER a line with a note. Three piles: Not sent yet / In the kitchen / Served. Button renamed **"Send to kitchen (n)"** (was "Fire to kitchen"); kitchen buttons are **Start cooking / Ready / Served** (was "Start").

**Layout lesson (again):** the menu pane needed `min-w-0` — a non-wrapping chip row pushed the order 13px off a 1024 tablet. [[shopos-shell-widened-the-page]]

**Still to do:** `panel/e2e/journey/20-food-the-floor.spec.ts` (uncommitted draft) uses the OLD names — fix before running the food stage.

Related: [[shopos-pass-is-tonights]], [[shopos-waiter-holds-a-phone]]
