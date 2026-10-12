---
name: shopos-a-shop-trades-in-its-own-money
description: BUILT 2026-10-11 late night, NOT pushed — a shop chooses its currency (PKR/INR/USD/AED/SAR/GBP/EUR/BDT), one per shop, fixed once it has traded; where the list lives and the three formatters; never write a currency mark in a file
metadata:
  type: project
---

**USER, 2026-10-11 (after the push):** "abhi currency type add kro — agr Pakistan
main use kry to usy PKR chahye, USA main Dollar, India main INR — to wo select kr
sky currency type." This is level 1 of [[shopos-multi-currency-later]] and it is
BUILT. Decision doc: `docs/decisions/shopos-a-shop-trades-in-its-own-money.md`.
**Not committed, not pushed** — wait for the user's word ([[shopos-resume-here]]).

**How it works (so the next change does not undo it):**
- The list is `backend/app/Support/Currencies.php` — code → name, mark, grouping
  (western | indian lakhs), decimals (when_needed | always), space, cash notes.
- Only the CODE is stored (`tenants.settings.currency`). `currency_symbol` and
  `currency_format` are GIVEN by `Tenant::allSettings()`; never save them.
- `Tenant::mayTradeIn()` = the one lock rule (`409 CURRENCY_LOCKED` once
  `hasMoneyOnItsBooks()`); settings, setup and admin-create all go through it.
  My choice, modelled on Shopify locking after the first sale — the user did
  not ask for a lock; told them, they have not objected.
- Formatters: server `Tenant::money()` / `Currencies::format|paper`; panel
  `useMoney()` (shop), `platformMoney` (plans, add-ons — the platform's PKR),
  marketplace `money(n, shop.currency)`; till `useTillCurrency()` (falls back
  to the catalogue's cached settings offline).
- **STANDING: never write "Rs"/"PKR"/"₹" in a PHP or TS file.** Two guards fail
  on it: `CurrencyFormatFixturesTest::test_no_php_file_writes_a_currency_mark_of_its_own`
  and `panel/src/common/format/noLiteralCurrency.test.ts`.
- Panel formatting is held to the server's by `tests/fixtures/currency-format.json`
  → `SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=CurrencyFormatFixturesTest`
  then `cp` to `panel/src/common/format/fixtures/`.
- No migration.

**Told the user it does NOT do:** country (cities, tax year July–June, PK phone
rules stay); the platform billing in more than one currency; two currencies in
one shop; admin cross-shop totals split by currency; mobile apps.

Journey stage V (`33-…dollars.spec.ts`, `JOURNEY_TRADE=dollars`) 6/6; backend
`AShopTradesInItsOwnMoneyTest` 17; mutations 24/24 + 10/10.
