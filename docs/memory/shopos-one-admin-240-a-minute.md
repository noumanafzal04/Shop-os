---
name: shopos-one-admin-240-a-minute
description: STANDING — every admin e2e spec signs in as ONE admin and the API allows 240 req/min per user; the 9th spec file tipped it over and it looked like a flaky "list could not be loaded". New admin specs MUST carry the roomToWork beforeEach
metadata:
  type: feedback
---

**What happened (2026-10-10):** `admin-customers.spec` failed in full admin runs,
a different step each time, passed alone and on the next run. I called it
"unexplained one-off" twice. It was the API's own limit — 240 requests a minute
per signed-in user (`X-RateLimit-Remaining` is on every answer) — exhausted by
nine admin spec files using one admin. The page said "Too many requests. Please
slow down."; the spec only saw a list that was not there.

**Why:** a console screen asks 5–8 things on load (92 for one walk of all 15),
and each spec also asks the server what really happened. The product is right
to limit; the suite has to live inside it.

**How to apply:**
- Every `e2e/admin-*.spec.ts` has, before its first test:
  `test.beforeEach(async ({ request }) => { await roomToWork(request, tradeAuth("admin")); });`
  (`roomToWork` is in `e2e/api.ts`; it waits a minute when fewer than 130 are left). A NEW admin spec without it will bring the failure back.
- An intermittent failure that passes alone is NOT "one-off": read the page's
  own error text and the response headers before moving on.
- Do not raise the limit for tests, and do not count per-screen requests as the
  culprit (I measured: they are normal).

Related: [[shopos-console-a-to-z]], [[shopos-failed-check-is-not-a-verdict]], [[shopos-suite-vs-itself]]

**2026-10-10 (later) — the SHOP side meets it too.** Five API-heavy shop specs
run back to back as one owner (pack-codes, item-form, labels-sheet,
import-catalog, till-enter) spent the minute; the till in the last drew "No
products match." over a 429. `roomToWork(request, headers, need, probe)` now
takes a probe path — shop specs pass `ownerAuth()` and `"/auth/me"`
(`/pos/*` has its own, higher limit). Found by reading the trace first, per
[[shopos-first-paint-asks-nobody]]. It also exposed a real fault:
[[shopos-failed-is-not-empty]].
