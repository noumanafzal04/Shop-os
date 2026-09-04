---
name: shopos-month-of-the-forecourt
description: SHIPPED — the Fuel report tab; the two variances are never summed, attendants get litres only, and the read is reports.view not inventory.manage
metadata:
  type: project
---

2026-09-04. Every forecourt figure was already written at close and could only
be read ONE SHIFT AT A TIME — so a manager could see Tuesday was short and not
that every Tuesday was. `/reports/fuel` + a Fuel tab (`needs: ["fuel"]`).

**It adds up what was RECORDED; it never re-derives.** That is why the shift
columns are written once: a reconciliation signed off in March must read the
same in April though the rate moved fifty times. Test raises the price to 400
and asserts the month's value did not move.

**The two variances stay apart, and there is no field to sum them into** —
`unbilled_*` is fuel that left the PUMP unbilled (a person), `tank_variance_*`
is fuel that left the GROUND without crossing a meter (a leak). The test
asserts `total_variance_litres` is ABSENT. One number covering both is the
difference between a conversation and an engineer.

**By attendant = litres only.** A till sale records no nozzle, so
meters-minus-till is a STATION figure; a per-attendant shortfall would be an
accusation nobody could defend. Same invariant as
`ForecourtShift::attendantTotals()`, one layer further out.

**Open shifts are COUNTED, not omitted** (`shifts_open`) — a zero reads as "no
trade", not "not counted yet". A shift whose rate moved mid-way is named
(`shifts_repriced`): litres exact, rupees approximate.

**Permission = `reports.view`, NOT `inventory.manage`.** The shift screens carry
the write permission because closing a shift sets stock to the dip. Reading how
the forecourt performed is a report — see [[shopos-read-vs-manage]].

**`offeredIsReachable` caught me before I did anything wrong:** a new REPORT_TAB
must be mapped to the screen it is about or classified sales-shaped. It went red
on the addition itself.

Related: [[shopos-unit11-status]] · [[shopos-money-in-litres-out]] ·
[[shopos-offered-must-be-reachable]] · [[shopos-guards-share-a-blind-spot]]
