---
name: shopos-somebody-is-working
description: STANDING — dev data that changes under me is the USER working, not a fault to repair; tests hand back only what they set; server-rule mutations run on a COPY; runner needs a passing baseline
metadata:
  type: feedback
---

**What happened (2026-10-10):** the dev add-on price list went from `{products: 25000}` to `{}` while I ran e2e. I assumed a test wiped it and PUT 25,000 back. Then a price no test sets (Bank Card Offers 350) appeared: the user was on that screen. They had most likely cleared Products themselves (I had just told them it did nothing) and I undid it. Told them; left it as their next save had it.

**Why:** the user works on the same dev DB and dev servers (8000 / 5177) while I test. My reading, not their instruction — they have not commented on it.

**How to apply:**
- Shared dev data changed unexpectedly → first ask "is the user on it?" (look for a value no test sets). Do NOT "restore" it. Report it.
- A test that touches a shared list/setting sets ONE key and hands back THAT key. Never read-whole → write-whole ("restore as found") — it erases whatever changed in between. `admin-plans.spec.ts` did; fixed.
- Mutating a server rule that WRITES (pricing, settings) → run phpunit against a private copy (`$SP/bk`, own `vendor/` — a symlinked vendor loads the REAL `app/`), never the files `php artisan serve` is serving. Read-only/display mutations on the live dev server are fine.
- A mutation runner must run the unmutated tests first and require exit 0. Same day: a copy that ran real code → 18/18 "survived"; a copy that could not boot → 18/18 "caught". Both meaningless. See [[shopos-measurement-that-lied]].
- Playwright: lift a `page.route` hold AFTER the page is up (`unrouteAll({behavior:"wait"})`); lifted mid-load it left two module requests unanswered.

Related: [[shopos-where-a-price-is-charged]], [[shopos-one-admin-240-a-minute]]
