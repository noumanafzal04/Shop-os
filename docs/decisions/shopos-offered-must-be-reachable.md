# A job offered must be a job doable — on every surface, not just the menu

**2026-09-03.** The shop asked a plain question: *"jo modules assign nahi huye
wo kahin kisi page py show to ni ho rhy — reports tabs, settings, ya kisi b page
py?"* The answer was no, in eight places.

## What was wrong

Splitting nine passenger screens into modules of their own (P1) landed the new
keys in three places: the registry, the route gate, and the sidebar. The sidebar
had a test. **The dashboard and the reports screen offer screens too, and had
none** — so four offers were left asking the parent key they used to ride on:

| Surface | Asked | Route wants |
|---|---|---|
| Reports → Purchases | `inventory` | `purchasing` |
| Reports → Bank claims | "does this shop sell" | `bank_offers` |
| Dashboard → Stock in → `/tenant/purchases` | `tracksStock` | `purchasing` |
| Dashboard → You owe → `/tenant/suppliers` | `tracksStock` | `purchasing` |

Two more were the same shape one level further out:

| Surface | Asked | Route wants |
|---|---|---|
| Settings → Point of Sale → **Kitchen** tab | `dine_in` | `kitchen` |
| `GET /restaurant/tickets/{ticket}/kot/{kot}` | `feature:dine_in` | `feature:kitchen` |

Those last two are the takeaway café — the shop this whole split exists for. It
was handed the kitchen pass, told to work off it, **and could not name a station
or decide whether tickets print**, because the settings tab still asked for a
floor it does not have. The KOT renderer was inside the dine-in route group for
the same historical reason, so the one kind of shop that needed to print its own
slip was refused with `MODULE_DISABLED`.

And two the guard found after it was fixed (below):

| Surface | Asked | Route wants |
|---|---|---|
| Dashboard → Owed to you → `/tenant/customers` | "does this shop sell" | `customers` |
| Dashboard → Day & banking (card, 2 tiles, header link) | permission only | `pos` + permission |

The last one is worth its own line: the card's **header** link read `till`, the
**tiles** read something else. Two places, two answers, in one component. It is
now one line — `caps.pos && caps.visit("/tenant/day") ? data.till : null` — so
the header and the tiles cannot disagree again.

## Why it reads as a broken product

A module a shop was never sold is invisible and fine. A **button that bounces**
is not: the shop sees the offer, presses it, and its own app refuses it. That is
the worst version of a module boundary, and it is the shape
[`shopos-job-offered-must-be-doable`](shopos-job-offered-must-be-doable.md)
already named once, for a restaurant handed a Purchasing job with every screen
`MODULE_DISABLED`.

## The guard, and the first version of it that was blind

`panel/src/test/offeredIsReachable.test.ts`.

The first version carried a **hand-written table** saying which capability
guarded which link. Putting the original bug back — `caps.tracksStock` guarding
"Stock in" — left every assertion **green**, because the table still said
`buysFromSuppliers`, and the table was what was being graded. A detector that
cannot fail when its subject is broken is not a detector; see
[`shopos-detector-vs-rule`](shopos-detector-vs-rule.md).

Both halves now read the thing itself:

- The **gates** are parsed out of `App.tsx` (`src/test/routeFeatures.ts`), by
  walking the `<Route element={<RequireFeature feature="…" />}>` nesting. A
  route inside two gates carries both requirements — `/tenant/suppliers` sits
  inside `inventory` and then `purchasing`.
- The **offers** are read out of the DOM the panels actually render: mount
  `QuickActions` and `MoneyPanel`, collect every `<a href="/tenant…">`.

It mounts a shop with everything on, a shop with nothing, the eight trade
defaults, and **everything-but-one-module for each of the twenty keys**. That
last set *is* the mutation: switch off `purchasing` alone and the dashboard must
stop offering `/tenant/purchases`.

Three mutations were run against it and all three went red:

1. `caps.tracksStock` back on "Stock in" → *offered /tenant/purchases to a shop
   without purchasing*
2. Bank claims back on `SELLS` → *report tab "bank-claims" offered to ["pos"]*
3. `kotPrint` back inside `feature:dine_in` → **403 `MODULE_DISABLED`**, the
   exact refusal the café was getting

## A matrix must settle its own shops

The walk generates module combinations, and the first run reported two defects
that were not defects: `purchasing` on with `inventory` off, `marketplace` on
with `products` off. **The server's `Modules::normalize()` never stores those** —
a module whose dependency is off is switched off. `/tenant/purchases` is nested
inside both gates precisely *because* the second implies the first.

`settleFeatures()` in `src/test/tradeFeatures.ts` mirrors that, so the matrix
asks questions about shops that can exist. A matrix that ignores dependencies
grades the wrong thing and files the answer as a bug.

## One table, not two lists

`reportTabs.ts` held the rule twice: a function deciding which tabs to DRAW, and
two flat arrays (`STOCK_TABS`, `SALES_TABS`) deciding which tab a shop may still
be SITTING on. Two copies of one rule drift, and both were wrong the same way.
It is now one table with a `needs` column — the shape `settingsTabs.ts` already
uses — and `reportTabAvailable()` answers both questions. `POS_SUBTABS` moved
out of `ShopSettingsPage.tsx` into `settingsTabs.ts` for the same reason: a rule
inside a 1,000-line screen cannot be tested.

## And the slip the counter has to hand over

P2 got a takeaway rung at the till onto the kitchen **board**. That is half of
"send it to the kitchen": most small kitchens work off **paper**, and
`kot_auto_print` is the shop's answer to which it is — a switch read in exactly
one place, the dine-in tab's Fire button. So a counter with no floor obeyed a
setting nobody asked it about.

The till cannot print what it does not know exists, and the ticket is made on the
server after the sale is paid. So the response names it, and the till prints it
through the same renderer the floor uses — one renderer, so a counter docket and
a floor docket cannot come out of the printer looking like two different
products. Offline is skipped: it is server-rendered, and it would be the one
failure a cashier sees at the moment the shop is proving it can trade without a
connection.

### The bug I shipped writing that, and what it cost to find

The first version wrote the payload onto the model:

```php
$sale->setAttribute('kitchen_ticket', [...]);   // WRONG
```

A `Sale` is a **row**. An attribute that is not a column makes the model dirty,
and every later `$sale->save()` tries to write it. `DemoDataSeeder` saves the
sales it rings, so its **warranty and loyalty blocks died mid-run** and the suite
went red on two `DemoWorldIsCompleteTest` cases — a long way from the cause, and
in files this change never touched.

It lives on the **action** now (`CreateSaleAction::$kitchenTicket`), reset at the
top of every `execute` — a stale ticket id would print somebody else's order —
and the till's controller merges it into the response. The other three callers
(offline sync, online orders, the seeder) read nothing and are unaffected.

**The lesson is the one this repo keeps relearning:** the full suite is what
caught it. `--filter` on the tests I had just written was green.

## Gates

Backend `2470 / 2472` (2 deliberate skips) · panel tsc 0 · vitest `1463 / 124
files` · eslint 0 errors · pint clean · Playwright device projects `237 passed`.
