---
name: shopos-table-ownership
description: 2026-08-07 SHIPPED — a dine-in tab belongs to its waiter; tables.serve_any lifts it; reads stay open. Also fixed floor-read gated behind settings.manage.
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T13:07:03.398Z
---

**Rule: a tab belongs to the waiter serving it.** Writes to a tab require that
it is yours, or the permission `tables.serve_any`. Enforced in
`RestaurantTicketController::assertMayWork()`.

**Why it is about money, not privacy:** `/restaurant/reports/waiters` is what a
restaurant pays tips and commission off. If anyone can settle anyone's bill the
report attributes takings to the wrong person, and the error is invisible —
a settled tab looks identical either way.

## Three deliberate edges

- **Reads stay open.** A waiter running a colleague's food needs to see the tab.
  `show`, `index`, KOT print and the kitchen board are ungated.
- **An unclaimed tab (`waiter_id === null`) is everyone's** — never an orphan
  only an owner can settle.
- **Opening is always allowed** — opening a tab is what makes it yours.

Hand-over: you may GIVE your own table away; TAKING someone else's needs the
permission (else `assignWaiter` is the way around every other check). `merge`
checks BOTH tabs.

## Who carries it

`cashier`, `shift_supervisor`, `manager` presets — the till settles what the
floor opened. **`waiter` and `kitchen` deliberately do not.** A migration
(`2026_08_07_000002`) backfilled it to every existing staff user holding
`sales.manage`, tested by invoking the migration by hand — `RefreshDatabase`
migrates an empty DB and would never run the loop.

## The bug this uncovered

**Reading the floor was behind `settings.manage`, which no preset grants** — so
the Waiter preset produced staff who could not load the dine-in screen at all.
`GET /restaurant/tables` + `{table}` are now `sales.manage`; create/update/
delete/reorder stay `settings.manage`. Generalise: check that READ routes of a
working screen are not sitting inside a config permission group.

## Also

- `dining_tables.area` was inert (API accepted, panel never sent). Now a
  Section field + grouped floor; reorder stays inside a section.
- Panel `hint` in `PERMISSION_LABELS` was declared and never rendered — now
  under each checkbox. 8 tenant permissions had no label at all.
- Panel mirror is `src/modules/dinein/ownership.ts` (`mayWorkTable` pure fn +
  hook), tested to agree with the server exactly.

Related: [[shopos-no-roles]], [[shopos-food-dinein]], [[shopos-web-completion]].
