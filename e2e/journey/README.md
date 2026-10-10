# The journey

One business, created by the platform admin and lived through by its owner —
in the order a business actually lives, through the screens, with every
figure worked out by hand in the spec that checks it.

Cases: `docs/qa/journey/CASES.md` · Runs and what each found:
`docs/qa/journey/RUNS.md`.

## Run it

Both servers up (backend on :8000, panel dev on :5177), then from `panel/`:

```sh
# the whole journey, on a brand-new shop (about 40 minutes)
E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey --reporter=line

# one stage, against the shop the last run made
E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey e2e/journey/12 --reporter=line

# one case
E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey e2e/journey/12 -g "Tips" --reporter=line

# another trade (stages 01–02 are trade-agnostic; see "Other trades")
JOURNEY_TRADE=food E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey e2e/journey/01 e2e/journey/02 --reporter=line
```

`E2E_BASE_URL` skips the build-and-preview server the other projects use.
Do not run it beside `php artisan test`, `vitest` or a build: a suite
competing with itself for the machine fails for reasons that are not the
product's.

## Stages

| File | Stage | What happens |
|---|---|---|
| 01 | A | The admin creates the business with every module on |
| 02 | B | The owner signs in, finishes setup, opens every menu screen |
| 03 | B | Tax, tax groups, a category, six items |
| 04 | B | Suppliers, a purchase order received, customers and groups |
| 05 | B | A coupon, a promotion, expenses, income |
| 06 | B | A second branch, a cashier |
| 07 | C | A shift, ten sales across every tender |
| 08 | C | Returns, a khata payment, the drawer, the day closed |
| 09 | D | Reports, tax, stock, who owes whom — held to hand-worked figures |
| 10 | E | 2,000 products through Import; 1,500 sales from two tills |
| 11 | F | The admin again: usage, a module off and on, suspend, activate |
| 12 | G | Every Settings tab: saved, reloaded, and looked for where it is used |

Stage 01 calls `begin()` and so starts a NEW business; every later stage
resumes the record in `e2e/.journey/<trade>.json` (git-ignored). Stage 09's
figures hold only straight after stage 08 — it is a stage in a sequence, not
a check to run on an old shop.

## How a case is judged

- **Watched.** Every API answer of 400 or more, and every error the page
  throws, fails the case unless it said beforehand that it expected it
  (`watch.expect(/…/)`). "It looked fine" is not a pass when a request behind
  it was refused.
- **Worked out here.** Expected figures come from the price list in
  `shop.ts`, never read back from the server. A test that adds up what the
  server said and asks the server whether it agrees has asked nothing.
- **Through the screen.** `ask()` reads the server as a second opinion; it is
  never how a case DOES the thing it is about.
- **Put back.** A stage that changes the shop's settings restores them.

## Things that will bite

- A token lives an hour. `session()` renews a saved sign-in older than 35
  minutes — and checks it is still ALIVE, because the journey itself ends
  sessions on purpose (a shop suspended, a till handed over by PIN).
- Sign-in is limited to five a minute per address; one person to 240
  requests a minute. A walk of fifty screens has to be paced like a person.
- The till keeps its cart across a reload. A case that leaves a line in it
  hands that line to the next case.
- "What is on top here?" is not "what can be seen here". Map tiles take no
  pointer events, so `elementFromPoint` answers "the button" under a map that
  covers it completely. A thing painted over another is measured in pixels
  (stage 28, Q12).
- A check inside `if (not already done)` is not run on a resumed business. What
  must hold on EVERY run goes outside it — or a mutation of it survives.
- A clock on the wall is tested by the wall's clock: the idle-lock case waits
  three real minutes, because a faked clock never locked the till.

## Other trades

Stages 01–02 work for every business type as they are
(`JOURNEY_TRADE=food|pharmacy|retail|automotive|petroleum|services|online|finance`).
Stages 03 onwards stock and sell a MART's shelf; each other trade has its own
stage, 20 onwards, listed in `CASES.md`:

| File | Stage | Trade | Runs on |
|---|---|---|---|
| 20, 21 | H, J | food | the shop stages 01–02 made |
| 22 | K | pharmacy | 〃 |
| 23 | L | retail | 〃 |
| 24 | M | automotive | 〃 |
| 25 | N | petroleum | 〃 |
| 26 | O | services | 〃 |
| 27 | P | online | 〃 |
| 28 | Q | finance | **its own business** — see below |

**Stage 28 makes its own business.** Stage 01 switches on every module, and
the whole subject of a Finance Manager is that it has only the books. So Q1 is
the admin creating a books-only business (and calls `begin()`: every run of Q1
is a NEW one), Q2 is the owner's first sign-in, and Q3–Q13 resume it:

```sh
# the whole stage, on a new business (about two minutes)
JOURNEY_TRADE=finance E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey e2e/journey/28 --reporter=line

# some cases, against the business the last run made — NOT Q1, and not Q2,
# which is the first sign-in and can only happen once
JOURNEY_TRADE=finance E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey e2e/journey/28 -g "Q9 ·|Q10 ·" --reporter=line
```

Its figures are two days — yesterday and today — so it runs on any date; on
the 1st of a month it knows yesterday was last month's.
