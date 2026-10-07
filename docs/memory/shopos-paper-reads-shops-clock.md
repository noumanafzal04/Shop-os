---
name: shopos-paper-reads-shops-clock
description: STANDING — printed times go through ShopTime::show(); app zone is UTC; report days RESOLVED 2026-10-07 by ShopDay
metadata:
  type: feedback
---

**Rule:** anything a person reads with a clock time in it → `ShopTime::show($moment, $format, $tenant)`. A date with no time (quote "valid until", warranty end) is NOT moved. A Blade view calling `->format()` with hours fails `ThePaperReadsTheShopsClockTest`.

**Why:** 2026-10-06 — every receipt, quotation, Z-read and kitchen ticket printed UTC: a 12:47 PM sale said "07:47 AM", and after midnight the DAY before. `config('app.timezone')` is hard-coded UTC; tenants have `timezone` (default Asia/Karachi). No test read WHEN a receipt was.

**How to apply:**
- New printed/emailed/SMS text with a time → ShopTime. Test with FIXED moments (`Carbon::setTestNow`), never "now" — it passes 19 hours a day.
- **Report days — RESOLVED 2026-10-07:** one rule, `ShopDay` ([[shopos-shop-day]]). Default still cuts at UTC midnight (= 05:00 PKT) so no figure moved; a shop may choose 0–8.
- Same paper: kitchen ticket read `$tenant->name` (null; column is `business_name`) — see [[shopos-silent-nulls]]. `Customer::UNNAMED` / `knownName()` is the one rule for the phone-only placeholder.

Related: [[shopos-today-in-utc]], [[shopos-first-of-the-month]]
