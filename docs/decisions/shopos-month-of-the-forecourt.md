# A month of the forecourt

**2026-09-04.** The second petroleum gap, after "money in, litres out".

---

## The gap

Every figure a station reconciles by was already being written — at close,
once, never recomputed: metered litres, till litres, unbilled litres and value,
tank variance litres and value, test litres, and whether a rate moved mid-shift.

All of it could only be read **one shift at a time**.

So a manager could see that Tuesday was forty litres short, and could not see
that it had been forty litres short every Tuesday for a month — which is the
only form in which that fact is worth acting on. Verified before building:
`reportTabs.ts` had no fuel entry and there was no `/reports/fuel` route.

## What it reports, and what it refuses to

`FuelReportService` reads the shift columns and adds them up. It does **not**
re-derive anything.

That is the point of those columns being written once. A reconciliation
somebody signed off in March must read the same in April even though the rate
has moved fifty times since; re-deriving would quietly edit history every time
a price changed. There is a test that raises the price to Rs 400 and asserts
the month's value did not move.

**The two variances stay apart, and there is no field to add them into.**

| | what it means | who it is about |
|---|---|---|
| `unbilled_*` | metered litres − till litres | fuel that left the **pump** unbilled — a person |
| `tank_variance_*` | book stock − closing dip | fuel that left the **ground** without crossing a meter — a leak |

The test asserts `total_variance_litres` and `variance_litres` are **absent**.
One number covering both destroys the distinction the owner is trying to make,
and that distinction is the whole difference between a conversation and an
engineer.

**By attendant is litres only.** A till sale does not record which nozzle it
came out of, so meters-minus-till is a station figure. A per-attendant
shortfall column would be an accusation nobody could defend — the same
invariant `ForecourtShift::attendantTotals()` already carries, now enforced one
layer further out. The tab says so in words on the panel, because the absence
is the feature.

**An open shift is counted, not omitted.** A shift with no closing meter and no
dip would contribute zeros, and a zero reads as "nothing happened" rather than
"not counted yet". `shifts_open` sits beside `shifts`, and the empty state says
which of the two it is.

**A repriced shift is named.** `shifts_repriced` counts the shifts a rate
changed part-way through: the litres are exact and the rupees are an
approximation, and a reader comparing two months has to know which is which.

## The permission, and the mistake not made

`reports.view`, **not** `inventory.manage`.

The shift screens carry `inventory.manage` because closing a shift ends by
setting fuel stock to the dip — a stock correction, which needs the right to
make one. **Reading how the forecourt performed is a report.** Gating the read
on the write is this codebase's recorded `*.manage` bug class, and it would
have handed the owner's own manager a screen they may run and never look back
at.

A test signs in as each: the analyst (`reports.view`, no write rights) gets
200; the forecourt manager (`inventory.manage`) gets 403.

## The guard that caught me adding a tab

Adding `{ key: "fuel", … }` to `REPORT_TABS` turned `offeredIsReachable`
**red before I had done anything wrong**:

```
✘ report tab "fuel" is neither sales-shaped nor mapped to the screen it is about
```

That check exists so a new tab cannot be silently exempt from the module rule.
Mapping it to `/tenant/fuel` satisfied it; mutating the gate to `needs: ["pos"]`
then produced the failure it was written for:

```
✘ report tab "fuel" offered to ["pos"], which cannot open /tenant/fuel
```

## Mutations

```
date filter removed        → "a shift outside the range is not in it"
shifts_open hard-coded 0   → "it counts the shift still open rather than leaving it out in silence"
gated on inventory.manage  → 10 of 11 fail, incl. the permission case itself
tab gate → needs: ["pos"]  → "offered to ["pos"], which cannot open /tenant/fuel"
```

Backend 2496/2496 (SQLite) · panel tsc 0 · vitest 1478 · Playwright 12 passed
on the petroleum project.
