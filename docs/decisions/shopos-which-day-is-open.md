# The shop that forgot to close last night

**2026-08-19** · backend `app/Models/BusinessDay.php`, `BusinessDayController.php` · sweep `docs/qa/sweep/phase_p.py`

## The bug

**Money banked today was recorded against yesterday.**

"Which day is this counter trading?" was asked in three places and answered
three ways:

| Where | How it asked |
|---|---|
| `CloseBusinessDayAction::open` | branch + **today's date** — which is what a day *is* |
| `BusinessDayController::current` (the screen) | open day, `latest('trading_date')` |
| `BusinessDayController::storeDeposit` | open day, **no ordering at all** |

The third takes whatever the database hands back first. On a counter with one
open day nobody could tell the difference. On a shop that forgot to close last
night — an ordinary Monday morning — there are two, and it took the **older**
one.

So the shop walks Rs 40,000 to the bank, the banking column on today's screen
never moves, the day looks unbanked all afternoon, and yesterday's day is
eventually closed off carrying money that was never in it.

## The fix

One resolver, `BusinessDay::openFor(?string $branchId)`, used by both the screen
and the deposit. Ordering by trading date is not a tie-break here — it is the
definition: *of the days still open at this counter, the shop is trading the
newest.*

## The test that was not a test

The first regression test passed **against the broken code**.

An unordered `->value('id')` returns rows in insertion order, and the test built
today's day first, so the broken query found the right one by luck. The fix was
to build the rows in the order reality builds them: **yesterday's day exists
first, because yesterday came first.** Then it fails red, as it should.

This is the same failure as the sweep's own harness bugs — a check that looks at
something adjacent to what it names.

## Why the sweep found it and 2,076 tests did not

Nothing had ever driven the trading day from outside. `php artisan test` builds
one day per test, so the two-open-days state — which is not exotic, it is what
every shop that shuts late looks like — never existed in a fixture.

## Two things Phase P had to learn about closing a day

**It is irreversible.** A day is keyed on branch + date and there is no re-open
path. The first version closed the real trading day on all eight sweep shops and
every phase from C onward went red at once — *"Trading on 2026-08-19 has already
been closed off"* — for the rest of the day. Correct behaviour; unrecoverable
harness.

A day belongs to a **branch**, so the phase now trades on one nobody else
touches, and takes the next one when today's is spent. The plan's branch ceiling
is real and refuses at 4, so `ROOM` was raised to 12 — after phase A has already
proved the ceiling refuses.

**The destructive check must not gate the harmless one.** Banking closes nothing
and runs on the counter the shop actually trades from. It was ordered *after* the
private branch, so when the branch ceiling bit — correctly — the check that
found the defect was the one that silently stopped running.

## Related

- `shopos-detector-vs-rule.md` — a guard that passes while blind to its subject.
  The first version of this fix's test is a textbook case.
- `shopos-forecourt-branch.md`, `shopos-adjust-wrong-branch.md` — the other two
  sweep finds, and the same shape: one question, two paths, two answers.
