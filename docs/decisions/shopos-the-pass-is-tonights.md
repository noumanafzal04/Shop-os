# The pass is tonight's

**2026-10-06 · reported from a restaurant**

> "bht old data b kitchen main show ho raha — current day, or baki ya admin
> close all krdy… close all on single click. DIN screen achi bnao."

## What was on the wall

The kitchen board showed every docket nobody had bumped, for as long as its
tab stayed open — and nothing closes a tab but a person. A takeaway rung at
the counter whose docket the cook never tapped; a table nobody settled: each
led the next morning's queue, and the morning after. Taking one down meant
three taps through Start → Ready → Served, which is also three lies in the
kitchen's own timing record.

The floor had the same fault from its side: a table left open last night was
"occupied" this morning, indistinguishable from one sat five minutes ago.

## The window (`App\Support\ServiceDay`)

The board shows THIS service. Two rules, and the earlier wins:

- the day turns at **05:00 by the shop's own clock** — after any night's last
  order, before any morning's first;
- nothing fired in the **last six hours** is ever "an earlier service".

Not midnight: a karahi house is at full stretch at 1 AM and a board that
wiped itself at twelve would take food off the pass while it cooked. Not a
plain rolling window either: a docket fired at 1 AM and never bumped must not
be "today's" all of the next day. The six-hour rule is what keeps sehri whole
— a docket fired at 04:50 is ten minutes old when the day turns.

The pass, the owner's dashboard and the floor all read `ServiceDay::began()`,
so the three cannot disagree about what "left over" means.

## What is left over is counted, not hidden

`GET /restaurant/kitchen` answers with `older: {count, oldest_fired_at}`, and
`?older=1` returns exactly those. The screen says "7 tickets are left from
before today's service — Show them · Clear all 7".

## Clearing (`POST /restaurant/kitchen/clear`)

| scope | takes | for |
|---|---|---|
| `older` | everything owed from before this service | the morning after |
| `board` (+ optional `station`) | everything on tonight's board | close |

- **`cleared`, never `served`.** Clearing says "this is no longer kitchen
  work"; it does not say the food went out. No stage timestamp is stamped.
  `KitchenTicket::CLEARED`. The tab's lines become `cleared` too, so a waiter
  does not read "In kitchen" for ever.
- **A scope must be said.** No scope is a 422, not "everything".
- **No new authority.** Anyone who may bump a ticket to served may clear —
  it is the same act, counted. One `AuditLog` row (`event: cleared`).
- A cleared or voided docket can no longer be bumped (`KOT_OFF_THE_BOARD`).
  It used to fall through as "not started".
- A counter order closes when it has no ACTIVE docket left — it used to wait
  for "everything served", which a cleared docket never is.

## The floor in one look (`GET /restaurant/floor`)

One payload for the floor screen: tables, each open tab summarised
(`TabSummary`: `to_pay`, `lines`, `unsent`, `cooking`, `ready`, `part_paid`,
`from_earlier`), and the takeaway tabs that have no table to stand for them.
The lines themselves are not sent.

`POST /restaurant/floor/close-older` closes every tab an earlier service left
open, keeping `cancel`'s fences: a tab with a payment on it is never touched
(counted back as `kept`), tonight's tables are never in reach, and it takes
`tables.serve_any` because these are other waiters' tabs. One audit row, with
what the food on them was worth.

## Two figures that were wrong on the dashboard

- "Bills running" counted paid counter orders (open only so their docket
  stays on the pass). Four takeaways waiting on the cook read as four unpaid
  bills on a floor with every table empty.
- "In the kitchen" asked "not yet served" (`served_at is null`). A cleared
  docket has no `served_at` either. It reads the status now, in the window.

## The screens

- **Kitchen**: three lanes (New / Cooking / Ready), each a colour it keeps in
  its header, its count and the button that sends a ticket into it. Stations
  are filtered on the screen, so each tab can say how many it holds. Below
  `lg` the lanes are tabs.
- **Floor**: a tile says what the table needs next — Free, Just seated, Order
  not sent, In kitchen, Food ready, Eating — with the bill, the guests, how
  long, and whose. A summary line adds the room up. Colour used to say whose
  the table was, which a waiter already knows.
- Both keep the icon rail (see `shopos-a-work-screen-keeps-the-rail`).

## Tests

`ThePassIsTonightsTest` (17), `TheFloorInOneLookTest` (12),
`KitchenPage.test.tsx` (10), `floorState.test.ts` (9), `food.chrome.spec`
(all three sizes). 24 backend + 9 panel mutations, all caught — judged by
exit code: one "survivor" was an ERROR my first script read as a pass.
