# Every console screen says which it is

**2026-10-10 · the admin side, A to Z**

> "Admin side A–Z test krna hr lehaz sy… hr page ko test krna UI sy, or agr issue
> mile to code sy. UI better krna hai hr page ka or UX b — mjhe ye CEO ko present
> krna hai. Admin side attractive honi chahye… tenant edit screen b dekh lena."

Dashboard, demo shops, commission, customers, plans and the console's
Appearance each have a decision of their own. This is what the walk through
every OTHER screen found.

## Nothing was broken, and it still read as unfinished

All fifteen screens load, with no failed request and no console error. What
was wrong was that they opened three different ways:

- eight had **no page heading at all** — their names were `h2`s on pages with
  nothing above them (tenants, payments, banners, announcements, staff, audit,
  create a business; and the dashboard's own title);
- two had a plain `h1`; five had the kit header (icon, colour, subtitle);
- "nothing here" was a grey sentence in some and a dashed box in others.

So: **one heading each, and it is the screen's own name** — `PageHeader`, its
icon the one on the rail, in a colour of its own — and one empty state
(`Empty`, with the page's icon and what to do about it). `admin-console.spec`
holds it: every screen has exactly one `h1`, and it says the screen's title.

The staff page is shared with the shop side, so it takes its header from
whoever mounts it (`header={(add) => …}`) rather than importing the console's
furniture into a shop's screen.

## Three things under the look that were wrong

**Deleted shops were mixed into the tenant list.** The console sent
`with_deleted` on every request, so the list was every shop that had ever
existed — the ones closed down among the ones trading, "All 71" over a platform
the dashboard beside it called 44. A deleted shop is kept so it can be put
back; that makes it something to go and find. The list is the shops there are;
a **Deleted** box asks for the others, and only them (`only_deleted`).

**A shop on no plan was labelled "paid".** "paid" is the server's bucket for
"not behind on anything", which rightly includes a shop never billed. As a word
on a row it is wrong: a demo kept an hour ago, on no plan, read *paid* in green
beside the words *no plan* — the shops most waiting to be acted on, told there
was nothing to do. The row says **not priced yet** (the plan filter's own
words). The bucket is unchanged.

**A shop's page was four screens long with no way to the part that was
wanted**, and its four headline answers were a row in one card, the same card,
the side column and the third card down. It opens now with what kind of shop it
is, where, since when; then **four figures** — plan and price, when it renews,
what it pays with its add-ons, how big it is — and a row of buttons that goes
to each part of the page and stays in sight.

## Decisions

**The shop page was NOT split into tabs.** That was the first idea and the
tidier-looking one. It would have hidden Modules and Usage behind a click that
`journey/11` and three other specs do not make — and a journey stage is lived
once, in order, so it could not be re-run to prove the change. Everything is
still on the one page, in the same order; it gained a top and a way down it.

**"Renews today" is by the calendar.** Counted in hours and rounded up, a
subscription ending at six this evening was "tomorrow", and one that ended at
nine this morning was already "yesterday" at noon. Amber from seven days out:
that is when somebody should be rung.

**Riders' search is in the filter bar** like every other list's; it was a bare
text box beside the "New rider" button.

## Left as it is

- The payment BUCKETS on the tenant list still count a never-billed shop as
  "Paid 37". Only the row's word changed.
- A shop's page is still long. It is navigable, not shorter.
- The rail says "Banners / Ads" and "Configuration"; their pages say "Banners &
  Ads" and "Platform Configuration".

## Tests

`paymentChip.test.ts` (6), `shopAtAGlance.test.ts` (12),
`AdminBillingFiltersTest` (+1), `e2e/admin-tenants.spec.ts` (2),
`e2e/admin-console.spec.ts` (one heading per screen ×15). Mutations 23/23
across backend, unit and browser.
