---
name: shopos-the-machine-slept
description: STANDING — a test cannot outlast its own timeout; a duration past it means the machine slept, not that the code is slow. 18 "failures" were one closed lid.
metadata:
  type: feedback
---

A full Playwright run reported 18 failures and a test that took **41.4 minutes
against a 300s deadline**. Read straight: a screen that hangs and a till that
stopped taking cash on two of four devices. All false.

The lid closed at 10:34 on 4% battery; the machine slept 47 minutes
(`pmset -g log | grep -E "Sleep|Wake"`). That one fact made both halves:
the long test was asleep, and the run passed its 60-minute token TTL so
everything after the wake failed in ~1s on a 401. Re-run awake: **40/40 in
3.9 minutes**, same screens, same viewport.

**Why:** every cheap theory was wrong and each cost a measurement to kill —
the rules ran in 225ms, the page was fine at 810px, phone and tablet-landscape
passed the same screens. The tell was RUN ORDER, not viewport: everything
before the sleep passed, everything after failed. The same spec passed on one
project and failed on the next, minutes apart.

**How to apply:**
- **The rule:** Playwright kills a test at its timeout, so slow code can never
  produce a duration past it. A duration beyond the timeout is the wall clock
  moving while the test stood still. No false positives from slowness.
- `e2e/clockReporter.ts` (+ `clockReporter.guard.ts`, 5 tests, 3 mutations
  proven) now says both things in the report: "the clock moved while the run
  did not" and "this run outlived its own login". Neither fails the run —
  their job is to stop a red run being MISREAD.
- Run long suites as `caffeinate -i npx playwright test`.
- Second instance of [[shopos-token-lives-one-hour]] (97 sweep "bugs" = one
  dead credential). Fourth entry in [[shopos-measurement-that-lied]]: wrong
  cwd, unquoted heredoc, soft-deleted target, **machine asleep**.
- Two traps met on the way: killing a run wipes `test-results/`, so the failed
  run's trace is destroyed by the next run — copy it out first. And
  `--timeout=60000` on the CLI breaks `auth.setup.ts`, which deliberately waits
  65s out for `throttle:auth`; set a timeout inside the spec instead.

**2026-10-11 — the same thing, by the network instead of the lid.** The laptop
was carried out of the house mid-journey; the browser said `navigator.onLine =
false`; the till — rightly — rang the next sale OFFLINE ("the till said
OFF-TILL-… and the server has no such sale") and 66 cases after it never ran.
The dev server is on localhost and never went away; the browser does not know
that. `e2e/journey/kit.ts` → `aNetworkForACase()` now waits (up to 10 min) for
the network before a case STARTS, and says so if it never comes. A case that
loses it halfway still fails, as it should. Check `ifconfig` / the "Offline"
pill in the failure screenshot before reading such a run as a product bug.

