# One dashboard, two consoles

**2026-08-26 · panel**

The brief was "trendy and modern, but keep our dashboard design consistent, and
do not break anything". The page structure was left alone on purpose — the shop
console is gated module by module, trade by trade, and rearranging it to make it
look newer is how a pharmacy loses its batch panel. Everything below is the
design layer.

## They were the same component, written twice

The shop console had `SectionCard`. The platform console had `Panel`. Same
shell, same header, same "View All" pill, same dashed empty plate, same pulse —
two files.

Two copies of one design do not stay one design, and these had already
separated:

- padding: `pb-4 pt-5` against `py-4`
- and, more quietly, **the breakpoint that padding stepped at** — one grew at
  `sm`, the other at `md`. Between 640px and 768px the two consoles were
  visibly different products.

Both render `Surface` now. The wrappers survive because their prop shapes differ
in ways their callers depend on (`to`/`toLabel` against `action`), and renaming
across forty call sites is a bigger change than the one being made.

### A trap avoided on the way

The first version took a `group` name as a prop and wrote
`` group/${group} `` and `` group-hover/${group}: ``. **Tailwind scans source
text**; an interpolated class is never generated, so the hover arrow would have
silently stopped moving. One name, written out.

## Labels that could not be read

Six KPI tiles from 1024px gave each about 150px, and every label longer than
"Total tenants" was cut mid-word:

> Active subscriptio… · Revenue this mon… · Online orders tod… · New tenants this …

A figure whose name is missing is not a figure. The same defect ran through the
shop console's `StatTile`: *Expiring s…*, *Parked tic…*, *nothing left t…*.

Fixed in three places, and the fix is the same each time: **stop truncating
things people need to read.** Labels wrap to two lines. Panel subtitles wrap —
"Sign-ups per month, by status today" had been losing the half that carried the
meaning. Plan names wrap: "Karahi House — custom" was printed as
"Karahi House — cus…", which is a different shop as far as the reader is
concerned.

### The line count was guessed twice, and wrong twice

Captions were clamped to two lines. "at or below reorder level" needed three at
1280. Clamped to three — it wanted four. **Every guess at a line count is a
width nobody measured**, so the caption has no clamp at all now: it is short
helper text, letting it run is never worse than cutting it, and the row sizes to
its tallest tile.

## Six across only where six fit

The strip now ramps 2 → 3 → 6 and waits for `2xl` on both consoles. At 1440 with
a sidebar, six tiles is 165px each; the platform's headline figure printed as
**"Rs 133,…"**. Three across in two rows reads better anyway — six tiny tiles in
a row is a wall of numbers, not a summary.

The emphasised tile also lost its size bump. It sits in the same strip as the
others, and at 30px "Rs 133,000" did not fit its 140px even at 1536. Emphasis is
carried by the colour and the tinted ground. **Money is never truncated.**

## How it was checked

Both consoles, seven widths each — 1920, 1536, 1440, 1280, 1024, 820, 390 — with
a sweep that walks every leaf text node and compares `scrollWidth`/`scrollHeight`
against the client box. Fourteen viewports: **nothing clipped, nothing
overflowing sideways, no console errors.**

A screenshot would not have found most of these. "Active subscriptio…" is
legible as a design; it is only wrong if you ask the browser whether the text
fits.


---

## Second pass — the tile itself

The strip is what the eye lands on, and the two consoles had **two tiles**: the
shop's lived inside `KpiRow`, the platform's was `KpiTile`. Same chip, same
delta pill, same gradient shell, same sparkline underlay — and they had drifted
on the value's size and on **the percentage itself**:

| | shop | platform |
|---|---|---|
| `-100.43` | `−100.4%` (typographic minus, rounded) | `-100.43%` (hyphen, raw) |

One number, two answers, on one product. Both render `MetricTile` now, and
`formatDelta` lives with it.

### What changed about the look

The grey gradient wash is gone. `from-white to-gray-50/70` is the shading every
dashboard had in 2019 and it does nothing except make white cards look slightly
dirty. A flat ground with one tinted chip lets the number be the loudest thing
on the tile, which is the entire point of a number tile. The figure is larger
and tighter, the hover is a small lift rather than a border colour, and the
sparkline runs to the card's edges.

### Two things the sweep caught in the new tile

- **`leading-none` clipped every figure.** It sets the line box to exactly the
  font size, and with the `truncate` overflow that cuts the ink. The sweep
  flagged all six platform figures — including "37" — which is how a styling
  choice that looks fine in a screenshot gets found.
- **An empty week drew a solid slab.** The sparkline filled the area under an
  all-zero series, so a shop that has not sold yet carried a block of colour
  across three tiles that reads as volume. A week of nothing has no shape: the
  figure already says zero, and the fill was adding a claim that was not true.

### And a skeleton that had stopped matching

`KpiRowSkeleton` repeated the tile's padding and sparkline allowance inline. The
new tile is 4px taller, so the strip would have resized the instant the payload
landed — the exact bug the copy was written to prevent. It renders the tile's
own skeleton now.


---

## Third pass — the part you can see

Fair feedback on the first two: *"mujhe to dashboard mein koi changes nahi
nazar aayi."* Both passes were real and neither was visible. Consolidating two
copies into one component changes nothing on screen by design, and an unclipped
label only looks different if you knew it was clipped. The brief was a look, and
a look had not been delivered.

### The masthead

Both consoles opened with a white card on a white page — the same white as the
twenty cards under it, so the page had no top and the first KPI tile became the
masthead by accident.

It is a brand band now, and the borrow is deliberate: the product's own landing
page opens with a dark room and one lit counter, and a shopkeeper who signs in
should land somewhere that looks like the place they were just sold. Same
gradient family, same faint grid, same soft lights.

**One colour, once per screen.** Everything below stays white — that is the
whole reason it works. A coloured band is a masthead; a coloured page is a
novelty.

`DashboardHero` is shared, so the platform console's chips ("Active 37",
"Suspended 0") and the shop's branch pill ride the same band, and the
admin page's private `HeaderChip` went with it.

### The panels

`rounded-3xl` to match the masthead, and **a hairline under every panel
header**. The card had been one undivided plate, so a title and its contents ran
together and every panel read as a soft rectangle of grey text. The rule is what
turns it into a header and a body — and it costs one border.

The tiles and skeletons took the same corner, because a page with two radii on
it reads as two designs.


## Fourth pass — three across, the cards that had been left out, and the charts

**Three per row, and no more.** Five and six across put a money figure in 150px
of tile; even where it fitted, six tiny tiles in a row is a wall of numbers
rather than a summary. Both strips now ramp 1 → 2 → 3 and stop.

**A gap under three labels, and it was mine.** `MetricTile` reserved the
sparkline's room from the presence of the `spark` prop, while `Sparkline` had
just learned to draw nothing for a week of zeros. So the tile kept a strip of
padding for a drawing that had decided not to appear. Both ask `hasShape()`
now — one predicate, two callers.

**The cards that had been left out.** `SalesTrendChart`, `ExpenseDonut` and
`RecentTables` each built their own `<section>` shell rather than using
`Surface`, so the new corner and the new header rule stopped at them and they
read as an older generation of card on the same page. Same corner now.

**The charts.** A rounder, slightly heavier stroke with `lineCap: round`; the
hover marker gets a ring in the card's own ground so a hovered point reads as a
point; the grid dash tightened so it stops competing with the line it is behind.

And one real defect: the last point sits at the plot's right edge, so with a 3px
round cap the stroke ran into the card's border and the line looked like it
carried on past the panel. `grid.padding.right` now leaves room for the cap and
the fill to finish inside.
