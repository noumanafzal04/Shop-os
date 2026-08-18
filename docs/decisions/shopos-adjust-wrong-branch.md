# The stock correction that landed at the wrong shop

**2026-08-18.** Found by the QA sweep, phase K. The second product defect the
sweep has produced, and the same shape as the first.

## What was broken

An owner running two branches switches to the second one in the panel and
corrects a figure — a breakage, a recount, a write-off. **The correction lands
on Main's shelf.**

Two shelves are now wrong from one correct action: the branch they were fixing
still isn't fixed, and the branch they weren't looking at has been silently
changed. Nothing errors. The screen they were reading — low stock, stock counts,
the valuation — was showing the second branch the whole time.

## Why

`InventoryService::adjust` takes the branch from the **request body**:

```php
$branchId = $data['branch_id'] ?? $defaultBranchId;
```

and `AdjustStockRequest` has no `branch_id` rule at all. So it was always
`$defaultBranchId` — Main — no matter which branch was being operated.

Meanwhile the panel sends `X-Branch-Id` on **every** request
([`client.ts:36`](../../shopos-admin-and-user-panel/src/common/api/client.ts#L36)),
and `ResolveBranch` turns it into a `BranchContext` that says exactly which
branch the owner is standing in.

## What makes it unambiguous

Every other stock write already resolved this correctly, and two of them say so
in comments:

| Path | Branch |
|---|---|
| Receiving a lot (`BatchController`) | operating branch — *"Receiving is a WRITE, so it takes the OPERATING branch"* |
| Stocktake (`StockCountController`) | operating branch — `'branch_id' => $this->branch->id()` |
| Transfer (`TransferController`) | both ends named explicitly |
| Sale / return / void | operating branch |
| **Hand adjustment** | **always Main** |

Four paths write to the same shelf. Three ask where you are. The fourth — the
one a shop reaches for most often, because it is the only way stock changes by
hand — did not.

## The fix

The branch is resolved in the controller and **never** taken from the body:

```php
$movement = $inventory->adjust([
    ...$request->validated(),
    'branch_id' => $branch->id(),
]);
```

From the controller rather than the request because `BranchContext` already pins
staff to their assignment — accepting a branch id from the client would let a
cashier at one site write off another site's stock. The service keeps its
Main fallback for headless paths, where there is no request branch and Main is
the right answer.

## Why the tests missed it

`BranchOperatingContextTest` exists and is exactly about this question. It had
four tests:

- an owner's sale decrements the selected branch ✓
- an owner's sale with no header hits Main ✓
- staff are pinned and ignore a spoofed header ✓
- returning a branch sale restocks that branch ✓

**All four are about the sale path**, which was correct. The adjustment path —
the other way stock moves, and the more common one — was never asked. The class
had the right name, the right fixtures and the right idea, and simply never
called the endpoint that was broken.

Three tests added: an adjustment lands on the operated branch, no header still
means Main, and a spoofed header cannot move staff. Reverting the fix turns two
of the three red — checked, not assumed. Full suite: **2074 passing**.

## The rule this leaves behind

The same one the forecourt left, arriving from the other direction:

> When several paths write to one thing, they must all answer "where?" the same
> way. Three out of four is not a convention — it is a bug with three witnesses.

Worth noting how it was found. Phase K set 60 at Main and 25 at the second
branch, then read back **25 and 0** — both writes had landed on the same shelf.
Not a crash, not an error: two numbers that could only have come from one place.
