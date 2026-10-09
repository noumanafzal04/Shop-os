# A dashboard is asked about a period

**2026-10-09 · asked for by the owner**

> "Dashboard screen main humne date ka input use krna — today mtlb today
> dashboard main jo cheezain hui, yesterday, last week, month, last month,
> quarterly, jo b achy option bny, ya custom range. Ye admin or tenant dono
> side py chahye. Already humne aisa filter bnaya huwa hai kahin. Lkn UI acha
> hona chahye, achi jgah handle hona chahye, bura na lgy. Default today —
> mtlb current — or current week."

## What there was

Both dashboards answered one question each and could not be asked another.

- **The shop's** said *today*, with a week of bars behind it and a month of
  spending and leaders under that. Three windows on one page, none of them
  chosen by the reader. Somebody who wanted yesterday opened the reports.
- **The platform's** put "revenue this month" beside "orders today" beside
  "riders a month ago" — three windows on one ROW.
- The trend chart had a toggle of its own (Today / 3 Days / Week) that moved
  the chart and nothing else on the page.

## The rule

**A dashboard is asked about a period: two dates, both inclusive.**

Everything on it that is a **flow** — what was sold, spent, refunded, earned,
who came, who led, what was dispensed, what each branch took — is cut to
exactly those dates. Everything that is a **state** — what is low, what is
owed, what is on the pass, how many shops there are — is the state *now*,
whatever period is being read. Each panel says which it is in its own name.

`App\Support\DashboardPeriod` owns the arithmetic for both consoles, so they
cannot work it out differently.

### What a period is compared with — like for like

Not merely "the days before".

| The period | Is set against |
|---|---|
| one day | the day before |
| a month so far (1–9 Oct) | the same days of the month before (1–9 Sep) |
| a whole month | the whole month before, whatever its length |
| a quarter / a year, whole or so far | the same part of the one before |
| any other run of days | the same number of days immediately before |

Why the month rule: in a country paid on the first, the nine days before the
1st are the poorest of any month. Set against them, every month would open as
a triumph. The screen says what the comparison is ("compared with 1 – 9 Sep"),
because it is not something a reader would assume.

### What the chart draws

The period, a point a day — up to 31 days. Then a point a week (to 120 days),
then a point a month. A week is seven days counted from the period's own first
day, so only the last point can be short. **One day is not a trend**, so one
day is drawn as the last of the seven that led to it, and the card says so.

### How long

Three years at most (422, in words). Past that it is a report.

## The decisions that were not obvious

**`today` and `period` are two keys.** A key called `today` carrying last month
would be a lie in its own name, and the screen needs both: the line at its
head ("14 sales so far today") is about now, whatever is being read below it.
When the period does not reach today, today is asked for separately — two days
of rollups, not a second dashboard.

**Asked nothing, the shop's payload is byte-for-byte the view it has always
been** — today, the week behind it, the month's spending and leaders — plus the
`period` block. That is what the phone app (`partner/`) reads, and it never
sends a date. The panel always sends two, and so always gets the strict cut.

**Customers are asked again for a run of days.** Somebody who came on Monday
and on Thursday is one customer of the week. Adding the days up says two.

**The points of the chart ARE the tile.** Both are `summed()` over the same
six day-by-day rollups, so a period's points add up to its figure to the rupee.

**The platform's period is cut on the server's calendar** (UTC), as every
platform figure and the billing ledger's date filter already are. The console
is told what "today" is by the payload and resolves its presets against that.

**A period still running is set against the same PART of the one before** on
the platform — up to this hour of its last day. Against the whole of it, every
morning reads as a decline. (The shop side compares today-so-far with the
whole of yesterday, as it always has.)

**What a period opens on, and why the address does not carry it.**

| Console | Opens on |
|---|---|
| a shop that sells | today |
| a business that keeps books and sells nothing | this month |
| the platform | the last seven days |

The opening period is the *absence* of `?from&to`. A dashboard is left open on
a counter for days; a date pinned on Friday is Friday for ever. Choosing the
opening period again from the menu un-pins. Any other period is in the
address, so a refresh, a link and the back button land on the same figures.

**A books-only business opens on the month.** Its strip used to be a day, a
month and a week side by side, because it has little to show for any one day.
It is now Money In · Money Out · Net (· Biggest Category), all for the period.

**The platform has two rows now.** *In the period*: revenue collected, new
tenants (and how many were kept from a demo), online orders (and what they
came to), new customers. *Right now*: total tenants, active subscriptions,
active riders. The money is withheld from staff without `billing.view` exactly
as it is everywhere else — the keys are absent, not zero.

## Where the control sits

Directly above the figures it governs, as their heading (`PeriodBar`). Not in
the band at the top — that band says what is true now. The left half is what
the figures on screen ARE, read from the payload; the right half is the one
date filter the platform has, with two arrows that step a period at a time
(a month by a month, a week by seven days) and stop at today. While a newly
asked period is on its way the last one stays, dimmed, and still says which
period it is.

## Not done

- A single day is not drawn hour by hour. Seven days of context is what the
  chart shows; "today by the hour" needs its own rollup.
- The platform's trend charts (12 months of revenue, 6 of sign-ups) are the
  long view and do not follow the period. They say what they are.
- The other admin date filters (billing, audit) still resolve "Today" on the
  laptop's calendar while the server cuts on UTC — a different date for the
  first five hours of a Pakistani day. Only the dashboard was given the
  server's `today`.
- The shop header runs 24px past a 320px screen. Seen while checking the bar
  on a phone; it is the header's, and older than this.

## Tests

`DashboardPeriodTest` (34 — the arithmetic), `ADashboardIsAskedAboutAPeriodTest`
(9 — a shop), `ThePlatformIsAskedAboutAPeriodTest` (5). Panel: `period.test.ts`,
`dateRanges.test.ts` (stepping), `KpiRow.test.tsx` (every fixture's `today`
disagrees with its `period`), `sparkShape.test.ts`. Through the screen:
`e2e/dashboard-period.spec.ts`, `e2e/admin-dashboard-period.spec.ts`.
