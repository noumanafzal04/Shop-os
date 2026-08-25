# The machine slept

**Date:** 2026-08-25
**Status:** shipped — `e2e/clockReporter.ts`, `e2e/clockReporter.guard.ts`, registered in `playwright.config.ts`

## What the run said

A full browser suite came back with eighteen failures and one test that had
taken **41.4 minutes** against a five-minute deadline:

```
✘ 200 [tablet-portrait] › reviews — nothing covered, nothing off the edge (41.4m)
✘ 203 [tablet-portrait] › subscription — nothing covered, nothing off the edge (5.2m)
✘ 217 [tablet-portrait] › a cash sale rung on the till reaches the server (1.3s)
✘ 220 [tablet-portrait] › tiles: a sized item says "from" …           (3.2s)
✘ 276 [phone]           › a cash sale rung on the till reaches the server (1.2s)
   … eighteen in all
```

Read straight, that is a screen that hangs the browser and a till that has
stopped taking cash on two of four devices. Both are false. **Nothing was
wrong with the product, and nothing was wrong with the suite.**

## What actually happened

The laptop's lid closed at 10:34 with the battery on 4%, and the machine slept
until 11:21. Forty-seven minutes passed with nothing executing.

```
2026-08-25 10:34:05 Sleep  Entering Sleep state due to 'Clamshell Sleep' … (Charge:4%)
2026-08-25 11:20:49 Wake   Wake from Deep Idle … due to EC.ACAttach
```

That single fact produces both halves of the report:

- **The 41.4-minute test** was asleep for most of it. The clock advanced; the
  test did not.
- **The eighteen fast failures** were a dead credential. This suite signs in
  once and reuses the storage state; the token is good for sixty minutes. The
  sleep pushed the run past that, so everything after the wake failed in about
  a second with a 401 — which looks exactly like a broken feature.

The proof is the re-run: the same 40 checks, the same project, the same
viewport, awake — **40 passed in 3.9 minutes**, reviews and subscription
included.

## Why this was expensive to find

Every cheap explanation was wrong, and each was wrong in a way that took a
measurement to disprove:

| Theory | Disproved by |
| --- | --- |
| The `elementFromPoint` loop is quadratic again | all four rules ran in **225ms** on that page |
| The reviews page hangs at 810px | 40/40 pass at 810px when awake |
| It is the viewport band `md`-but-not-`lg` | phone and tablet-landscape passed the same screens |
| The till is genuinely broken on phones | the same specs passed on the project that ran *before* the sleep |

The tell was in the run order, not in the viewports: everything that ran
**before** the sleep passed, everything **after** it failed. `selling.spec.ts:260`
passed on tablet-portrait and failed on phone — the same check, minutes apart,
straddling the moment the token died.

The answer was in `pmset -g log`, which is not somewhere anybody looks when a
till appears to have stopped taking cash.

## The rule

> **A test cannot outlast its own timeout.** Playwright kills it at the
> deadline, so no amount of slow code can produce a duration past it. A
> duration beyond the timeout is therefore not a measurement of anything the
> test did — it is the wall clock moving while the test stood still.

That makes a clean detector with no false positives from slowness, because
slowness is capped by definition. `e2e/clockReporter.ts` reports two things:

1. **The clock moved while the run did not** — any test whose duration exceeds
   its own timeout (plus a minute of teardown slack for trace-zipping). Names
   the test, points at `pmset -g log`, and says to re-run under
   `caffeinate -i npx playwright test`.
2. **This run outlived its own login** — the storage state's mtime is the mint
   time; past sixty minutes the note says the last leg failed on a dead
   credential and is not evidence about the features it names.

Neither fails the run. Their job is to stop a red run being *misread*, not to
add a new way to be red.

## Proven by mutation

Three mutations, three distinct failures, each caught by the test that names it:

| Mutation | Failed |
| --- | --- |
| clock-jump detector never fires | *is reported as the clock moving, not as a slow screen* |
| login-age banner never fires | *says so, and says the failures are not evidence* |
| teardown slack removed | *says nothing about a test killed AT its deadline* |

The last one is the one that matters most: without the slack, every genuinely
timed-out test would be reported as a sleeping machine, and the reporter would
cry wolf on exactly the runs somebody needs to read.

## What this is the second instance of

The API sweep once reported 97 bugs that were one expired token
([token-lives-one-hour](shopos-token-lives-one-hour.md)). It was fixed there and
only there — `docs/qa/sweep/api.py` has tracked `expires_at` ever since, and
`run.py` prints the calls that ran on a dead credential. **The browser suite,
which signs in exactly the same way against the same API, had none of it.** A
lesson learned in one harness is not learned in the other; this is the same
failure in a different harness, and the shared shape is worth naming:

> A credential minted once at the start of a long unattended run is a clock
> nobody is watching. When it expires, the failures do not say "expired" —
> they name whatever feature happened to be running.

Related: [measurement-that-lied](shopos-measurement-that-lied.md) — a fourth
way to get a plausible-looking result from a tool that never ran. Wrong cwd,
unquoted heredoc, soft-deleted target, and now **the machine was asleep**.

## Two things that cost time and are worth remembering

- **Killing a run destroys the evidence of the run before it.** Playwright
  wipes `test-results/` at startup, so the trace from the 41-minute test was
  gone the moment the next probe started. Copy the traces out first.
- **`--timeout=60000` on the command line broke setup**, because signing in
  deliberately waits 65 seconds out for `throttle:auth`. The 300-second global
  timeout exists for that one reason; overriding it globally to "make the repro
  faster" made a different test fail instead. Set the timeout inside the spec.
