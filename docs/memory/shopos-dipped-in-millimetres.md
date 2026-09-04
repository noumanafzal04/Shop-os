---
name: shopos-dipped-in-millimetres
description: SHIPPED — tank calibration charts; a dip may be given in mm and is interpolated between neighbours, never extrapolated past the ends
metadata:
  type: project
---

2026-09-04. The forecourt asked for a closing dip **in litres** and a dipstick
does not read in litres. An underground cylinder holds a wildly different volume
per mm at the bottom, middle and crown — so the operator did the lookup by hand
off a paper chart, in the dark, into **the one number the leak detection rests
on**.

`fuel_tank_dip_points` = the station's own certificate, at its own spacing. No
formula, no capacity÷height: the curve belongs to that tank.

`FuelTank::litresAtDip(mm)` — charted depth exact, **between neighbours**
interpolated, **outside the chart returns null and the close is refused**.
Extrapolating would invent a volume for a tank nobody measured that far up.

**The test that matters is not the obvious one:** 750mm reading 14,000 rather
than 15,000 is the only thing distinguishing between-neighbours from
across-the-whole-chart — and the second flattens a cylinder's curve into a
straight line. That mutation failed 5 cases.

`forecourt_dips.closing_dip_mm` is kept beside the derived litres: *"the chart
says 1,180 at 620mm"* is answerable months later, *"the dip was 1,180"* is not.

**Pasted, not keyed** (`dipChartText.ts`) — a chart is 20–2000 rows and the
station already has it. Two of its own tests found real bugs first:
`620\t12,500` read as **twelve litres** (comma is separator AND thousands mark
— strip thousands BEFORE splitting), and `about half full` mid-chart was
swallowed by a too-broad header heuristic (a digit-less line is a header **on
line one only**).

Server checks ONE thing: a deeper reading cannot hold less. Everything else
about the curve belongs to the tank. Chart is **replaced whole**, empty clears.

Borrowed rules: exactly-one-of-mm/litres lives in the ACTION not the request
(see [[shopos-money-in-litres-out]]); loading a chart is `settings.manage`, not
`inventory.manage` — the person dipping at 2am does not redefine what depths
mean.

Related: [[shopos-unit11-status]] · [[shopos-month-of-the-forecourt]] ·
[[shopos-read-vs-manage]]
