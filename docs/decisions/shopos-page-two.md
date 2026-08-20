# Rows on page two

**2026-08-20** · `components/ui/pager`, `docs/qa/unreachable-pages.py`, `CouponController`

## Where it started

The QA sweep reported one query: phase M *could not make a coupon it had made
thirty-two runs earlier*. The sweep's own bug — it read the first page of a list
that paginates at thirty with no search, while a check beside it created a fresh
code every run and nothing deleted them.

Fixing the sweep took ten minutes. The interesting part was the sentence
underneath it: **`/coupons` paginates at thirty and the panel's coupon screen
requests no page and offers no search.** Not awkward to browse — *unreachable*.
A shop that has run a season of campaigns cannot expire, correct or delete any
code past the thirtieth.

So the question became: how many others?

## The count

Thirty-seven endpoints paginate. Fifteen screens had hand-written the same
fifteen lines of Previous/Next. **Nine had written nothing.**

| screen | a page holds | how you reached row 31 |
|---|---|---|
| Owner reviews | **10** | you didn't |
| Notifications | 15 | you didn't |
| Purchase orders | 15 | you didn't |
| Coupons | 30 | you didn't |
| Stock transfers | 20 | you didn't — *and the hook took a page, and the service took a page, and the screen called `useTransfers()` with nothing* |
| Fuel deliveries / rates / shifts | 15–25 | you didn't — *and the hooks already returned `{ rows, pagination }`* |
| Customers, suppliers, vehicles, warranty claims | 20–25 | only by knowing the name to search |

Ten reviews a page means a shop with eleven can never read the first review it
ever got, or reply to it.

Three of these had the plumbing built the whole way down and were one argument
short at the top. That is the argument for a component rather than a snippet:
paging is not hard, it is fifteen lines every screen has to remember, and **a
screen that forgot looks exactly like a screen with no rows to show.**

## What changed

**One `<Pager>`**, in `components/ui/pager`, the same shape as the one confirm
dialog. Twenty-four screens use it. The fifteen copies are gone — and they had
already drifted: `px-5` against `px-6`, `setPage(page - 1)` against
`setPage((p) => p - 1)`, and several counting "items" whatever the rows were.
The count line now names them, because the shop is looking at suppliers.

**Nine screens can turn the page** that could not. Where a filter exists it
resets to page one, because searching from page three of the old results shows
an empty table that reads as "no matches".

**Coupons can be searched by code** — `CouponController::index` had no filter of
any kind. A coupon is found by its code and by nothing else: a merchant asked
"is EID20 still live?" is holding a string, not a date.

**Two structural fixes fell out.** Three cards were their own horizontal
scroller, so a pager placed inside them scrolled sideways out of view with the
table; they now hold a scroller and the pager as siblings. And
`WarrantyLookupPage` had `title="Close {closing?.product_name}"` — a quoted JSX
attribute is a *string*, so the merchant was being shown the literal text
`Close {closing?.product_name}`.

## Two guards, in two places, on purpose

**`ui/pager/reach.test.ts`** keeps the panel's half true: nobody writes their own
Previous/Next, and the shared one is in use on at least twenty screens. That
second assertion matters — without it "nobody writes their own" is satisfied by
an app with no paging at all, which is the state this started from.

**`docs/qa/unreachable-pages.py`** answers the question the panel cannot: *does
every list have one?* That needs the set of paginating endpoints, which lives in
the backend, and a copy of it inside the panel would be a second answer to one
question — the exact fault the whole exercise exists to catch. So it reads both
repositories, like `dead-endpoints.py` next door.

## What the scanner got wrong first, four times

Worth recording, because every one of them reported a clean number.

**It believed a type.** The first pass called a screen safe if the module
mentioned `page` anywhere. `couponsService.list` is typed `(params?: { page?:
number })` and nothing ever passed one. **Page state that never changes is not
paging**; the load-bearing signal is a call to the setter.

**It lost the prefixes.** Reading `routes/api.php` by regex dropped every
`Route::prefix(...)`, so it stored `transfers` where the URI is
`inventory/transfers`. Eight routes matched nothing, the modules that list them
were never checked, and the report said "1 of 12" and looked healthy. Laravel
already knows the answer — `php artisan route:list --json`.

**It matched prefixes instead of paths.** `/products/{id}/branch-prices` counted
as listing `/products`, so the branches screen was accused of failing to page a
list it never shows.

**It could not tell a link from a fetch.** `to="/admin/tenants"` is navigation.
Matching any string starting with a slash accused the admin dashboard of failing
to page three lists it merely links to.

And one about its own shape: judging each folder on its own text reported the
notification bell as broken *after it was fixed*, because the bell fetches in
`modules/notifications` and renders in `components/header`. The fix is two
different texts for two different questions — **what a folder LISTS comes from
its own source; whether it can REACH comes from its source plus one hop of
importers.** Fold importers into the first and `components/ui` gets credited
with listing the tenant directory, because every admin page imports a Button
from it.

`--prove` blinds the detector and requires the result to *look* blind: zero
folders judged and every route unplaced. A scan that reads nothing reports "0
problems", which is character for character what a clean sweep reports. **The
denominator is the only thing that tells them apart, so the proof asserts on the
denominator and never on the verdict.**

## What is deliberately still open

Two paginating routes are named by no panel screen —
`marketplace/shops/{slug}/products` and `marketplace/shops/{slug}/reviews`. Both
are the public storefront, consumed by the customer app rather than the panel.
The scanner prints them rather than filtering them out: a route nothing lists is
either a screen nobody built or a path the scan failed to recognise, and from
inside the scan those look identical.
