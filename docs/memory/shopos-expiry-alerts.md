---
name: shopos-expiry-alerts
description: "Near-expiry alerts shipped 2026-08-17. Speaks per lot per stage EXACTLY ONCE (approaching + expired), never daily. Two stages not three. stock:expiring at 07:00."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T19:48:50.565Z
---

`docs/decisions/shopos-expiry-alerts.md`. Closes the most valuable of the three
Aug-09 gaps.

**Everything was built and none of it spoke.** Batches carry dates, the
dashboard counts, the pharmacy screen lists, Disposals records — all pull-only,
so a shop learned its stock was dying on the day somebody happened to look.

> **Expiry is the only loss in a shop that is completely silent.** Nothing
> breaks, no figure looks wrong, the stock sits on the shelf looking like stock.

**The design question was never whether, it was how often** — and this
generalises to every alert:

> A daily "you have 43 items expiring" is **worse than silence**. Same sentence
> every morning → unread within a week → the morning it says 44 nobody notices
> either.

So: **per lot, per stage, exactly once.** Dedupe key = batch + stage, so a lot
speaks twice in its life and never again.

- **approaching** — crosses the shop's OWN `expiring_soon_days` (90 pharmacy /
  30 else). "Still time to sell it down or agree a return."
- **expired** — "It cannot be sold. Record where it goes in Disposals."

**Two stages, not three.** The obvious middle one ("return to the distributor
now") needs a number nobody gave us — supplier terms are per-contract, and
inventing 30 days is **a guess dressed as advice**.

Capped `MAX_PER_TENANT_PER_RUN = 20` (first run on an existing chemist would
otherwise be 80 alerts); expired sent BEFORE approaching so a capped run spends
its budget on stock already dead. `Schedule::command('stock:expiring')
->dailyAt('07:00')`. Enforces nothing — expired stock is already unsellable via
`InventoryService`.

`ExpiringStockAlertTest` 11 tests, mutation-checked. The load-bearing one is
`test_a_lot_is_mentioned_once`, not "it alerts".

**Still open from Aug-09:** recurring income · reorder list → purchase order.

Related: [[shopos-stock-disposals]], [[shopos-pharmacy-edges]], [[shopos-qa-sweep-aug09]].
