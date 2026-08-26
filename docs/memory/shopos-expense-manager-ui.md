---
name: shopos-expense-manager-ui
description: 2026-08-26 UI pass on Cashbook/Ledger/Income/Expenses — one shared MoneyEntryTable + MoneySummary, formatMoney/formatEntryDate, phone fits with no sideways scroll
metadata:
  type: project
---

The four Expense Manager screens (Cashbook, Ledger, Income, Expenses) rebuilt
for readability. What is now shared and must stay shared:

- **`modules/expenses/components/MoneyEntryTable.tsx`** — expenses and income
  were two hand-written tables with the same eight columns and a different
  opinion about every one of them (one had an "Actions" header, the other a
  blank one; one coloured the amount, the other gave it no weight). One
  component now; the next change lands on both or on neither.
- **`MoneySummary.tsx`** — Total / Entries / Average for the FILTERED set,
  derived from `meta.totals` so it cannot disagree with the rows. Average is
  `null` (shown "—") at zero entries, never `Rs 0`.
- **`common/format/money.ts` → `formatMoney`** — whole amounts have no decimal
  point, anything else has exactly two. Fixes `Rs 2,350,196.5`. `useMoney()`
  routes through it, so this is site-wide.
- **`formatEntryDate`** in `components/ui/filters/dateRanges.ts` — Today /
  Yesterday / 24 Aug / 24 Aug 2025.

Design decisions worth keeping:
- Columns **fall away** as the page narrows and the dropped facts reappear in a
  muted meta line under the description. At 390px the date column goes too —
  that is what makes Edit and Delete reachable without swiping the card.
- Budgets: a category with no ceiling reads **"Not watched"**, not an empty box.
  Twelve rows of "No budget set" is a third of the table saying nothing.
- Recurring: pause/resume is a **Status column**, not a fourth control in the
  action group.
- Per-tab subtitles (`BLURB`) — the page used to carry one sentence over all
  four tabs, and it described the fourth.

Two real bugs found on the way: [[shopos-total-belonged-to-everyone]] and
[[shopos-sr-only-widened-page]]. Also [[shopos-today-in-utc]].
