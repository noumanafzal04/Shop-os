# Who owes the platform: the commission screen

**2026-10-09 · asked for by the owner**

> "Isk bad Commission screen UI b… filters ko b dekha kro kaise better kr skty."

## What there was

Every shop on the platform on one page, in one grey table, under a single
figure. No pages. A text box and a toggle for filters, neither of them the
filter kit the rest of the console uses.

Underneath, three things were wrong that the look had been hiding:

- **What a shop had been billed and not paid was a count, not money.** The
  list showed commission *not yet billed* as an amount and unpaid invoices as
  "2 unpaid". A shop holding Rs 40,000 of unpaid invoices and nothing new read
  as owing nothing — and, since the list was ordered by the unbilled amount,
  sat at the bottom of a screen somebody opens to chase money.
- **It asked two questions of every shop.** `outstanding()` and an invoice
  count, per shop, over the whole platform: 81 queries for 40 shops.
- **An invoice could be raised for "this month" and nothing else**, sight
  unseen. Last month's orders could only be billed by waiting for the calendar,
  and nobody was told what the invoice would come to until it existed.

## What there is

**Two piles, both as money.** *Not yet billed* — charges on no invoice and not
written off. *Billed, unpaid* — invoices raised and still open. Every row shows
both and their sum (*Owes in all*), and the list is ordered by the sum.

**Four figures above the list, counted by the server** over every shop, never
off the page that is open: Not yet billed · Billed, unpaid · Collected this
month · On a rate of their own. Three are also buttons that narrow the list —
and a figure is taken with every *other* filter applied and not its own, so
pressing one does not change the number on it.

**The filter kit**: search by name, standing (not yet billed / billed, unpaid /
owes nothing), whose rate (own / platform), and the order. All of it in the
address, so "the ones we have billed and not been paid by" can be sent to
somebody, and survives a refresh. Pages of 25.

**Three queries, whatever the platform's size**: the page, the figures, what was
collected. The two piles are joined as grouped totals, which also gives real
columns to sort and filter on.

**An invoice is raised for a period that is chosen**, with the shared date
filter (this month, last month, last 30 days, this quarter, or two dates). The
panel says how many of the shop's unbilled orders fall in it and what the
invoice would come to *before* the button is pressed; orders outside the period
are dimmed in the list; a period with nothing in it cannot be billed.

**Commission being OFF is said at the top of the page**, not inside a settings
card. The platform rate itself moved under the list: it is changed once a year
and the list is read every week.

## Decisions

- **`paid_at` alone is "collected".** Only marking an invoice paid writes it,
  and a paid invoice cannot be withdrawn. A second `status = paid` clause was a
  condition no test could tell from its absence, so it is not there.
- **A demo owes nobody anything** (`Tenant::real()`), like every other platform
  figure.
- **The date a charge "falls on" is the server's** — the UTC date of
  `created_at`, which is what `raiseInvoice` filters by. The panel counts with
  the first ten characters of the instant it is sent, so the count before the
  button is the count on the invoice.
- The response is paginated now: `data` is the rows, `meta.summary` the
  figures. `data.shops` / `data.total_outstanding` are gone; the admin panel
  was the only reader.

## Filters, everywhere else

Looked at, as asked. Every admin list with something to narrow already uses the
kit (tenants, payments, audit, customers, enquiries, riders, staff, demo shops)
— that was the August sweep. Commission was the one that had been written
before it. Announcements, banners, plans and configuration have nothing worth a
filter.

## Tests

`WhoOwesThePlatformTest` (9), `CommissionTest` (18) — backend mutations 24/24.
`e2e/admin-commission.spec.ts` (3) — browser mutations 20/20. The one write it
makes is on a QA shop and is undone.
