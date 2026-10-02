# "No day open yet" — said to a shop that was trading

**Decided and shipped 2026-10-02.** Suspected twice earlier in the day and
each time apparently refuted; both refutations turned out to be my own
measurement.

## The problem

`BranchContext` answers two different questions:

| | |
|---|---|
| `id()` | the branch being **operated**. Never null for an owner — `ResolveBranch` pins them to Main when no header is sent |
| `scopeId()` | the branch being **looked at**. Null for an owner on "All branches" |

The panel's switcher sends `X-Branch-Id` for a chosen branch and **nothing at
all** for All branches (`activeBranchId === null` in `branchStore`, and
`client.ts` only sets the header when it is truthy).

`BusinessDayController::current()` asked `openFor($this->branch->id())`. On
All branches that is **Main**. So a chain whose Main had already closed and
whose other two shops were mid-afternoon opened Day & Banking and read:

> No day open yet.
> The day starts by itself when the first cashier opens a drawer.

Nothing on the screen named a branch, so the only reading available was
"nobody has opened the till" — on a day with money in three drawers.

## Two false refutations, and what they were

This is the part worth keeping.

**First attempt.** I called `OpenCashSessionAction` directly in a test and
dumped the context: `days=1`, so `scopeId()` was "not null without a header"
and the hypothesis fell. It fell because calling an action directly never runs
`ResolveBranch` at all — I had measured a context nobody had set.

**Second attempt.** A proper HTTP test, and four of five assertions passed
immediately — All branches *did* see Johar Town. Then:

```php
$this->withHeader('X-Branch-Id', $town->id)->postJson('…/session/open', …);
// …later, "with no header":
$this->getJson('/api/v1/pos/day');
```

`withHeader()` sets a **default header on the test case**, not a header on one
call. Every later request in that test was still saying *X-Branch-Id: Johar
Town*. The test proving what happens with no header was sending one.

`flushHeaders()` in the sign-in helper, and three of five failed exactly as
predicted. Same family as [Measurement That Lied]: the apparatus agreed with
whichever answer I had set up, and twice it was not the product's.

## The decision

```php
$open = $this->branch->scopesAll()
    ? BusinessDay::openAcrossTheShop()
    : collect(array_filter([BusinessDay::openFor($this->branch->id())]));
```

`openFor(null)` cannot answer the HQ question and must not try — it would look
for a day whose `branch_id IS NULL`, which is no day at all. **All branches is
not a branch**; it is a question about several, so `openAcrossTheShop()` is its
own method.

The response gains `also_trading`: the other branches with an open day, **named
rather than counted** — "2 others" is not something an owner can act on. The
screen prints them under the date with the one line that matters: *the figures
below are this branch only.*

Two things deliberately unchanged:

- **A chosen branch answers only for itself.** An owner looking at Main whose
  Main is closed is still told so; showing them another branch's drawer would
  be worse than showing nothing.
- **Staff are not HQ.** `ResolveBranch` pins them with `scopeAll: false`, and a
  cashier at Main seeing Johar Town's takings would be a worse bug than the one
  being fixed. That is the fourth test.

## Proof

`tests/Feature/WhichBranchIsTradingTest.php`, five tests. Replacing the
roll-up with the old single-branch read fails exactly two of them and leaves
the three guard tests passing — which is the shape that says the fix is
pointed at the right thing.
