# A shift opened at the wrong station blocked the whole forecourt

**Decided and shipped 2026-10-02.** The most serious of five forecourt gaps
recorded earlier and deferred.

## The problem

One forecourt, one open shift. The rule is right — two would each hold a
claim on the same meters and neither could be reconciled.

Its consequence was never designed. A shift opened in error **blocked the
station** until it was ended, and the only way to end one was to CLOSE it:
a closing reading for every nozzle and a dip for every tank.

So the manager who pressed the button at six in the morning had two bad
choices:

- **Invent the closing figures.** The reconciliation that never happened then
  sits in the month's fuel report for good, and the fuel report is the
  document an owner uses to decide whether somebody is stealing.
- **Leave it open.** On a station running three shifts a day, that is the
  night's trading.

## The decision

A third status, `cancelled`, reached through `POST /fuel/shifts/{id}/cancel`.

It is a way back to **exactly** the state the forecourt was in a minute ago,
and nothing more. It is not a way to discard a shift that went badly, and
every fence exists to keep those two apart:

| Fence | Why |
|---|---|
| nothing sold on it | the litres left the ground; abandoning it throws away the only record of that |
| no tanker discharged | the dips moved; putting them back would un-receive fuel the station holds |
| the plant can be restored exactly | see below |

### The snapshot, and why a shift can be too old to cancel

Opening may **move** the plant: an opening reading above the nozzle's last
one winds the totaliser forward, and an opening dip overwrites the tank's.
Those are the only two things it changes, and the previous values were simply
overwritten.

`forecourt_readings.previous_reading` and `forecourt_dips.previous_dip` now
record them at open time. A shift opened **before** that snapshot existed
cannot be cancelled at all, and the refusal says so:

> This shift was opened before the forecourt started recording what the
> meters read beforehand, so there is nothing to put them back to.

A cancel that restored a figure it invented would leave a meter reading and a
tank dip that no shift accounts for — which is the same leak the module
exists to detect. Better to refuse.

## The row stays

`cancelled`, with who and why. An unexplained gap in the shift numbering
would be worse than an abandoned shift that says somebody opened this station
at 6am and walked away from it.

## On the screen

**Opened by mistake**, beside Close rather than instead of it, because the
server refuses it the moment a litre has been sold — and the refusal names
the litres.

## Proof

`tests/Feature/AShiftOpenedByMistakeTest.php`, eight tests. Three of them are
the refusals, one is the premise (a second shift really is blocked), and the
one that matters most asserts that a keyed opening is wound back: a cancel
that freed the forecourt and left the totaliser moved would pass every other
test in the file.
