---
name: shopos-page-two
description: "FIXED 2026-08-20: 37 endpoints paginate; 9 panel screens could not reach page two AT ALL (owner reviews capped at 10). One shared <Pager> + two guards; the scanner reported a clean number 4 times before it was right"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-20T07:40:13.999Z
---

**2026-08-20.** The QA sweep's one query (a coupon it could not find) was not
about coupons. Thirty-seven endpoints paginate. **Fifteen screens had
hand-written the same fifteen lines of Previous/Next; nine had written
nothing** — and on those, rows past page one were not awkward to reach, they
**could not be reached at all**.

| screen | a page holds |
|---|---|
| Owner reviews | **10** — a shop with 11 could never read its first review |
| Notifications, purchase orders | 15 |
| Stock transfers | 20 |
| Coupons | 30 |
| Fuel deliveries / rates / shifts | 15–25 |
| Customers, suppliers, vehicles, warranty claims | 20–25 (search only) |

**Three had the plumbing built the whole way down and were one argument short at
the top** — `useTransfers()` called with no page, and the fuel hooks already
returning `{ rows, pagination }`.

> **Paging is fifteen lines every screen has to remember, and a screen that
> forgot looks exactly like a screen with no rows to show.**

**Fix:** one `<Pager>` in `components/ui/pager` (24 screens). The 15 copies had
already drifted — `px-5` vs `px-6`, `setPage(page - 1)` vs `setPage((p) => p -
1)`, several counting "items" whatever the rows were. Filters reset to page one
(searching from page 3 of the old results shows an empty table that reads as "no
matches"). `CouponController::index` gained a search — a coupon is found by its
code and by nothing else.

**Two guards, in two places ON PURPOSE:**
- `ui/pager/reach.test.ts` — nobody hand-rolls one, AND the shared one is used
  by ≥20 screens. Without that second assertion the rule is satisfied by an app
  with no paging at all, which is where this started.
- `docs/qa/unreachable-pages.py` — *does every list have one?* needs the set of
  paginating endpoints, which lives in the backend; a copy in the panel would be
  a second answer to one question. Reads both repos, like `dead-endpoints.py`.

**THE SCANNER REPORTED A CLEAN NUMBER FOUR TIMES BEFORE IT WAS RIGHT:**
1. **It believed a type.** `{ page?: number }` in a signature with nothing ever
   passing one. *Page state that never changes is not paging* — the signal is a
   call to the setter.
2. **It lost route prefixes.** Regex over `routes/api.php` dropped every
   `Route::prefix(...)`; stored `transfers` where the URI is
   `inventory/transfers`. 8 routes matched nothing, their screens went
   unchecked, report said "1 of 12" and looked healthy. Use
   `php artisan route:list --json`.
3. **Prefix match instead of exact.** `/products/{id}/branch-prices` counted as
   listing `/products`.
4. **A link is not a fetch.** `to="/admin/tenants"` accused the dashboard of
   failing to page lists it merely links to. Match only `apiGet(`/`apiPost(`…

Plus one about its own UNIT: judging each folder on its own text called the
notification bell broken *after* it was fixed — the bell fetches in
`modules/notifications` and renders in `components/header`. **Two texts for two
questions:** what a folder LISTS from its own source; whether it can REACH from
its source plus ONE hop of importers. Fold importers into the first and
`components/ui` gets credited with listing the tenant directory.

`--prove` blinds the detector and asserts the result LOOKS blind (0 folders
judged, every route unplaced) — never on the verdict, because a scan that reads
nothing reports "0 problems" identically to a clean sweep.

Two smaller finds: three cards were their own horizontal scroller (a pager
inside scrolled sideways away with the table); and `title="Close
{closing?.product_name}"` — **a quoted JSX attribute is a STRING**, so the
merchant saw that text literally.

Related: [[shopos-qa-sweep]], [[shopos-reachability-rule]],
[[shopos-detector-vs-rule]], [[shopos-ui-conventions]], [[shopos-ui-sweep-aug17]]
