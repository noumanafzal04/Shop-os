---
name: shopos-the-journey
description: The QA journey — one business created by the admin in the UI and lived through in order (panel/e2e/journey, 12 stages, 105 cases); how to run it, what it found
metadata:
  type: project
---

The user's 2026-10-05 ask: "test cases banao, jis flow mein system kaam karta hai usi order mein, UI se, hazaron entries, admin side bhi tenant side bhi — human QA". Answer = `panel/e2e/journey/` (Playwright project `journey`), cases in `docs/qa/journey/CASES.md`, results in `docs/qa/journey/RUNS.md`.

**Shape:** stages 01 admin creates the business (every module on) → 02 owner setup + every menu screen → 03 shelf → 04 suppliers/PO/customers → 05 offers/expenses → 06 branch/cashier → 07 ten sales → 08 returns/khata/close → 09 books agree to hand-worked figures → 10 volume (2,000 products via Import screen, 1,500 sales from two tills) → 11 admin returns (usage, module off/on, suspend/activate) → 12 settings (every tab changed on screen and checked where used, [[shopos-settings-what-listens]]).

**Run:** `cd panel && E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey e2e/journey/NN --reporter=line`. `JOURNEY_TRADE=food` picks the trade; state is `e2e/.journey/<trade>.json` (gitignored). Stage 01 calls `begin()` = a NEW business; later stages resume the record.

**Why it works:** every case is WATCHED — any API ≥400 or page error fails the case unless declared with `watch.expect()`. Expected figures are worked out in the spec from its own price list, never read back from the server.

**How to apply:**
- New feature → add a case at the point in the day it would be used, not a separate spec.
- Never run it beside phpunit/vitest/builds ([[shopos-suite-vs-itself]]).
- Stage 10 is resumable (idempotency keys `qa-<stamp>-<k>`); stage 11 revokes the owner's session on purpose.
- Bugs it found that 3,000 backend tests had not: profit included sales tax, sale lost its customer's name, returns NaN, cashier 403 on device roster, close-shift 409, unstable paging ([[shopos-pages-hold-still]]).
