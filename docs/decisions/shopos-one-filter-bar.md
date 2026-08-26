# One filter bar, and the filters nobody could reach

**2026-08-26.** Prompted by three sentences from the user: the tenant listing
needed polish and a flag for owners who kept their shop, the shop-request queue
needed a badge saying how many are waiting, the billing page was "very basic" —
and then, mid-session, "the whole site's filters don't look good to me".

That last one was right, and it was the smaller half.

---

## The visible half

Every list drew its own filters. A bare grid of inputs on one screen, square
chips on another, three heights of select, and two naked `<input type="date">`
boxes wherever a range was wanted.

None of them had the part that matters: **what is applied is visible, always.**
You could set four filters, scroll past the controls, and have no way to see
what was in force. An empty table then reads as "there is nothing here" rather
than "you filtered it all away" — which is the most common way a working screen
gets reported as broken.

`src/components/ui/filters/` is the one treatment:

| Piece | What it is for |
|---|---|
| `FilterBar` | Search, the controls, and a row that says what is applied (a removable pill per filter), one Clear all, and the result count |
| `DateRangeFilter` | Named ranges **with the dates they resolve to**, and a two-month custom dialog |
| `FilterChips` | Mutually exclusive buckets carrying counts |
| `FilterSelect` | A short list — a native `<select>`, deliberately |
| `FilterPopover` / `FilterOption` | The popper, once: click-away, Escape, focus returned to the trigger |
| `dateRanges.ts` | The arithmetic, pure and tested |

### Why the date control is shaped the way it is

The reference the user sent was a menu of named ranges with the resolved dates
right-aligned beside each, a tick on the one in force, and `Custom range…`
opening a two-month picker. Every part of that earns its place:

- **The name AND the dates.** "Last 30 days" is how somebody thinks;
  "28 Jul – 26 Aug" is what they opened the menu to check. Showing only the
  name asks to be trusted. Showing only the dates makes them do the arithmetic
  they opened the menu to avoid.
- **`matchPreset` is not optional.** The URL carries two dates and no name, so
  a screen restored from a link, a bookmark or the back button would tick
  nothing in its own menu over a filtered list.
- **Custom is a modal.** Two months have to be on screen at once — a range
  crossing a month boundary is most of why anybody reaches for custom — and it
  needs a Cancel, because a half-picked range must be abandonable without the
  list underneath having already moved.
- **Nothing applies until Apply.** A picker that filtered as you clicked would
  refilter twice per range, and the first of those two is always wrong.
- **Local dates, never `toISOString()`.** It converts to UTC first, so in
  Karachi (UTC+5) midnight on the 1st becomes the last day of the month before.
  Every range would start a day early, for exactly the users this is built for.

### Why `FilterSelect` is a native `<select>`

The popper next door is right when options carry a second fact — a resolved
date, a count. For "which plan", a native select already works with a keyboard,
opens as a proper wheel on a phone, and cannot be got wrong. Reaching for a
custom menu everywhere is how a toolbar ends up worse on the device most of
these shops are actually held in.

---

## The larger half: filters that existed and could never be reached

| Endpoint | Accepted since it was written | The screen sent |
|---|---|---|
| `admin/tenants` | `status`, `city_id`, `plan_id`, `online_only` | search, payment bucket |
| `admin/billing/payments` | `tenant_id`, `from`, `to` | nothing |
| `sales` | `channel`, `from`, `to` | search, status |
| `admin/audit-logs` | `tenant_id`, `event`, `type` | event, type |

The sales one is the worst shape. Its Help Centre article has promised
filtering "by date, payment method or who rang it" since the day it was
written, over a server that had only the date. **A help page describing a
control that is not there does not read as a missing feature. It reads as a
control the shopkeeper failed to find.**

So `payment_method` and `served_by` are real now; the "who rang it" filter
appears only where `pos_ask_who_served` is on, because a control offering no
options is not a smaller feature, it is a feature that looks broken.

And the sales list and its CSV export now share **one** filter method. They
were two copies of the same seven-line chain under an export docblock promising
they matched — which is how that promise gets broken by whoever adds the eighth
filter to only one of them, and it would be the export, because that is the
copy nobody looks at.

---

## Which door a shop came in through

`tenants.converted_at`, written by `ApproveShopRequestAction` at the moment the
decision is made. `Tenant::origin()` reads three states off the row:

- `demo` — somebody is trying it now
- `converted` — they tried it, pressed **Keep this shop**, and were approved
- `direct` — an admin opened it by hand

