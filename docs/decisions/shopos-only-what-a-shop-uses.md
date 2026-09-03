# Only what a shop uses

**2026-09-03** · module registry · `Modules`, `BusinessTypes`, `routes/api.php`, `AppSidebar`, `ModulePicker`

## What was wrong

A shopkeeper's complaint, not an engineer's: **a small takeaway café is shown
Disposals, Bank card offers and a warehouse's worth of screens that link to
nothing it does, and the clutter is itself the problem.**

The cause was arithmetic. The registry held **11 module keys** and the menu
produced **53 screens**, so most screens arrived as **passengers** on a module
somebody else bought:

| switch on | and the shop also gets, whether it wants it or not |
|---|---|
| `inventory` | Disposals · Stocktake · Barcode Labels · Suppliers · Purchases |
| anything that sells | Customers · Coupons · Promotions · **Bank card offers** |
| `pos` | Quotes & Advances |

And the sharpest one, which is where this became undeniable: **the kitchen pass
lived inside `feature:dine_in`.** A café that only does takeaway had to switch on
an entire restaurant — a floor of tables, running tabs, settle, split-bill,
waiter reports — to get a slip to its kitchen.

## Measured, not assumed

The nav ratchet in `shopNav.test.ts` asks the question behaviourally: switch on
ONE module and list what appeared. Whatever appears is what that module drags in,
whatever the code looks like. Its first run was red on five modules, naming
exactly the table above.

## What changed

**Nine new keys, and no new mechanism.** Granularity here is just more keys with
`depends` — `normalize()` did not change:

`purchasing` · `stocktake` · `disposals` · `labels` (all → `inventory`) ·
`customers` · `promotions` · `bank_offers` (→ `promotions`) ·
`documents` (→ `pos`) · `kitchen` (→ `products`)

and `dine_in` now **depends on `kitchen`** — a Fire button whose ticket landed
nowhere would be a floor with no kitchen.

Each key landed in **three places at once**: the registry, the route middleware,
and the nav. A key in two of the three is the `MODULE_DISABLED` bug class — a
screen offered and then bounced, which is the scar `shopos-job-offered-must-be-doable`
records.

## The four rules this had to keep

**1. No live shop loses a screen.** A new key defaulting to `false` would take
Purchases away from every shop using it on the morning of a deploy, with no admin
having decided anything. The migration backfills each key from **whatever was
letting that screen through yesterday** — and that promise has its own test,
which runs the migration over an old-shaped map and checks the menu is unchanged.

**2. Only the EXTRA ones start off.** `customers` and `purchasing` are not
extras — a Pakistani shop keeps a khata, and a shop tracking stock with no way to
record what it bought could only ever increase stock by hand. The genuinely
optional ones start off per trade (`BusinessTypes::TOOL_DEFAULTS`), and
`bank_offers` starts off for **every** trade: it is the screen the shopkeeper
pointed at.

**3. A press pulls its chain up, and says so.** `Modules::normalize` on the
server only ever switches things OFF. Switching a dependency ON is deliberately
**not** a server rule — the server must never grant what nobody chose — but as an
admin gesture it is exactly right. The old screens answered by greying the row
out and leaving the admin to find which of nineteen switches to press first.

**4. A module standing on nothing is not enabled.** `featureEnabled` now walks
the `depends` chain rather than reading the flag. `applyModules` normalizes on
the way in, but `features` is a JSON column and a seeder or a console data fix
can write straight to it. That used to cost nothing; now it would open a stock
screen for a shop that keeps no stock.

## The UI

One `ModulePicker`, used by **both** the create screen and the detail screen. It
was two copies of the same rule, already drifted, and neither could switch a
dependency on for you. Section-wise from the registry's own `group`, each section
showing "3 of 5", each row saying what a press will also do — before and after.

And a **tenant-side** read-only view (`Settings → Your modules`, backed by
`GET /shop/modules`): modules stay the admin's decision, but *"why can I not see
Purchases"* is a question a shopkeeper asks and it had nowhere to look. The OFF
ones are listed too — that is the half that lets somebody ask for a part by the
name the admin will recognise.

## The gap this exposed and did not close

A takeaway sale rung at the till **still does not reach the kitchen board**. KOTs
are created only by a dine-in tab's Fire, so `kitchen` on its own is a pass with
nothing on it unless every order is run as a tab. Splitting the module was the
prerequisite; wiring `order_type = takeaway` through to a KOT is the next piece
of work and is written down rather than half-built.

## Proven

Backend `ModuleSplitTest` — every module's door shuts when it is off and opens
when it is on, per trade defaults, the migration's promise, and the two registry
guards. Panel — the nav ratchet, `moduleRules` both directions, the picker's
ripple, and the tenant view. Two module lists (`Modules::keys` and
`BusinessTypes::FEATURES`) are pinned against each other, because two lists of
one rule is how a module gets granted and never shown.
