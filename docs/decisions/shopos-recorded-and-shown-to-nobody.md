# Recorded for the owner to reconcile, and shown to nobody

**2026-09-02** · offline report · `OfflineReportController`, `OfflineReportTab`

## What was wrong

`cash_sessions` carries three columns written by the offline shift sync and read
by **nothing**: `pos_device_id`, `synced_at` and `offline_violations`. The
migration that added them even created an index on `['tenant_id', 'synced_at']`
for a query nobody ever wrote.

The consequence is not cosmetic. Opening a shift has real invariants — one open
shift per lane, one per cashier — and a shift opened with no server can break
them, because the lane was taken by whoever got back online first. The sync
deliberately **records the conflict and corrects nothing**, and it is right to:
refusing a shift on arrival would orphan every sale rung into it and leave a
counted drawer belonging to nothing.

But `Reports → Offline` — the screen whose entire job is *what happened while we
were out of contact* — was built out of **sales**. So the sentence stopped
halfway: the conflict was written down "for the owner to reconcile" and no owner
could ever see it.

The same screen was missing a second thing outright. `clocks` — one row per
tablet whose clock is wrong, with a full docblock, a rule about signs, and its
own backend tests — was not in the panel's types and rendered nowhere, and
neither was `summary.clock_off`. The **Help Centre already described it to
owners as something the screen shows.**

## What changed

`GET /reports/offline` gained `shifts` (and `summary.shifts` /
`summary.shifts_flagged`); the panel gained two sections.

- **Shifts that ran with no server** — cashier, lane, tablet, when it opened,
  how long it sat on the till, what was counted and the variance, each violation
  as a badge, and *"Still open — nobody has counted this drawer"*: the only row
  on this screen that is not history.
- **Tills with the wrong time** — `3 days behind`, `2 hr ahead`. Signed, because
  behind files sales into days already banked and ahead files them into a day
  nobody has traded yet.

Two smaller repairs fell out of it: the empty state said "Nothing came in late"
over a shift that broke a rule, and the **Need a decision** tile counted flagged
sales only, so it could read 0 directly above a flagged shift.

## The rules, and why

- **A practice shift is not on this report.** Nothing in a training drawer is
  real money and this screen answers "what did I miss" about the day's takings.
  A practice shift on it sends an owner to reconcile a drawer that never held
  anything. (Precedent: `PosController` already filters `is_training` out of the
  shift figures.)
- **`synced_at` is what makes a shift late**, exactly as it does for a sale. It
  is null on every shift opened online, which is almost all of them; without the
  fence this section would be a second shift list.
- **Flagged first**, for the same reason the sales are.
- **Counts stay separate.** `summary.shifts` is not folded into
  `summary.sales` — "how many shifts do I have to look at" is not "how many
  sales came in late". Only the *decisions* tile adds them, because its label is
  about decisions.

## Proven

Each rule fails its own test when removed: the training fence, the `synced_at`
fence, the flagged-first ordering and the flagged count each break exactly one
backend test; blanking either panel section, the tile's shift term or the empty
state's shift term each breaks its own.

## The lesson

A written-and-never-read column is not an unused field — it is a **promise made
in a migration and kept nowhere**. Grep the column, not the feature: the sync
had tests, the report had tests, the help had a paragraph, and the path between
them did not exist.
