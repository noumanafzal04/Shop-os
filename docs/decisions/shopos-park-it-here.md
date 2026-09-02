# Park it here

**2026-09-03** · offline till · `PosPage`, `usePos`, `heldLocal.ts`

## What was wrong

Offline hold/recall was **built, tested and wired** — and unreachable.

`src/modules/pos/heldLocal.ts` shipped on 18 August: park, list, claim, remove,
tenant-fenced, twelve-hour expiry, seven unit tests. `usePos` was wired for all
of it — `useHeldSales` merged the local rows into the shared list,
`useHeldMutations.hold` fell back to a local park on `status 0`, and `claim` and
`remove` both read the id and took the local path.

On 21 August the till's screen was given three `!connected` fences:

| door | what it said |
|---|---|
| Hold | "Held tickets need the line… complete this sale" |
| Resume | "Resuming a parked ticket needs the line" |
| the list | "It is not empty — it cannot be read from here" |

Each was defensible **beside the other two**, and that is what made it hold:
nothing could be parked, so the list was empty, so showing it was pointless, so
nothing could be parked. The commit that added them was a real fix for a real
lie ("No held sales" is false when the shop has ten). It replaced the lie with a
refusal, three days after the thing being refused had shipped.

The ledger then recorded hold/recall as *"the last offline coding task, a design
question rather than an oversight"*. The design question had already been
answered, in a file with a docblock explaining the answer.

## What the feature actually promises

Online, a parked ticket belongs to the whole **site**: parked at lane 1, picked
up at lane 3, and resumed by a locked **claim** so two lanes cannot ring one
basket. With no line, none of that exists.

So the offline version makes the **smaller promise** rather than breaking the
big one: parked on **this till**, listed on this till, resumed on this till.
Nobody else can see it, so nobody else can take it — the rule holds by
construction, with no lock at all.

And the till says which kind a row is: before parking ("this parks on this
till"), after parking ("Parked on this till… another lane cannot see it"), and
on the row itself (`· this till only`). A cashier who knows can tell the
customer which counter to come back to. That is the whole difference between a
smaller promise and a broken one.

## Why they are never pushed up when the line returns

Considered and rejected, and `heldLocal.ts` already said so:

- A held ticket is an **intent**, not money. The outbox exists because a sale
  that never arrives is a customer who paid and vanished from the books.
  Nothing of the sort is true here.
- A queue can only flush **after** the line returns — by which time the tickets
  have usually been recalled and rung. The shop would find its lanes offering
  baskets that had already been sold.
- `POST /pos/held` takes no idempotency key, so a lost acknowledgement parks the
  same basket twice.

## The one change to the hook

`hold` gained an explicit `offline` flag. The `status 0` fallback stays for the
till that *believed* it was connected, but a till already showing an offline
pill must not spend a **20-second request timeout** rediscovering that with a
customer waiting.

## Proven

`e2e/offline-shift.spec.ts` parks a ticket with `context.setOffline(true)`,
checks the cart cleared, opens the list, finds the ticket marked *this till
only* beside a note that the shared list cannot be read, resumes it, and
confirms the basket came back — green on **desktop, phone and tablet-landscape**.

Restoring the Hold fence turns it red on the exact sentence: *"the ticket was
parked with no line and the till did not say WHERE"*. jsdom could never have
caught this: `navigator.onLine` is `true` there no matter what.

## The lesson

A refusal is a claim about the code, and it goes stale like any other. Three
fences, each holding up the next, kept a finished feature switched off for a
fortnight while the plan document recorded it as *not implemented* and the
ledger recorded it as *a design question*.

Before writing a refusal, grep for the thing being refused.