**A column, not a join.** The fact was already recorded — an approved
`shop_requests` row names the tenant — but that is the wrong shape for a list
that filters *and sorts* by it: a `whereExists` per page gets slower as the
platform succeeds. It is also a fact about the shop's life rather than the
request's, so a request cleaned away later must not take the answer with it.
The migration backfills, because shipping a feature that says nobody has ever
kept a shop is a more convincing lie than an empty column.

**Every axis is counted with the others applied but not its own** — the same
rule the marketplace facets follow. A count taken with its own filter applied
always equals the rows on screen, which is a number that agrees with the screen
no matter what and therefore tells nobody anything.

---

## How many people are waiting

`GET /admin/inbox` → pending shop requests, new enquiries. Badged on the rail.

Both queues sort oldest-first *because* a slow reply costs the customer nothing
— nothing prunes a demo whose owner is waiting. Which means the only thing that
ever got them answered was somebody choosing to open the screen, and nothing on
any other screen suggested they should.

**A count that is withheld is absent, never zero.** Platform staff hold explicit
permission lists. A zero for somebody who may not read the queue draws no badge
— indistinguishable from the truth, right up until they are asked why they
never replied.

---

## Billing learns to say how much

Seven numbers and an unfilterable table; four of the numbers were headcounts.
Nobody chasing subscriptions is chasing heads. "Eleven shops are overdue" and
"eleven shops are overdue for 143,000" are different mornings.

- **`outstanding`** — late money at each shop's *own plan price*. The test
  fails if the two plans it uses are ever priced the same, so it cannot pass by
  accident. Shops with **no plan** are counted apart rather than folded in as
  zeroes: they are every converted demo waiting to be priced, and that count is
  how you find them.
- **`chase`** — who to ring today, in grace before overdue. A shop inside grace
  is one phone call from paying and one week from being switched off; a shop
  months past that is a different conversation.
- **`revenue_series`** — the same twelve months the dashboard draws, from the
  same method made public. Two copies of "revenue per month" is how two screens
  disagree about what the platform earned.
- The ledger's totals answer **how much**, over the whole filter, not the page.

---

## Three defects found on the way, two of them pre-existing

### The app shell widened the page

`AppLayout`'s content column was a plain `flex-1`. A flex child's default
`min-width: auto` will not shrink below its own content, so **one table wider
than the window pushed the entire shell — header included — past the right
edge.** The page scrolled sideways with no scrollbar to say so, and the last
column of the table simply was not there.

It only ever appeared at `xl` and up, because below that the same markup is a
block and behaves. **The widest screens were the broken ones**, which is the
opposite of where anybody looks for a layout bug. Found by a browser; jsdom has
no layout engine and could never have seen it. Fixed with `min-w-0` and guarded
by `src/layout/shellDoesNotWiden.test.ts`.

### Two buttons, one name

The custom-range dialog draws two months, so "10" is 10 August *and* 10
September: two controls with one accessible name. Sighted users read the column
and the month heading; nobody else has either. Found by the component test
failing with "found multiple elements" — the test finding a real bug while
looking for a locator.

### The pager did nothing

Mine, and reported by the user within the hour of writing it.

The tenant list routed `<Pager onPage>` into the same function its filters used
— one that resets to page one on every change, correctly — so Next **set** the
page and **dropped** it in the same call. Nothing threw, nothing logged, the
URL was rewritten to what it already was and the list redrew itself
identically.

The marketplace's `patch`, written weeks earlier, carried the one line mine was
missing: `if (!("page" in next)) merged.delete("page")`.

> Two implementations of one rule, and the newer one lacking the fix the older
> one already carried. This is the shape this codebase keeps meeting.

There is one implementation now — `nextParams` / `useUrlFilters` — tested
without a router, used by all three URL-backed screens, and
`src/components/ui/pager/reach.test.ts` gained an axis that fails if a fourth
screen writes its own. That axis found a third copy on its first run.

---

## Rules worth keeping

1. **A filter you cannot see is a filter you cannot trust the numbers under.**
   Applied filters are named, removable one at a time, and beside a result
   count.
2. **A named range shows the dates it resolves to.** Otherwise the control is
   asking to be trusted about the one thing the reader opened it to check.
3. **Every facet count is taken with the other filters applied and not its
   own.** A count that includes its own filter always equals the screen.
4. **A count that is withheld is absent, never zero.**
5. **Never `toISOString()` for a calendar date.** It is a timezone shift
   wearing a date's clothes.
6. **One rule, one implementation.** Two copies drift, and the newer copy is
   the one missing the fix.
