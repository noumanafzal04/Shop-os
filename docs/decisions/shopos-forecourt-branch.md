# The forecourt nobody could start

**2026-08-18.** Found by the QA sweep, phase G. The first product defect the
sweep has produced, against 20 findings that turned out to be the sweep itself.

## What was broken

A petrol pump that set up its forecourt through the panel could **never open a
forecourt shift.** It was told:

> Set up at least one tank and one nozzle before running a forecourt shift.

— immediately after doing exactly that. There was no way out of the loop, and
the message pointed at the one thing that was not the problem. The whole fuel
module was unreachable for any station that used the shipped screen.

## Why

Two halves answered the same question in opposite directions and never met.

**Opening a shift** already knew that a single-site station names no branch:

```php
// A single-site station never sends a branch. Resolve it to Main
// rather than leaving it null, or the shift looks at a forecourt
// with no branch and finds no equipment at all.
$branchId = $data['branch_id'] ?? Branch::query()->where('is_default', true)->value('id');
```

**Adding a tank** stored the null:

```php
$tank = FuelTank::query()->create($request->validated());   // branch_id: null
```

`branch_id` is `nullable` on the request, and
[`FuelSetupPage.tsx`](../../shopos-admin-and-user-panel/src/modules/fuel/pages/FuelSetupPage.tsx#L49-L58)
does not send it — correctly, because a one-site station has nothing to pick
from. So the tank sat at no branch while the shift looked for equipment at Main,
and `where('branch_id', $branchId)` matched nothing.

Exactly one of those two answers can be right. The shift's comment even
describes the failure it was about to suffer from the other side.

## The fix

One resolver, called from both sides, so they cannot disagree again:

```php
// app/Models/Branch.php
public static function writeTargetId(): ?string
{
    $operating = app(BranchContext::class)->id();

    return $operating ?? static::query()->where('is_default', true)->value('id');
}
```

`FuelSetupController` now stamps it onto tanks and pumps at creation; the shift
action calls the same method instead of its own inline query. Plus a migration
that attaches every already-orphaned tank and pump to its tenant's default
branch — without it, a station broken before today stays broken after the fix
ships, which is the worse half of the bug.

## Why 25 tests missed it

`FuelManagementTest` is thorough — meter roll-over, test litres, unbilled fuel,
dip variance, equipment locked during a shift. It has **34 tests now** and had 25
before, and every single one built its forecourt like this:

```php
FuelTank::withoutTenancy()->create([
    'tenant_id' => ..., 'branch_id' => $this->branchId(), ...
]);
```

**Every fixture supplied the field the real client omits.** A suite built that
way can never observe the field being required, no matter how many cases it
covers. The gap was not in the tests' depth; it was that nothing ever created a
tank the way the product creates one.

> A fixture that always fills in what the client leaves out cannot find out that
> it mattered.

The regression test added here goes through the HTTP endpoints with the panel's
exact payload and nothing else. Reverting the fix turns it red — checked, not
assumed:

```
A tank created without a branch must still stand at one, or no shift will ever find it.
Failed asserting that null is identical to '01a0152a-…'.
```

Full backend suite: **2071 passing.**

## The rule this leaves behind

When a value is optional at the edge, one place decides what its absence means.
If two places decide, they will decide differently, and the failure will surface
somewhere neither of them is looking — here, in an error message about equipment
that was sitting right there.
