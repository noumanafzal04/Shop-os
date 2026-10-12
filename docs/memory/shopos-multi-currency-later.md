---
name: shopos-multi-currency-later
description: Multi-currency — level 1 (one currency per shop) BUILT 2026-10-11, see shopos-a-shop-trades-in-its-own-money; levels 2 (platform bills in several) and 3 (two currencies in one shop) still LATER, only when asked
metadata:
  type: project
---

**The user's ask (2026-10-11, mid-warehouse work):** "multi currency type add ho skti? abhi hum pkr use kr rhy — Dollar pound multiple? easy hai? already use kia hai currency variable ya static e rkha? keep this in memory — isko b dekhna hai bad main". **Do NOT start it unasked; raise it when the current queue is done.**

**What I found that day (grep, not a full audit):**
- A shop's currency SYMBOL is already a setting, not static: `tenants.settings.currency_symbol` (default "Rs"), read by `Tenant::currencySymbol()` and by the panel's `useMoney()` (used on ~41 screens) → `common/format/money.ts::formatMoney(symbol, value)`. Printed papers read `$settings['currency_symbol']`.
- Not all of it goes through that: ~11 lines in backend php/blade and ~62 lines in panel ts/tsx still say "Rs"/"PKR" literally (some are comments or tests — unchecked).
- `formatMoney` drops decimals on a whole amount on purpose ("PKR is counted in whole rupees") — wrong for USD/GBP, which always show two.
- Money columns are plain decimals with NO currency code beside them. Plans/billing on the platform side are PKR.

**Three levels, cheapest first (my estimate, to tell the user when asked):**
1. One currency per shop, any currency — mostly there: a real currency CODE setting (PKR/USD/GBP…), decimals by currency, and the ~70 literal "Rs"/"PKR" swept. Small.
2. The platform bills shops in more than one currency — plan prices per currency. Medium.
3. True multi-currency inside one shop — a till taking dollars and rupees, a rate on every sale/payment, reports in a base currency. Large: currency + rate on sales, payments, purchases, cashbook, khata.

**2026-10-11 (late night): level 1 is BUILT** at the user's word — [[shopos-a-shop-trades-in-its-own-money]]. Levels 2 and 3 below are still later, and only when asked.
