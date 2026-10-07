---
name: shopos-shop-day
description: STANDING — a shop's day turns at ONE hour (05:00 default, setting day_turns_at 0–8); moments → ShopDay, dates on a box → the wall date; never today()/whereDate on a moment
metadata:
  type: feedback
---

**Rule (2026-10-07, the user's word: "khud se perfect banao"):** which day a moment belongs to is asked in ONE place.

- Server: `App\Support\ShopDay` — `today()`, `dateOf()`, `startOf()/endOf()/span()`, `window()`, `between($query, $col, $from, $to)`, `dateSql()/movedSql()`, `calendarToday()`, `describe()`.
- Panel: `src/common/shopDay.ts` — `shopToday()`, `shopWallToday()`, `shopTodayDate()`; the rule arrives in `/shop/settings` as `shop_day` and is set by `useShopSettings` (storage key `shopos-day`). `dateRanges.ts` defaults to it.
- Till: `BusinessDay::tradingDateAt($branch, $moment)` = the business date, unless that day is CLOSED and the calendar has moved on (then the wall date — a pump closing at midnight keeps selling).
- Kitchen: `ServiceDay` turns when ShopDay does.

**Two kinds of date — do not mix them:**
- a MOMENT (sold_at, opened_at, created_at…) → ShopDay's business day.
- a date read off a box (expiry, valid-until, due, a typed bill date) → `ShopDay::calendarToday()` / `shopWallToday()`. Never moved by the turn hour.

**Why:** reports cut the day at UTC midnight (05:00 PKT), the till and every panel "Today" at local midnight. 00:00–05:00: "Today" on the sales list was EMPTY while the dashboard counted; a shift after midnight opened a 2nd trading day; an expired medicine stayed sellable; a bill dated today was "the future". One test had failed nightly in that window, unseen.

**How to apply:**
- New code: no `today()`, `now()->startOfDay()`, `whereDate()` on a moment column, or `toIsoDate(new Date())` for a tenant screen. A `whereDate` on a typed DATE column is fine.
- Default is deliberately NOT a flat "5": unset = UTC midnight read on the shop's clock (frame `UTC,0`), so no historic figure moved and the 61 `'timezone' => 'UTC'` test files are untouched.
- Test with a clock at 01:00–01:45 Asia/Karachi (wall ≠ server date) AND with `day_turns_at: 0` — the default alone cannot tell ShopDay from UTC. `OneNightIsOneDayTest` is the pattern.
- NOT moved on purpose: platform figures, commission invoices, rider earnings, `Retention`, entitlement dates, warranty days, nightly expiry notifier, `ProductBatch` window scopes.
- `php artisan test` during 19:00–24:00 UTC is the honest run: that is when wall ≠ server.

Decision: `docs/decisions/shopos-a-shops-day-turns-once.md`. Related: [[shopos-today-in-utc]], [[shopos-paper-reads-shops-clock]], [[shopos-day-closed-no-reopen]], [[shopos-which-day-is-open]], [[shopos-pass-is-tonights]]
