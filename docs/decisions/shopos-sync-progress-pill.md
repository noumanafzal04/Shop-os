# The gap between "47 saved here" and "Online"

**2026-08-18.** The till's offline pill had four things to say and said three of
them. The fourth was the one a shopkeeper waits for: **the line came back and my
day's takings are going up right now.**

Without it the pill jumped from `47 still to send` straight to `Online`, with a
silent stretch in between where nothing on the screen changed. A gap is where
somebody starts pressing things — reloading the tab, signing out, closing the
lid — during the exact ninety seconds a bad shop connection had to give.

## The wording existed twice, and the copies had drifted

`pillLabel` in `offlineStore.ts` opens by saying *"One place, because the
wording is the feature."* It was on the `NOT_SURFACED_YET` exemption list, and
POS had **grown its own inline copy of the same four states**.

Two copies of one sentence do not stay one sentence:

| | the exported one | the POS one |
| --- | --- | --- |
| `No server` (network up, server silent) | ✗ | ✓ |
| `Sending X of Y` | ✓ | ✗ |

Each had learned something the other never did. `No server` is not a rewording
of `Offline` — **the two have different remedies.** "Offline" means wait for the
line. "No server" means telephone somebody. Selling carries on either way, which
is why the distinction has to be in the words: nothing else on the screen
behaves differently.

POS now calls the function. The exemption is gone, and the entry that replaced
it says why it matters:

> An entry on `NOT_SURFACED_YET` is not free. While `pillLabel` sat on it, the
> screen that should have used it quietly wrote its own, and then the two
> diverged.

## Three decisions inside the progress itself

**The denominator freezes at round 0.** The total is read from the first round's
own `dueRows` query — the rows are already in hand there, so it costs no extra
read. Fixed at the start on purpose: a sale rung up *during* a flush must not
extend the total, or **the bar walks backwards while the cashier watches it.**
`Sending 12 of 47` becoming `Sending 12 of 49` reads as a fault in the software.

**Count rows that got an answer, not rows that went on the wire.** Progress is
`acked + failed`, never `sent`. A round where every row came back retryable put
fifty rows on the wire and moved nothing; reporting that as progress is a
reading a shop acts on, and it is false. `failed` counts because a refusal is a
terminal answer — that sale is not going to move again, and the count of what is
still owed has genuinely dropped.

**Per round, not per row.** Fifty queued sales are one batch. A per-row callback
would fire fifty times and render nothing a person could read.

**Silence when nothing is owed.** `pullNow` only reports when `total > 0`.
Announcing `Sending 0 of 0` every fifteen minutes on the catalog timer teaches a
cashier to stop reading the pill, and then the pill is worth nothing on the day
it matters.

**Cleared in `finally`, not on the line after the `await`.** A flush that throws
must not leave `Sending 12 of 47` frozen on the till for the rest of the shift.
That is a **worse lie than saying nothing** — it reports work in progress that
stopped an hour ago.

## `isPulling` stays exempt, with a new reason

It was tempting to wire the catalog pull into the same indicator while the
plumbing was open. It was not done, and the reason is worth stating rather than
inheriting:

**The pill reports the outbox, which is money.** A catalog pull is background
housekeeping — prices, products, a customer group. Giving it the same indicator
means the one control a cashier makes decisions by flickers for something that
does not concern them, and an indicator that fires for things that do not matter
stops being read for the thing that does.

Its exemption line now names what would surface it: **a manual "Sync now"
control.** A person who presses a button is owed the answer to "is it working" —
that is a different question, asked deliberately, and it deserves its own answer
rather than borrowing the money one.

## Mutation checks

Both fired, which is the only evidence the tests are load bearing:

- `acked + failed` → `sent` : failed *"counts rows that got an ANSWER, not rows
  that went on the wire"*.
- `if (round === 0) total = …` → `total = …` : failed that test **and** *"holds
  the total still when a sale is rung mid-flush"*.

Panel 937 green.
