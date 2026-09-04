# A tank is dipped in millimetres

**2026-09-04.** The last of the three petroleum gaps.

---

## The defect

The forecourt shipped asking for a closing dip **in litres**, and a dipstick
does not read in litres.

An underground cylinder lying on its side holds a wildly different volume per
millimetre at the bottom, in the middle and at the crown — so the only honest
conversion is the station's own calibration chart, the printed table that came
with the tank. Which means the operator was doing that lookup **by hand, off a
paper table, in the dark, at the end of a shift** — and typing the result into
the one number the whole leak detection rests on.

A mis-read line and the shift reports fuel missing that is not. Nobody would
ever know: the figure is plausible, signed off, and never recomputed.

## The chart

`fuel_tank_dip_points` — whatever points the station's own certificate lists,
at whatever spacing it lists them. No formula, no capacity-divided-by-height:
the curve belongs to that tank and was measured by whoever certified it.

`FuelTank::litresAtDip(mm)`:

* a charted depth returns its charted litres exactly;
* between two points it **interpolates straight**, which is what a shop does
  reading between two lines of the printed table;
* outside the chart it returns **null and the close is refused**.

That last one is the decision. Extrapolating past the ends would invent a
volume for a tank nobody has measured that far up — and this figure is what the
leak detection rests on, so a confidently wrong one is worse than a refusal. A
depth the chart does not cover is a mis-read stick or the wrong chart, and both
are worth stopping for.

The test that pins the interpolation is not the obvious one. Reading 750mm as
14,000 rather than 15,000 only distinguishes **between neighbours** from
**across the whole chart** — and the second is exactly how a cylinder's curve
gets flattened into a straight line. Mutating to the whole-chart version failed
five cases.

## What is kept

`forecourt_dips.closing_dip_mm`, beside the litres it became.

The litres stay the figure everything reconciles against, because that is what
the rest of the shift is in. But they are **derived**, and a derived number with
no record of its source cannot be re-checked: *"the chart says 1,180 at 620mm"*
is answerable months later and *"the dip was 1,180"* is not.

Null where the station typed litres directly, which stays allowed — a tank with
no chart still has to be dippable tonight.

## Pasted, not keyed

A chart is twenty to two thousand rows and the station already **has** it: a
certificate, a spreadsheet, a twenty-year-old manufacturer's table. Asking
somebody to key two thousand pairs into a grid is asking them not to load it at
all, and a tank with no chart sends the operator back to the torch.

`dipChartText.ts` parses what a person actually has — tabs out of Excel, commas
out of a CSV, spaces out of a PDF. Two of its own tests found real bugs in it
before anything shipped:

* **`620\t12,500` was read as twelve litres.** The comma is both a separator
  and a thousands mark, and splitting first gets it wrong. Thousands marks are
  now stripped *before* the split.
* **`about half full`, written mid-chart, was silently swallowed.** The header
  heuristic was "letters and punctuation", which is true of that line too. A
  line with no digits is a header **on line one** and a mistake anywhere else.

Every line that could not be read is listed with its line number before saving.
A parser that silently drops what it did not understand produces a chart that
looks complete and is short a hundred rows, and the tank is then measured
against a table with a hole in it.

## What the server checks, and what it refuses to

**A deeper reading cannot hold less.** That is the whole sanity check, and it
catches the mistake that actually happens: two columns pasted the wrong way
round, or a row transcribed out of order.

Everything else about the curve — where it steepens, how it flattens at the
crown — belongs to the tank. A cylinder, a rectangular bowser and a vertical
silo produce completely different shapes and none of them is ours to have an
opinion about.

A chart is **replaced whole, never merged**. Merging would leave a
half-corrected chart looking complete, and the tank would be measured against
two certificates at different depths with nothing saying so. An empty list
therefore clears it, which is how a bad paste is undone.

## Two rules borrowed from earlier today

**Exactly one of mm/litres is settled in the action, not the request** — the
same lesson as the sale line, where `required_without` in `StoreSaleRequest`
broke forty-nine offline sales because `SyncRequest` re-keys that file's rules
under a prefix and does not re-key the sibling paths named inside them.

**Loading a chart needs `settings.manage`, not `inventory.manage`.** The person
dipping a tank at 2am does not get to redefine what its depths mean. A chart is
part of the plant, not part of a day's trading.

## Mutations

```
extrapolate past the chart      → "a depth past the end of the chart is not guessed at" + the close case
interpolate over the whole chart → 5 failures, incl. "the curve is the tank's and not a straight line through it"
accept a falling chart          → "a chart that holds less as it deepens is refused"
```

Backend 2513/2513 (SQLite) · panel tsc 0 · vitest 1487 · eslint 0 errors ·
Playwright 12 passed on the petroleum project.
