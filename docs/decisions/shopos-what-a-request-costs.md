# What a request costs

**2026-10-12.** The owner's question while testing by hand: *"app slow to ni,
queries optimize hain hmari, request time main issue to ni aye ga?"* Measured
on a shop of 6,000 products and 18,000 shelf rows (`loadtest-grocery`), on a
laptop with the database beside it. Built and tested; **not pushed** until
they say.

## The short answer

Not slow. Most screens ask the server for 7–190 ms of work, and a walk of all
49 of a restaurant's screens found no request slower than 365 ms on a busy
laptop. Six things were worth changing, and a few more are written down for
later.

| What | Before | After |
|---|---|---|
| Queries behind EVERY request | 13 for a list of suppliers | 7 |
| Stock value report | 569 ms | ~330 ms (measured on a busy machine — measure again on a quiet one) |
| Dead stock report | 600 ms | ~390 ms (same caveat) |
| Budgets on the dashboard and the budgets page | one query a category | one query |
| Opening any screen of the panel | 2 device posts + 2–3 catalogue requests | 1 + 1 |

## 1. The rate limiter was six queries a request

Every API request is counted (240 a minute a person, 600 at a till). The app's
cache is the **database**, and the limiter counts wherever the cache is — so
each request read the `cache` table four times, locked a row and wrote it.
Thirteen queries for a list of suppliers, two of them about suppliers.

`config/cache.php` now names the limiter's store: **where the cache is the
database, the limiter counts in files.** On one server that is a lock on a
local file and asks MySQL nothing. `CACHE_LIMITER=redis` chooses another store
— the right answer the day the app runs on two servers, since a file is
counted per machine. Nothing else the app caches moved.

No `.env` change is needed on the live box: the rule reads `CACHE_STORE`.

## 2. A report that read every shop's products

The stock value and dead stock reports sum the shelf and name each row. The
query joined every shelf row to its product, size and category and THEN
grouped — by eleven columns, nine of them text. And it never said
`products.tenant_id`, so the database started from the product table of
**every shop on the platform** (30,081 rows here) to find this one's 6,000:
a report that slows down as other shops sign up.

The shelf is summed on its own two ids first, the names are joined to the
answer, and the products are fenced to the shop. Same rows, same figures
(`StockReportsTest` and the reorder tests: 50, unchanged).

## 3. One question a category

`BudgetStanding::forMonth` asked for each expense category's ceiling inside a
loop: eight categories, eight queries, on the dashboard and on the budgets
page. `ExpenseBudget::inForceForMany` asks once.

**And reading them together showed half a rule.** "Standing at a branch: its
own ceiling, falling back to the company-wide one" was a comment. The code took
whichever row the database returned first, so a branch that set its own rent
ceiling *after* the company set one was still held to the company's — and in
the other order it worked, which is why nobody saw it. A branch's own row now
beats the company's, for the month's figure and for the standing one.

## 4. Three catalogue requests to open the Coupons page

Found by the walk of every screen (`e2e/journey/43-…`), which writes down what
each screen asks: all 49 screens asked for the till's catalogue two or three
times on one load, and eighteen of them announced the device twice.

Two hooks each started a sync when the panel opened. `useKeepInSync` has a
trigger called "reconnected", and it also fired on mount — a till that opens
with a line is not reconnecting. So it raced the boot on every page: a pull
that began before the device had announced itself, the boot's own pull straight
after it, and a "still here" posted to a server that had been told so a tenth
of a second before (the boot's `markTouched()` exists to prevent exactly that,
and lost the race).

"Reconnected" now means a line that came back. One device post and one
catalogue request a load.

## 5. Forty-eight errors on a till that was only being looked at

The drawer's X-read watches the shift query without fetching it — an observer
with `enabled: false` and **no query function**. Whenever its options were the
last registered, the shift query itself had no function, and every refetch of
it logged "No queryFn was passed": 48 times as the till opened. Development
builds only, and nothing was asked of the server — but it buried the console
for anybody looking for a real error, and it is how the walk's first run
stopped. Both hooks now share one named function.

## 6. Written down, not changed

- **The dashboard: 52 queries, ~230 ms.** After 1 and 3 it is about 38. What
  is left is real work: best sellers and revenue by category (~45 ms each, a
  join of sale lines to sales over the period), cost of goods by day (~30 ms),
  and three counts over the product table (~80 ms together) that could be one.
- **A whole reload asks six things before the screen asks its own**
  (measured 2026-10-13 from a browser trace of the journey's menu walk):
  `/auth/me`, `/shop/settings`, `POST /pos/devices` (this device says it is
  here), `GET /pos-devices`, `/pos/catalog` (what changed) and
  `/notifications`. For one evening there was a seventh — `/orders/waiting`,
  for the menu's count — and it is why this was measured: the walk of 35
  screens was refused by the limit (301 requests in the 56 seconds before the
  first 429, 32 of them the new ask). The count is kept on the device now and
  asks nothing on a load (`shopos-an-order-reaches-the-kitchen.md`). Without
  it the walk is still 269 in under a minute — over the 240 a person is
  allowed — so it had been passing on where the limiter's minute happened to
  turn, and on a machine slowed by other work: likely, not measured. It makes
  room every eighth screen (`roomForACase`).
  Nobody reloads like a test does, and inside the app the menu stays mounted,
  so a person pays these once. Worth doing next, the same way — kept on the
  device, asked on news: the two device asks and the catalogue pull on
  screens that are not a till, and the shop's settings.
- **Three queries of housekeeping on every request**: the default branch, the
  user's open shift, its till. Cheap (about 1 ms together); a request that
  touches no till still asks.
- **The till's catalogue: 270 ms for a page of 1,000 products** with their
  packs, codes and sizes. It is the sync feed and is asked rarely.
- A covering index on `branch_stock (tenant_id, product_id, variant_id,
  quantity)` would let the shelf sum run off the index alone. It needs a
  migration; worth doing after measuring on the server.
- `Model::preventLazyLoading()` is not switched on in tests. It would find the
  next N+1 before a count does.

## How it was measured

`php artisan loadtest:timings` for the table of screens, and a scratch script
that runs one GET in-process and prints every query with its time — as the
owner, with no token minted, so nothing is written. Each endpoint twice: the
second answer is the one written down.

## Tested

- `TheLimiterAsksTheDatabaseNothingTest` (3): the config rule in each
  environment; a counted request runs no query on the `cache` table; and the
  limiter still refuses the sixth sign-in. Mutations: counted in the database
  again → caught; the rule never choosing files → caught.
- `useKeepInSync.test.tsx` (+2): opening with a line does not pull; one
  reconnection pulls once. Mutation: pulling whenever connected → caught.
- `ABranchKeepsItsOwnCeilingTest` (5): the branch's own ceiling in both orders
  of writing; the whole-company view; the fallback; this month against
  standing; and the budgets read once for eight categories. Mutations:
  whichever row comes first → caught; asked once a category → caught.
