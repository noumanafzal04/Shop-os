# ShopOS — handover & machine restore

**Written 2026-08-07.** Read this first after a fresh install. Everything needed
to rebuild the working setup is in git; this file says where it is and what
state it was left in.

---

## 1. Restore the working tree

The layout is one repo, one branch per app. The parent folder is the `main`
branch (docs only) and each app is cloned *inside* it — the parent's
`.gitignore` deliberately ignores the app folders.

```bash
git clone -b main https://github.com/noumanafzal04/Shop-os.git shopos
cd shopos

git clone -b backend      https://github.com/noumanafzal04/Shop-os.git shopos-backend
git clone -b admin-panel  https://github.com/noumanafzal04/Shop-os.git shopos-admin-and-user-panel
git clone -b mobile       https://github.com/noumanafzal04/Shop-os.git shopos-mobile
```

Folder names matter — the docs, and Claude's memory, refer to these exact paths.

| Branch | App | Stack | Head at handover |
|---|---|---|---|
| `main` | this overview + all docs | — | `7c97d16` |
| `backend` | REST API `/api/v1` | Laravel 12 · PHP 8.4 · MySQL 8 · Redis · Sanctum | `24966a5` |
| `admin-panel` | Web SPA (super-admin + shop panel) | Vite · React 19 · TS · Tailwind v4 · TailAdmin · TanStack Query · zustand | `2011da0` |
| `mobile` | React Native customer app (~55%) | React Native CLI · TS | `0913477` |

Then:

```bash
# backend
cd shopos-backend && composer install
cp .env.example .env && php artisan key:generate
php artisan migrate --seed && php artisan serve

# panel
cd ../shopos-admin-and-user-panel && npm install && npm run dev

# mobile
cd ../shopos-mobile && npm install && cd ios && pod install   # macOS only
```

Seeded logins: password is `password` everywhere. Super admin
`admin@shopos.test`; tenant owners `tenant1@app.com` … `tenant9@app.com` (one
per business type); customers `user1@app.com` … `user10@app.com`.

---

## 2. Do these two things before anything else

**Rotate the Geoapify key.** `b6b195b0…c841e` is hardcoded as a fallback in
`src/config/maps.ts` (panel) and `src/common/config.ts` (mobile), and this
GitHub repo is **public** — so it has been readable by anyone since the panel's
initial import. Rotate it at Geoapify, restrict the new one by domain/app, and
put it in `VITE_GEOAPIFY_API_KEY` rather than in source.

**Decide whether the repo should stay public.** The entire product — backend,
panel, mobile — is public at `github.com/noumanafzal04/Shop-os`. That may be
intentional; if it isn't, one settings change covers every branch.

Also: change the seeded super-admin password before the staging box is used for
anything real.

---

## 3. Where the decision history lives

Two directories, and they are not the same thing.

`docs/decisions/` (68 files) is the accumulated reasoning behind the build — why
the POS works the way it does, what was ruled out and why, what each sprint
shipped. Written for a person to read.

`docs/memory/` is a **verbatim snapshot of Claude Code's memory directory**: the
short, frontmatter-carrying notes plus `MEMORY.md`, the index loaded into context
at the start of every session. Written for the tool, and the one place to look
for what is currently believed to be true.

To give Claude Code its memory back on a new machine:

```bash
mkdir -p ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory
cp docs/memory/*.md ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory/
```

The directory name is the project path with `/` replaced by `-`. If your home
directory or checkout path differs, adjust it to match.

**Keeping the snapshot current is one command**, and it belongs in the same pass
as writing the memory itself:

```bash
./scripts/sync-memory.sh          # memory dir → docs/memory/
./scripts/sync-memory.sh --check  # exits 1 if they have drifted
```

This section used to say `cp docs/decisions/*.md …`, and that was **lossy in
both directions**, found on `2026-08-18`: nine notes had no document here at all
— including two standing rules — and the 24 that did would have been overwritten
by longer files carrying no frontmatter. The old `docs/decisions/MEMORY.md` had
also drifted past stale into wrong, still calling the admin-side backlog
"REQUESTED, not built" months after it shipped, so a restore handed a new machine
a false index. A backup that has never been restored is a belief, not a backup.

### The other docs on `main`

| File | What it is |
|---|---|
| **`START-HERE.md`** | **the entry point for a new machine or a cold start** — what the product is, setup for all three apps, the gating model, how to test offline, and the reading order for every other document |
| **`SYSTEM-REQUIREMENTS.md`** | **what a fresh machine needs** — PHP/Node/MySQL versions, PHP extensions, every framework version, setup commands, the gates |
| `README.md` | product overview, architecture decisions, branch map |
| `AUDIT-2026-08-06.md` | the 4-way audit: proven P0s, P1/P2 lists, and a record of every fix |
| `BUSINESS-TYPE-WORKFLOWS.md` | how each trade actually operates through the system — the developer contract: modules, gating, edge cases, tests |
| **`BUSINESS-FLOWS.md`** | **who gets which screen**, per trade — the staffing answer ("kitchen ki screen kisko deni?"), the preset→permission→screen chain, and the daily loop with the person named at each step |
| **`MODULE-GUIDE.md`** | **how every module works**, screen by screen — POS and its hotkeys, adding a product, category vs collection vs brand, Expense Manager, what the Ledger is, and where each trade differs |
| `POS-WORKFLOW-GAPS.md` | POS gap analysis |
| `IMPLEMENTATION_PLAN.md` · `ROADMAP.md` | phased plan and sequence |

---

## 4. State at handover

**Backend 2098 tests / 8916 assertions green. Panel 1022 tests green (81 files).** Gates all
clean: `tsc`, `npm run build`, `pint`, `eslint` (0 errors, 18 warnings — the
long-standing baseline).

Shipped and tested: catalog (variants, packs, combos, modifiers, batches/FEFO);
a single audited stock write-path; POS with server-authoritative pricing,
multi-tender + split, returns/exchange, held tickets, cash rounding, on-screen
numpad, derived quick-keys; shifts, drawers, X/Z-reads, business day + banking, relief cover;
pharmacy (Rx capture, FEFO, expiry); khata (sell-on-credit); loyalty points;
restaurant dine-in (tables, tabs, KOT, settle + split); serialized selling with
warranty lookup **and claim intake**; vehicles + trade-in as a tender; fuel /
forecourt; expenses + income with budgets, recurring and receipts; multi-branch;
promotions, coupons, tax groups, customer groups; suppliers, purchases,
payables; hardware registry; online orders, delivery/riders, reservations.

Three gating axes run the whole product, and mixing them up is the most common
source of bugs here:

- **MODULE** — `tenants.features`, assigned per tenant by the super admin.
- **TRADE** — `business_type`, via `BusinessTypes::primary()`.
- **PERSON** — permissions.

A business type *proposes* modules; the admin *assigns* them. Anything that
reads the type where it should read the module map will lock a tenant out of a
module they were granted.

On the PERSON axis there is a second rule, paid for on 2026-08-08 when a real
cashier found an empty product grid at the till: **a `*.manage` permission
answers "may you change this?", which is the wrong question to ask about a
read.** Reads take a set (`Permissions::READS_*`, ANY-of); writes keep a single
permission. See `docs/decisions/shopos-read-vs-manage.md` — and note the bug
class hides in three places, only one of which a route-map audit can see: route
middleware, controller `abort_unless`, and service-layer filtering.

---

## 5. In flight

**Offline is BUILT — 63 of 64 test IDs.** Phases 0–4 are done; Phase 5 is done
bar the soak. There is no offline coding task left. Everything is committed and
pushed on `offline/v1/backend` and `offline/v1/admin-panel`; the plan and every
decision behind it are in `docs/decisions/offline-pos.md`.

**A till that reloads while offline could not sell. Found and half-fixed
2026-08-18.** The POS disables Tender/Pay without an open shift, and the shift
came from a live query with nothing behind it — no query persistence anywhere in
the app, and a service worker that caches product images and no API responses. An
outage with the page still mounted sold fine, which is the case that was tested.
A **reload** — a sleeping tablet, a PWA relaunch, or the power cut the Help Centre
names by name — left the entire offline module behind a gate that needed the
server it was built to do without. `STORE.SHIFT` had been created for this in the
first schema, marked durable and covered by a migration test, and **nothing had
ever written to it**.

Fixed: the session row is mirrored to the device on every answer and handed back
when the request meets silence. Only silence — a 401 must not hand a drawer to a
signed-out till, and a 500 is a broken server rather than a dead line. Still
owed: queued shift open / close / drawer movements, the sync endpoint for them,
opening a shift with no server at all, and offline hold/recall (still
server-only, still without a refusal message).
`docs/decisions/shopos-offline-shift-gap.md`.

Checked 9 of the offline plan's ✅ claims while there: 6 hold, 2 were false in
the dangerous direction (shift open/close, hold/recall), one false in the safe
direction — the plan allows unlimited-use coupons offline and `canSellOffline`
refuses every coupon.

Two gates stand between it and a real shop, and NEITHER IS A CODING TASK:

1. **Shadow mode must run over real trading** until the check count is large and
   the variance count is still nil. Offline selling must not be turned on for a
   shop before that. Zero findings from zero checks is not evidence — and the
   check has already earned its keep once, catching a promotion the mirror was
   not applying on its very first real day.
2. The 72-hour soak (P5-4) — the one outstanding test ID, and a run rather than
   a build.

Two switches gate it in production, both admin-set per shop and both in
`PlanLimits`: `offline_selling` (0/1, off until a shop has earned it through
shadow mode) and `offline_hard_stop_days` (0 = never, opt-in).

`wip/relief-cover` shipped on 2026-08-07 and is merged into `backend`.

---

## 6. What's left

**The web side is feature-complete as of 2026-08-07**, excluding offline. Every
known gap is closed: the settings sweep, waiter table scoping, and training
mode were the last three.

**Deployment is what stands between this and a live shop.** Staging is a $6
DigitalOcean droplet, `shopos-dev` at `159.223.78.102` — backend health at
`/api/v1/health`, panel on `:8080`. It reflects none of the last five sessions.

**CI-CD was rewritten 2026-08-09** and is no longer parked. Both workflows now
gate on tests before they touch the server: the backend runs `php artisan test`
and the panel runs tsc / eslint / vitest / build, and `deploy` has `needs: gate`,
so a red suite cannot reach the droplet. Before this, a push to `backend` ran
`migrate --force` against staging with nothing having run the tests — and a
migration is the one step no rollback undoes.

The frontend deploy was worse than untested: it `find -delete`d
`/var/www/shopos-panel`, which is the **git checkout**, so it could only ever
work once. Both scripts now `rm -rf .github` and `git reset --hard`, which also
retires the standing "first pull always aborts" gotcha. Full detail and the
server's checkout-vs-`-live` split are in `docs/decisions/shopos-deployment.md`.

**Both gates are PROVEN. Only the deploy half fails, and it fails on the SSH
key.** Checked against the Actions API on 2026-08-25: sixty-seven runs, and the
most recent of each reports `Test suite: success` on the backend and
`Typecheck, lint, test, build: success` on the panel. The deploy job then fails
on its one SSH step — `DEPLOY_SSH_KEY` — which is the outstanding item and is
not a coding task.

*This paragraph used to say the rewritten workflows had never run and that
pushes carried `[skip ci]`. Neither was true by the time anybody read it: no
recent commit carries `[skip ci]`, and the runs are on record. It was believed
and repeated for two weeks. Check `/actions/runs` before repeating it again.*

**What WAS wrong, and is now fixed: the gate ran nowhere the work happens.** It
fired on `backend` / `admin-panel` alone while every commit lands on
`offline/v1/*`, so the suite ran at merge time and nowhere else — a red branch
could sit for weeks and say nothing until the moment it was promoted. The gate
now runs on every branch and the deploy job is fenced to the release branch with
`if:`. `needs: gate` says the tests must pass; the `if:` says where a passing
run is allowed to reach a server holding shops' takings.

Two things worth knowing when a supermarket signs:

- Multi-lane is done — `registers` are owner-created, one per checkout, each
  with its own printer, drawer and shift. But the `registers` limit **defaults
  to 2** per tenant and an admin has to raise it, or their Lane 3 is refused at
  creation.
- Shift history now renders — `Day & banking → Shifts`, added 2026-08-07. It is
  organised by DRAWER rather than trading day, which is why it is also the only
  place a training shift is visible at all.

Parked deliberately, in order: the offline PWA POS (plan in
`docs/decisions/shopos-offline-plan.md`); the mobile apps (plan in
`docs/MOBILE-PLAN.md`); the rider backend that the rider app needs; a payment
gateway (there is none anywhere, and COD launches without one).

**The mobile contract drift was checked on `2026-08-18` and is not there.** This
line used to warn that `item_types`, `other_income` and `logo_url` had "moved
under" the app. `tsc` is clean, its 31 tests pass, all 359 resolvable client
calls across both apps reach a route that serves that verb, and the mobile
`Tenant` type matches `TenantResource` on all three named fields (`other_income`
does not appear in the mobile app at all). The customer app is behind on
FEATURES, not out of contract — **a stale warning sends the next person hunting
something that is not there**, which is its own kind of wrong documentation.
Re-check with `python3 shopos-backend/scripts/dead-endpoints.py`, which now asks
the reverse question too.

The smaller loose ends from the 2026-08-06 audit are all cleared (see the
session log).

---

## 7. Session log

Newest first. Appended as work happens, not at the end of a sprint — this
machine may be rebuilt at any time, and anything not written down here and
pushed is gone. See `docs/decisions/shopos-docs-discipline.md`.

### 2026-08-29 — One device, one shop's shelf

A pharmacy's till was showing a mart's products, and selling them. IndexedDB is
scoped to the ORIGIN, so one browser used by two shops has one database; the
outbox has always fenced that and the CATALOG never did. `clearCaches()` was
written for "a till handed to a different shop" and was called by nothing.

Fixed with a stamp checked at the moment of use (every pull, and sign-in),
never a wipe on logout — logout is the one door people take deliberately.
Durable stores are untouched; an unstamped database is claimed, not wiped.
Proven on production with two demo shops, and the fix verified with the same
spec. 1319 unit tests.

Also this day: the shift queue never received the sale queue's force-on-press
and stranded-visible fixes (`docs/decisions/shopos-half-the-sync.md`), and the
stranded answer now stays on screen instead of expiring after 2.5s.

Two of my own measurement bugs are recorded in the decision notes, because both
produced confident wrong answers: a `hasText` locator cannot observe a label
change, and `addInitScript` re-runs on every navigation.

## 2026-08-29 — Half the sync obeyed the button

A shop pressed Sync on a till reading "7 still to send" and the number never
moved. **Checked the deployed bundle first**: `panel.cartze.shop` was serving
the latest commit's own strings, so the bug was real, not a stale deploy — and
that also ruled out stranded sales, which the live build already labels
differently.

The badge is the SUM OF TWO STORES — `owedCount()` (sales) plus
`owedShiftOps()` (drawer events). The sale queue had learned that a press
ignores the backoff and that a fenced row must be visible. **Neither lesson
reached `shiftQueue.ts`**, so a till holding drawer events was forced by
nothing and had no reason available anywhere. Fixed on both sides, plus
`lastError` — captured since `queueSummary` was written and displayed by
nothing, which made a bad line and a refusing server read identically.

Five mutations, five failures. 1310 unit tests (was 1287), 0 lint errors,
build clean. See `docs/decisions/shopos-half-the-sync.md`.

**Not yet deployed** — the fix is on `origin/offline/v1/admin-panel`; the live
panel still serves the previous build.

Also recorded, no code written: the multi-packaging proposal
(single/pack/box/carton) is **already built** as `ProductUnit` — factor,
explicit pack price, own barcode, one base-unit stock pool — with the single
real gap being a printed label per pack rather than per product. And
**Arti/Mandi** (grain commission agent) is logged as a backlog vertical: real
market, large reuse of khata/parties/expenses, but a whole vertical whose main
screen is arrivals→weighing→settlement, not a cart.

## 2026-08-26 (latest) — six screens, and the rule applied to half of itself

A batch of screen work, and four of the six turned out to be the same shape: a
rule that had been applied to one half of a screen and not the other.

**Staff — the permission list the presets tick.** The job presets have been
filtered by the shop's modules and trade since they were written ("offering
Waiter to a pharmacy is noise, and noise on a permission screen is how the
wrong box gets ticked", says StaffPresets in as many words). The nineteen
checkboxes underneath them never were, so a mart hiring a cashier was offered
Kitchen board, Serve any table and Reservations.

Irrelevant rows are **flagged, not dropped**: the form submits the boxes it
drew, so hiding them would quietly revoke a permission somebody still holds.
Any that ARE held show in a group of their own and can only be given up on
purpose. That forced a reversal — a preset used to grant its full list even
where a module was off, and with the list filtered that now means granting a
permission with no checkbox to see it by. `StaffPresetTest` asserts the
invariant directly, and it is what found it.

Staff also gained the filters it never had: status (accepted by the server all
along), branch, and **job** — the word an owner thinks in. A job is derived by
set comparison against the preset, never stored; one box off reads as "Custom",
which tells the owner their edit landed.

**Orders — a queue that says how many are waiting.** Stage counts ride along
per axis; a warning strip for deliveries with nobody carrying them; search,
date, delivery/pickup and channel filters (`channel` and `open_only` were
accepted by the server from day one and the screen sent neither).

The card version was **wrong and the user said so within the hour** — four
orders filled a laptop. It is a table now: the row carries what is needed to
choose, a click opens the rest. The columns step down at `sm` and `xl` rather
than scrolling sideways, and the steps are not `md` because the rail takes
290px from `lg` up — a 1024px tablet has less page than a 768px phone in
landscape. Measured at six widths.

**Take an order — a modal became a page.** Everything a shop does while
somebody is on the phone had been packed into a box smaller than the screen. It
is laid out like New Sale now, the catalogue is browsable (first page on load,
search, "Show more — N to go"), and **stock is on the tile**: an item with none
cannot be added at all.

Behind that: `Insufficient stock: only 0 in stock.` named nothing. A basket of
nine told the shop one was short and would not say which, so the only way
through was removing lines one at a time. It names the item now.

**Subscription — leads with where you stand.** The most consequential fact on
the screen was a badge in the corner of one of three equal cards. A read-only
shop cannot ring a sale; it was being told so in eleven-pixel type. Renewal is
"in 17 days" rather than a date to work out, a full usage bar says so in words,
and "What your shop runs" listed **three modules out of eleven** because the
labels were a lookup table typed into the panel — a restaurant was never told
it had dine-in.

**Reports — one named date control.** Six period pills and a panel of two bare
date boxes, replaced by the shared control with the shop's own windows handed
IN to it (the tax year is 1 July–30 June and no calendar preset expresses
that).

**Four guards, and the parser that was wrong three times.** Adding
`/tenant/orders/new` to the shared route set made four suites fail at once —
the browser walk, the permission map, the menu-reach guard, the permission
count. All four ask "is every screen covered" of THAT set, so a screen missing
from it is invisible to all of them simultaneously *and they all report
success*. The set is now checked against the router, and getting there took
four attempts: prefixing turned `/tenant/products/new` into `/tenant/new`; a
tag regex could not read the file because `element={<Page />}` contains a `>`;
a segment comparison was honest but could not have caught the bug it was
written for. The fourth strips `element={…}` by matching braces and walks the
tree with a stack. Mutation-proven against the exact screen that got through.

**Also extracted, because each was about to be written a third time:**
`sellingPrice` (identical in the till and New Sale — and neither was tested on
`discount_price = 0`, which read literally gives the product away),
`formatQuantity` (three spellings in four files, two of which disagreed on
`0.1 + 0.2`), `elapsed`/`urgencyOf`, `orderStage`, `nextStep`.

**Gates.** Backend **2352 on SQLite and MySQL, exit 0 on both**. Panel **1234
unit tests**, 0 lint errors, tsc and build clean. Every new rule
mutation-tested.

---

### 2026-08-26 — one filter bar, and a shop that remembers it was kept

**The complaint was "the whole site's filters don't look good".** It was right,
and it was the smaller half of the problem.

**What the filters were.** Every list drew its own: a bare grid of inputs on
one screen, a row of square chips on another, three different heights of
select, two bare `<input type="date">` boxes wherever a date range was wanted.
None of them had the part that matters — you could set four filters, scroll
past them, and have no way to see what was in force. An empty table then reads
as "there is nothing here" rather than "you filtered it all away", which is the
most common way a working screen gets reported as broken.

**What is there now** — `src/components/ui/filters/`:

- **`FilterBar`** — search, the controls, and a row that always says three
  things: what is applied (a removable pill per filter, each naming its axis
  and its value), one Clear all, and the result count in the noun of the thing
  listed.
- **`DateRangeFilter`** — named ranges with the dates they resolve to printed
  beside them (`Last 30 days · 28 Jul – 26 Aug`), a tick on the one in force,
  and a two-month custom dialog that changes nothing behind it until Apply.
  `matchPreset` names a range restored from a URL, so a bookmarked screen ticks
  the right row. The arithmetic is a pure module with 19 tests standing on
  month ends, leap years, quarter boundaries and Karachi's +5 offset — the one
  that turns midnight on the 1st into the last day of the month before if
  anything ever reaches for `toISOString()`.
- **`FilterChips`** — mutually exclusive buckets carrying counts.
- **`FilterSelect` / `FilterPopover` / `FilterOption`** — one treatment, one
  click-away, one Escape that returns the focus to the trigger.

Rolled onto: tenants, billing, the audit log, shop requests, enquiries, sales,
products, purchase orders, online orders, documents, customers, staff, the
activity trail, and the expenses/income money bar.

**The filters that already existed and could never be reached.** This is the
larger half. `TenantController@index` had accepted `status`, `city_id`,
`plan_id` and `online_only` since it was written and the screen sent two
parameters. The billing ledger had `tenant_id`, `from` and `to` and the screen
sent none. The sales ledger had `channel`, `from` and `to`, and its Help Centre
article promised filtering "by date, payment method or who rang it" — over a
server that had only the date. That last one is the worst shape: a help page
describing a control that is not there reads as a control the shopkeeper
failed to find.

So `payment_method` and `served_by` are now real, the sales list and its CSV
export share **one** filter method rather than two copies under a docblock
promising they matched, and the article says what the screen does.

**Which door a shop came in through.** `tenants.converted_at`, stamped by
`ApproveShopRequestAction`. Three origins — `demo`, `converted`, `direct` —
filterable, countable and sortable, with the counts computed per axis with
every OTHER filter applied but not its own (the marketplace facet rule). A shop
someone kept after trying a demo has an owner who has never spoken to anybody
and is sitting in the setup wizard under a generated name; it used to look
exactly like a shop opened by hand a year ago. The list now opens with a
callout that says how many there are and shows them in one press.

**How many people are waiting.** `GET /admin/inbox` → pending shop requests and
new enquiries, badged on the rail. Both queues sort oldest-first *because* a
slow reply costs the customer nothing, which means the only thing that ever got
them answered was somebody choosing to open the screen. A count withheld from
staff who may not read the queue is **absent**, never zero — a zero draws no
badge, which is indistinguishable from the truth until someone asks why nobody
replied.

**Billing learns to say how much.** Seven numbers and an unfilterable table,
four of them headcounts. Nobody chasing subscriptions is chasing heads.
`outstanding` totals late money at each shop's own plan price (per-plan, and a
test fails if the two plans are ever priced the same, so it cannot pass by
accident); shops with no plan are counted apart rather than folded in as zeroes
— they are every converted demo waiting to be priced. `chase` is who to ring
today, in grace first. Plus the same twelve-month trend the dashboard draws,
from the same method.

**Three defects found while doing it, two of them pre-existing:**

- **The app shell widened the page.** `AppLayout`'s content column was a plain
  `flex-1`, and a flex child's `min-width: auto` will not shrink below its
  content — so one table wider than the window pushed the whole shell, header
  included, past the right edge. The page scrolled sideways with no scrollbar
  to say so, and the last column of the table simply was not there. It only
  appeared at `xl` and up, because below that the same markup is a block: the
  **widest** screens were the broken ones. Found by a browser; jsdom has no
  layout engine and never could have seen it. `min-w-0`, and a guard.
- **Two buttons, one name.** The custom-range dialog draws two months, so "10"
  is 10 August *and* 10 September — a screen reader heard a list of numbers
  repeated twice. Found by the component test failing with "found multiple
  elements", which is the test finding a real bug while looking for a locator.
- **The pager did nothing.** Mine, reported by the user within the hour. The
  tenant list routed `<Pager onPage>` into the same function its filters used —
  one that resets to page one on every change — so Next set the page and
  dropped it in the same call. The marketplace's copy, written weeks earlier,
  had the missing line. **Two implementations of one rule, and the newer one
  lacking the fix the older one already carried.** There is now one
  (`nextParams` / `useUrlFilters`), tested on its own, used by all three
  screens, and a guard that fails if a fourth writes its own.

**Gates.** Backend **2322 on SQLite / 2327 on MySQL, exit 0 on both**. Panel
**1198 unit tests**, 0 lint errors (21 pre-existing warnings), `tsc` clean,
build clean. Every new rule mutation-tested: break it and the test fails.

---

### 2026-08-26 — the marketplace becomes a marketplace

`/shops` listed SHOPS: city chips, a search box, a grid of shop cards, and a
744-line page behind each one carrying its own header, cart, checkout form and
modifier dialog. The backend matched — it could answer "what does this shop
sell" and nothing else. There was no endpoint for a single product, so an item
could not be linked to, shared, or opened from a search result.

A customer does not shop for a shop.

New: `/browse` (every product from every shop, with a filter rail), `/p/:id`
(gallery, sizes, options, quantity), `/cart`, `/checkout`, `/saved`, and a
rebuilt `/shops` that leads with goods. Header, basket sheet and footer are
declared once by `MarketLayout` — every page brought its own before, which is
how the shop page ended up owning the only basket in the product.

Three decisions worth the argument, written up in
`docs/decisions/shopos-the-aisle.md`:

- **The basket spans shops; an order does not.** It used to empty itself when
  anything from a second shop was added. The split is now SHOWN rather than
  hidden, because it is real — three shops is three orders, three delivery fees
  and three deliveries. Checkout places them one at a time and removes each
  shop from the basket the moment its order is real, so a half-succeeded
  checkout cannot end in two vans.
- **The rail is counted, never written down.** Every option comes back with the
  number of products behind it, from the same query the listing runs. A count
  that turns out wrong is worse than no count.
- **A card may add what it can fully specify.** Sizes are on the card; modifier
  groups are a form and go to the product's page.

The two database engines lied in opposite directions, and each hid the other:

- SQLite hid a MySQL bug. `selectRaw` APPENDS, so the facets' price range
  arrived on top of `products.*` and a subselect — which MySQL refuses under
  ONLY_FULL_GROUP_BY. Nineteen green tests and a 500 on the first real request.
- MySQL would have hidden a SQLite bug. A PHP float binds as a STRING, and
  SQLite orders every number below every string, so `2400 <= '500'` is true and
  "under Rs 500" returned the whole aisle.

So the suite runs on **both** now and the deploy waits for both (`gate` +
`gate-mysql`). The MySQL job asserts ONLY_FULL_GROUP_BY is actually on first,
because a MySQL without it would pass everything and prove nothing.

That second run immediately found two more, neither of them from this work.
**A pharmacy recall could not find who took the bad lot home**: the JSON
pre-filter used the casing as typed while the match lowercased, so `Bad-77`
recalled as `BAD-77` found nobody — and the on-hand query already lowercased,
so the screen listed the stock to pull beside an EMPTY list of people. And a
query-count test grepped for `from "products"`, which is SQLite's quoting, so
it counted zero on the engine that mattered.

`e2e/market.spec.ts` walks the storefront in a browser with NO SESSION — a new
project, because every other one signs in first and the marketplace's reader is
a customer who has never had an account. Its first two runs failed on the
harness, not the product: both filter rails are in the DOM at once (the `aside`
is hidden by CSS, not unmounted), so `.first()` clicked the invisible one.

Backend 2289 tests on both engines, exit 0. Panel 1165 tests, 0 lint errors,
14/14 storefront e2e on desktop and phone.

### 2026-08-26 — the demo world catches up with the product

Asked whether the demo seeder needed anything. It ran fine — `migrate:fresh
--seed`, exit 0, nine shops — and had not been touched since 9 August while
about fifteen features shipped past it. A seeder that still runs is not a
seeder that still covers the product.

Two of the gaps were worse than "thin". **A module was switched on with an
empty table underneath**, which does not read as unconfigured, it reads as
broken:

- Karahi House had `dine_in` on and **no tables**. Nothing to seat, so no tab
  could be opened, so the kitchen board could never show a docket. The till's
  own free-text table is deliberately hidden for dine-in shops, so dine-in
  could not be demonstrated at all.
- Highway Fuel had `fuel` on and **no tank**, so `OpenForecourtShiftAction`
  answered `NO_FORECOURT_CONFIGURED` — the whole of Unit 11 unreachable in the
  demo world.

And **Demo Mart** — the shop `owner@demomart.test` opens, the credentials
printed in the seeder's own docblock — had every module on and not one row
behind any of them. That is the first thing anybody sees on a fresh install.

`product_variants` was **0**. The seeder has had a `variants` reader since the
first import and no catalog ever wrote one; same for `modifiers`. Sizes, the
picker, per-size 86, per-size recipes, a deal that names a size, variant
barcodes — nothing had demo data. A reader with no writer, three times in one
file. Neither had `products.barcode`: not one demo product carried a code, so
the most-used control on the till had nothing to find.

Now seeded, all through the real actions rather than written to tables: a floor
of thirteen tables with one tab fired and one still being keyed; a forecourt
with a tank per grade, six nozzles, a reconciled shift and a live one; sizes on
food and garments with the parent holding no stock of its own; recipes
including per-size **overrides**; deals including one that names a size; 86 in
both shapes; serials received, sold and claimed on; vehicles and a trade-in;
khata and points; registers, hardware, cash movements, coupons, banks, packs,
transfers, a stock count that found a variance, lots with real dates, both
disposal dispositions, riders, enquiries, a demo shop asking to be kept.

Three things this cost, each worth keeping:

- **Exit 0 and no warning is not success.** The first equipment pass ran before
  the catalog existed, so every method found nothing and returned. Thirteen
  tables appeared and nothing else did, and the run was green. The row count
  told the truth; the exit code did not.
- **The seeder must not compute a total.** A khata tender has to equal the bill
  exactly, and price × quantity was wrong in six of eight shops because the demo
  world also seeds an automatic 10%-over-500 promotion. It now asks
  `PromotionService::preview()` — the same thing the till asks.
- **Realism that breaks the product is not realism.** Eleven expired lots were
  seeded "for the dashboard". `InventoryService` fences expired quantity out of
  what may be sold, so eleven demo products silently refused to sell. Exactly
  one lot is now past its date and it is written off in the same pass.

The guard is the point. `DemoWorldIsCompleteTest` already existed with the right
argument in its docblock — and it enumerated features by hand, so it could only
cover what its author remembered, and it passed for a fortnight over all of the
above. It now carries a **map** from module → the tables its screens read, with
a denominator (≥9 shops, ≥60 module/table pairs, and every module in the map ON
somewhere). Switch a module on for a demo shop and the test names the table you
have to fill. Proven by mutation twice: removing `seedDineIn` fails with
"Karahi House: 'dine_in' is on, but DiningTable is empty".

Its own re-run test then found a real bug in this work: `seedLots` guarded
per-product, so every re-seed gave lots to the next eight products. Not
duplication — growth — and the seeder's promise is that a re-run changes
nothing. Guarded on its own marker now, because "does this shop have any lot"
was already true from the purchase order.

2270 tests, 9537 assertions, exit 0.

### 2026-08-26 — one dashboard, two consoles

Full write-up: `docs/decisions/shopos-one-dashboard-two-consoles.md`.

The brief was "trendy and modern, keep it consistent, break nothing". The page
STRUCTURE was left alone deliberately — the shop console is gated module by
module and trade by trade, and rearranging it to look newer is how a pharmacy
loses its batch panel.

`SectionCard` (shop) and `Panel` (admin) were **the same component written
twice**, and had already drifted: different padding, and different BREAKPOINTS
for it, so between 640px and 768px the two consoles were visibly different
products. Both render one `Surface` now. A trap avoided on the way: the first
version interpolated `group/${name}` into a class — Tailwind scans source text,
so that class is never generated and the hover arrow silently stops moving.

**Labels that could not be read.** Six KPI tiles from 1024px is 150px each, so
every label longer than "Total tenants" was cut: *Active subscriptio…*, *Revenue
this mon…*, *Online orders tod…*. Same defect in the shop's `StatTile`. Labels
and subtitles and plan names all wrap now — "Karahi House — cus…" is a different
shop as far as the reader is concerned. The caption's line count was **guessed
twice and wrong twice** (two lines, then three); it has no clamp at all now,
because every guess at a line count is a width nobody measured.

The strip ramps 2 → 3 → 6 and waits for `2xl` on both consoles, and the
emphasised tile lost its size bump: at 1536 "Rs 133,000" at 30px still printed
as "Rs 133,…". **Money is never truncated.**

**Fourth pass.** KPI strips cap at **three across** on both consoles — five or
six put a money figure in 150px of tile, and even where it fitted it was a wall
of numbers. A gap under three labels turned out to be mine: `MetricTile`
reserved the sparkline's room from the prop's presence while `Sparkline` had
just learned to draw nothing for a week of zeros; both ask `hasShape()` now.
`SalesTrendChart`, `ExpenseDonut` and `RecentTables` each built their own card
shell, so the new corner and header rule had stopped at them. Charts: rounder
heavier stroke, hover marker with a ring, tighter grid dash — and the last point
sat at the plot's right edge, so a 3px round cap ran into the card's border and
the line looked like it carried on past the panel.

**Third pass — the part you can see.** Fair feedback on the first two: *"koi
changes nahi nazar aayi."* Both were real and neither was visible — consolidating
two copies changes nothing on screen by design, and an unclipped label only looks
different if you knew it was clipped.

Both consoles now open with a **brand gradient masthead** (`DashboardHero`,
shared), borrowed deliberately from the landing page's hero so a shopkeeper who
signs in lands somewhere that looks like the place they were just sold. One
colour, once per screen — everything below stays white, which is the whole reason
it works. Panels went `rounded-3xl` with **a hairline under every header**: the
card had been one undivided plate, so a title and its contents ran together and
every panel read as a soft rectangle of grey text.

**Second pass — the tile itself.** The shop's KPI tile lived inside `KpiRow`
and the platform's was `KpiTile`: the same design twice, drifted on the value's
size and on the percentage — `−100.4%` there against `-100.43%` here. One
`MetricTile` now. The grey gradient wash is gone (it makes white cards look
dirty and does nothing else), the figure is larger and tighter, the hover is a
lift, and the sparkline runs to the card's edges.

Two things the sweep caught in that new tile: `leading-none` clipped every
figure — including "37" — because it sets the line box to exactly the font size
and `truncate` then cuts the ink; and the sparkline filled the area under an
**all-zero** week, so a shop that has not sold yet carried a slab of colour
across three tiles that reads as volume. A week of nothing has no shape. Also
`KpiRowSkeleton` had a hand-copied version of the tile's padding and was now 4px
short — the strip would have resized on arrival, which is the bug the copy
existed to prevent.

Checked on both consoles at seven widths each — 1920 down to 390 — with a sweep
that walks every leaf text node and compares `scrollWidth`/`scrollHeight`
against the client box. Fourteen viewports, nothing clipped, nothing
overflowing, no errors. A screenshot would not have found most of it:
"Active subscriptio…" looks fine as a design.

### 2026-08-26 — asking for a newer version, and the top of the page

Full write-up: `docs/decisions/shopos-asking-for-a-newer-version.md`.

**"When does the update button show?"** Up to an hour after a deploy, because a
till is the one screen nobody navigates and the browser only looks on
navigation — so `updateWatch` polls hourly. That is right for something nobody
should think about and useless the moment somebody IS thinking about it. Worse,
**"Later" was a one-way door**: dismissing the strip cleared the flag that MEANS
a version is waiting, so nothing offered it again until an unrelated reload.

There is a refresh control in the header now, on both consoles, and it answers
with **one of five things** — found / installing / current / offline /
unavailable. "Nothing found" and "I could not look" are not the same sentence:
a till offline for the afternoon must not be told it has the newest prices, and
a copy served over plain http must not be reassured either. Offline is
deliberately not red — a till with no line is doing what it was built for.

**Its first press exposed a real bug.** On the admin console it said "this copy
cannot update itself", every time, about an app that updates itself perfectly
well: `useRegisterSW` may be called once, so it lived inside the shop-side
update strip and the admin console had no registration to ask. Registration
moved to `ServiceWorkerHost` in `AppLayout` — both consoles, and NOT the app
root, because the root includes the landing page and that would precache
megabytes of console for a stranger reading a page about a till.

**The top of the landing page was wrong three times.** The hero slides under a
transparent header; `-mt-[62px]` was the header measured by hand, and the nav
growing a pill made it 79px — a white line across the fold. Wrapping header and
hero in one dark box removed the line and **broke `sticky`** (a sticky element
holds inside its own parent; at 2400px down its top was -1010px). It measures
itself with a `ResizeObserver` now: 79px on a desktop, 69px on a phone, which is
why no literal could have been right.

Also: the nav is one pill with short, same-shaped labels and marks the section
you are in (an observer reports *changes*, not state — the mark used to stick
for ever); the footer wordmark was near-black on a permanently dark footer in
light mode and now takes `tone="onDark"`; the profile dropdown's four filled
glyphs are line icons like the rest of the product, and its sign-out arrow
points out rather than in; the owner's-day phone went from 971px to 482px tall;
and every sentence fencing the product to one country or currency is gone.

Gates: panel 1165 / 95 files, tsc, eslint 0 errors, build. Verified in a real
browser at four viewports: 0 sideways scroll, 0 console errors, sticky header
0px at every depth.

### 2026-08-25 — a dark shop, and asking for a person

Full write-ups: `docs/decisions/shopos-a-dark-shop-one-lit-counter.md`,
`docs/decisions/shopos-ask-for-a-person.md`.

The landing page was "bohot basic" — a white page that **stated** the till keeps
selling and **stated** it knows eight trades, which is what every competitor's
page states. It now argues instead. The fold is a dark room with one lit thing
in it, because the pitch is a shop whose power has gone and whose counter has
not. The eight-icon grid became a **switcher**: pick a trade, watch the till
change — a batch and an expiry for the pharmacy, a meter roll for the pump, a
KOT for the restaurant. The units are the argument, and they cost one tap to
check. Nine bands, a real header (it greets a signed-in shopkeeper by name and
its button opens *their* shop) and a real footer.

The fold shows the **whole system** — the rail, the shop's name, the day
counted — with the till small over its left corner, because the person reading
this is buying a business system and a till alone made it look like a cash
register. The type inside the window runs a third larger than the real app's:
the layout is the app's exactly, but a 1440px console squeezed into an 1150px
frame turns 13px labels into smudges. It is **drawn, not screenshotted** — a
capture needs a second copy for dark mode and becomes a lie the first time a
button moves.

A third browser-only bug: the owner's-day section puts that dashboard inside a
340px phone, and the comment above it claimed the component "is responsive, so
a 340px column is simply its small layout". **False** — a Tailwind breakpoint
asks the viewport, never the box the component stands in, so it took the
four-across layout inside the phone and clipped "Rs 146,000" to "Rs 146…". It
lays out by `@container` now.

Bugs only a browser could find: the chart rendered **no bars at all**
(`items-end` stopped the columns stretching, so every percentage height resolved
against zero), and the page **scrolled sideways 20px on a phone** (the glow
behind the till widened the document). Both caught by measuring `scrollWidth`
and computed heights at four viewports, not by looking at a screenshot.

And the page grew a second door. "Try the demo" is the right answer for whoever
will try software alone, and the wrong one for the shopkeeper who wants walking
through it and the one with a single question in the way — **both used to read
the whole page and leave**. `enquiries`: a public throttled endpoint, an admin
queue on the rail, oldest first. A name and an email is the whole requirement.
It does **not** book anything and does not pretend to — `prefers_at` is a
preference, the reply says a person will confirm, and the admin card says
"Wants a time around…".

Two things worth keeping from how it was tested:

- The ordering test **passed against its own bug twice**. First the oldest row
  was also the first inserted, so no `ORDER BY` still gave the right answer.
  Reversing that did not fix it either — SQLite served the filtered query from
  the `(status, created_at)` index and returned `created_at` order by accident.
  Only the *unfiltered* listing, where no index can rescue it, pins the clause.
- The admin side finally has the **reachability guard** the shop side grew after
  its fourth unreachable screen. It was wrong on its first run — it modelled one
  route shape and called the Help Centre a dead menu row, when the Help Centre
  is simply ungated on purpose. *Suspect the parser before the code.*

Gates: backend 2263 passed EXIT=0; panel 1156 / 94 files, tsc, eslint 0 errors,
build. The whole loop was driven in a real browser: form filled → row in the
database → the lead on `/admin/enquiries` with the time correct in PKT.

Also: `.env.example` still said `APP_NAME=Laravel`, and `MAIL_FROM_NAME` is
built from it — a fresh install signed its email "Laravel".

### 2026-08-25 — the front door

Full write-up: `docs/decisions/shopos-the-front-door.md`.

`cartze.shop` answered with the customer marketplace — a list of somebody
else's shops, shown to the person deciding whether to trust their day's takings
to this. The storefront moved to `/shops` and `/` is the product's page.
`homeForRole` was the quiet one: it sent customers to `/`, so signing in as a
customer would have landed them on a POS advert.

**Try the demo gives each visitor their own tenant**, seeded for their trade,
for 24 hours. Not a shared sandbox — a shared one is renamed to nonsense within
a day and two visitors ringing sales at once ruin each other's figures. No email
at the door; it is asked on the way out. The expiry is ABSOLUTE from creation
so the banner can print a real time, which a sliding window could never do
truthfully.

**It is not the demo seeder.** `DemoDataSeeder` and `migrate:fresh` stay
forbidden on production; this creates one tenant. Three fences: `is_demo` is
checked inside `marketplaceVisible()` (one scope, not five call sites), the
shelf is stocked through `InventoryService` (writing `stock_quantity` alone
leaves every item reading "out of stock"), and the owner's password is random
and never sent anywhere.

**"Keep this shop" converts what they built.** While the request is pending the
shop keeps working and the prune skips it — the bound is on the ADMIN answering,
never a timer that deletes a waiting customer's work — so `/admin/shop-requests`
is ordered by longest wait and says so at the top. They set their own email and
password at request time, which is also what finally lets a demo owner sign back
in at all. Approval returns `setup_completed` to false so they name their own
business, which is why the request form does not ask for one.

Four faults found by RUNNING it rather than reading it: a 404 out of a public
endpoint (the action read through the ambient tenant scope), a 500 on an
optional phone field every test happened to send, "waiting less than a days",
and a page whose animation was load-bearing — `opacity: 0` rescued by
JavaScript, one broken observer from a blank landing page.

And a mutation caught a test of mine passing against its own bug for the third
time that day.

### 2026-08-25 — the gate that ran nowhere, and the red nobody could read

Full write-up: `docs/decisions/shopos-a-gate-nobody-could-read.md`.

**The gate ran nowhere the work happens.** Triggers were `branches: [backend]` /
`[admin-panel]`; every commit lands on `offline/v1/*`. The suite ran at merge
time and nowhere else. Now `branches: ['**']` for the gate, with deploy fenced
by `if:` to the release branch. First run: gate **success**, deploy **skipped**,
on both.

**And the suite had been red all along, while reporting "2225 passed".** No test
failed. `EveryTradeSellsTest::trades()` hands three arguments to a test that
accepts one; PHPUnit 11 warns, and the warning takes the process to exit 1. Red
on CI and locally, for as long as the mismatch existed. Fixed with a provider
DERIVED from the existing one — not three parameters with two ignored (a
signature that lies), and not a second hand-written list (two copies, one gets
updated). Now `SUITE EXIT=0`, zero warnings.

**It was invisible because the summary swallowed the exit code.** Every backend
run read back as `{"result":"passed","tests":2225}`, which has no opinion about
`$?`. Fifth entry in `shopos-measurement-that-lied.md`. When stdout is being
rewritten, make the tool write a FILE: `--log-events-text`, then grep it.

**A red gate could not be read either.** Job logs need admin rights on this
repository; annotations do not. The gate now emits `::error::` as well as a step
summary — the summary alone reaches only the people who could already read the
log, which I shipped before checking.

Still outstanding and not a coding task: the deploy job's SSH step
(`DEPLOY_SSH_KEY`).

### 2026-08-25 — whoever can act on it

Full write-up: `docs/decisions/shopos-told-by-permission.md`.

Every operational notification went to shop OWNERS and nobody else. The stock
keeper was never told a shelf had run down; whoever packs orders was never told
one arrived. `/notifications` sits behind no role gate and the bell renders for
every signed-in role — there was a bell in front of them the whole time with
nothing that could be put in it.

**Whoever holds the permission that lets them act on it.** Not a role: cashier
and stock keeper are permission SETS, and a "notify the cashier" would put back
the concept a release was spent removing. It also answers the question this gap
was raised with and left open — *should a cashier hear about low stock?*
**The permission IS the setting.** A shop that does not want its counter chasing
stock does not tick `inventory.manage`; a separate switch would be a second
answer to a question already answered. Owners hold everything implicitly, so
nothing is taken from anybody.

**It follows the branch.** Gulberg's shelf tells Gulberg's people; an order
tells the branch filling it. Staff with no branch recorded are INCLUDED —
over-notify and somebody asks a question, under-notify and nobody asks anything.

`notifyTenantOwners` is deleted: after the four senders moved it had no callers
in app or tests, and this repo has found "built, and nothing reaches it" seven
times.

Six tests, four mutations — and the fourth one proved a COMMENT of mine wrong
rather than the code. I had claimed the per-recipient dedupe suffix stopped one
person silencing the rest; `app_notifications` is already unique on
(user_id, dedupe_key), so a shared key changed nothing. The suffix stays for
continuity with rows already written and the comment now says so.

Help Centre updated: assigning a permission now has a consequence invisible from
the checkbox, so the staff topic says it.

### 2026-08-25 — the nearest branch that can actually fill it

Full write-up: `docs/decisions/shopos-nearest-branch-fills-it.md`.

Nothing on `orders` named a branch, so every online order in a chain was
answered by, held against and deducted from the tenant's DEFAULT branch. Ten in
Gulberg and none in Main refused the order and told the customer "only 0 in
stock" about a shelf the goods were never going to come off. **That gap is now
closed** — the previous entry in `shopos-one-branch-runs-out.md` recorded it as
a consequence rather than a design, and this is the design.

**The rule: the nearest branch that holds the WHOLE basket.** Nearest alone
would turn a customer away whenever the shop round the corner is short one line,
and filling from the next one along is the entire reason a business opens a
second shop. One branch fills the whole basket — splitting it is two riders and
two delivery fees — and when no single branch can, the nearest is chosen anyway
so the refusal names the ITEM rather than saying something true and useless.

**No pin, no change.** A phone order or a customer who never shared a location
cannot be measured, so ranking falls back to the default branch: the OLD
behaviour, not a silent reshuffle. A single-branch business is untouched.

Two halves that would have gone wrong quietly. `stockDraw()` is the one answer
to "what does this line take off a shelf" and both the hold and the branch
chooser use it — two copies would have parted company on the first deal or pack
sold, choosing a branch against one basket and debiting another. And a release
now reads `$mv->branch_id` **off the movement** rather than re-deriving it, so
stock goes back exactly where it came from instead of putting a Gulberg hold on
Main's shelf.

**A collecting customer is told which shop.** Pickup was always the default
branch, so nobody had to be told; now the system chooses, and the marketplace
allow-list carries the branch name, address and phone. Creating that obligation
and not meeting it would have been the worse half of the change.

Six tests, four mutations. One caught the TEST rather than the code: *the
nearest branch fills it* passed with distance sorting switched off, because the
fallback order is `is_default` then NAME and the branches were called "Gulberg"
and "Johar Town" — the alphabet agreed with the geography. They are now Zamzama
and Airport Road, which disagree. Second time in one day a test of mine passed
against the thing it named.

### 2026-08-25 — the machine slept

Full write-up: `docs/decisions/shopos-the-machine-slept.md`.

A full browser run came back with **eighteen failures and a test that had taken
41.4 minutes against a five-minute deadline**. Read straight: a screen that
hangs the browser, and a till that has stopped taking cash on two of four
devices. Neither was true, and nothing was wrong with the product or the suite.

The lid closed at 10:34 on 4% battery and the machine slept for forty-seven
minutes. That one fact makes both halves of the report: the long test was
asleep for most of it, and the run drifted past the **sixty-minute token TTL**,
so everything after the wake failed in about a second on a 401 — which looks
exactly like a broken feature. Re-run awake: **40 passed in 3.9 minutes**, same
screens, same viewport, reviews and subscription included.

Every cheap theory was wrong and each cost a measurement to kill — the four
layout rules ran in **225ms** on the "hanging" page, phone and tablet-landscape
passed the same screens, and the page was fine at 810px. The tell was **run
order, not viewport**: everything before the sleep passed, everything after it
failed, and `selling.spec.ts:260` passed on one project and failed on the next
minutes later, straddling the moment the token died.

**The rule.** Playwright kills a test at its timeout, so no amount of slow code
can produce a duration past it. *A duration beyond the timeout is not a
measurement of anything the test did — it is the wall clock moving while the
test stood still.* A detector with no false positives from slowness, because
slowness is capped by definition.

`e2e/clockReporter.ts` now says both things where the failures are printed:
"the clock moved while the run did not" (names the test, points at
`pmset -g log`, says to re-run under `caffeinate -i`) and "this run outlived its
own login". **Neither fails the run** — the job is to stop a red run being
*misread*, not to add a new way to be red. Five tests in
`e2e/clockReporter.guard.ts`, three mutations proven; the load-bearing one is
the teardown slack, without which every genuinely timed-out test would be
reported as a sleeping machine.

Second instance of `shopos-token-lives-one-hour.md` (97 sweep "bugs" were one
dead credential), and a fourth entry for `shopos-measurement-that-lied.md`:
wrong cwd, unquoted heredoc, soft-deleted target, **machine asleep**.

Two traps met on the way, both worth avoiding next time: **killing a run
destroys the previous run's evidence** — Playwright wipes `test-results/` at
startup, so the 41-minute test's trace was gone the moment the next probe
started. And **`--timeout=60000` on the command line breaks `auth.setup.ts`**,
which deliberately waits 65 seconds out for `throttle:auth`; the 300-second
global timeout exists for that one reason. Set a timeout inside the spec.

### 2026-08-25 — nine screens, one bug, and a rule that named the wrong thing

Full write-up: `docs/decisions/shopos-a-header-that-would-not-yield.md`.

Nine screens sat behind a trade the mart fixture does not have — the forecourt,
fuel deliveries, tanks & pumps, the dispensary, the bay board, vehicles,
warranty, reservations — and had **never been opened by a browser at all**. Five
projects, one per trade, each signed in as a QA-sweep shop that has it.

**First walk: seven of nine failed, and all seven were the same bug.** The top
bar's row had nothing willing to give way — the right-hand controls are
`shrink-0` on purpose and the search box was pinned at `xl:w-[430px]` — so a
shop whose header carries one control more than the mart's could not fit 1280
and every screen it has scrolled sideways.

Two classes fix it: `min-w-0` on the search wrapper and `xl:max-w-[430px]`
rather than a fixed width. A search box that narrows is fine; a page that
scrolls sideways is not.

**The rule named the wrong culprit twice more**, making four. It skipped
`position: fixed` elements but not their CHILDREN, so a closed appearance drawer
parked off-screen right was blamed on every screen in the shop; and a parent
stretched by a child reaches exactly as far as the child, with document order
putting the parent first, so `>` kept naming containers instead of the thing
that refused to shrink.

The two earlier misattributions were already in the rule's docblock, and that is
why the third and fourth were recognised as the same shape in minutes rather
than believed.

Also: the till's product cards and the cart were the same `bg-white`, so a
four-column grid read as one white mass on the navy ground — the shop's words
were *"sari screen white lag rahi"*. Not returned to a tint (a translucent panel
on a dark ground has no edge at any opacity, which is why these became solid
plates); the shelf gets `--color-pos-card` one step below white and **the cart
stays the brightest thing on the till**, which is where money is counted.

### 2026-08-24 — a kitchen runs out, a chain does not

Full write-up: `docs/decisions/shopos-one-branch-runs-out.md`.

Eighty-sixing belonged to the SHOP, so a chain had one switch between its
kitchens: Gulberg lost its last pizza bases, the chef took the pizza off, and
DHA — with a full tray — stopped selling it too. Third dimension in a week
(product → size → branch), each added after the one before proved a dimension
short of its own subject.

**The columns went.** Keeping `products.sold_out_at` as "off everywhere" beside
per-branch rows would be two places holding one fact, and this codebase has paid
for that shape repeatedly. `branch_sold_out` has no `is_sold_out` column either:
the row's existence is the fact. Every existing flag was migrated to a row per
branch, so nothing came back on sale during the deploy.

The **operating** branch writes it (never the read scope) — the same rule
receiving a delivery follows. The dine-in tab asks the TICKET's branch, because
a manager covering two sites may have their context on the other one.

**The online door answers from Main, and that is a consequence rather than a
design.** Nothing on `orders` names a branch, so Main is the shelf it draws
from. Measured before any of this: Main=0, Gulberg=10, an online order for two →
`422 "Insufficient stock: only 0 in stock."` A refusal on a full shelf one
branch over. **Still open, and a product decision**: nearest branch, a chosen
online branch, or a shop-wide pool.

**The silent press was found only in a browser.** The backend was right and its
24 tests were green; an item with no sizes opens no sheet, so the press landed
with no word at all. In a chain a chef could not tell whether they had closed
their own kitchen or the company. The server's reply already carried the branch
and nothing was showing it.

Two things caught before they shipped: the migration dropped a column while an
index still named it (the CI down-migration gate's exact shape), and `pint app/`
was run against the standing paths-only rule, reformatting 27 unrelated files.

Gates: backend **2210 / 9303** · panel **1137 / 90** · browser **200 passed**.

### 2026-08-24 — thirty-two screens no browser had opened

Full write-up: `docs/decisions/shopos-thirty-two-screens-nobody-opened.md`.

`chrome.spec.ts` walked **14 of the shop's 48 screens**. The other 32 had never
been opened by a browser at all — not a lower standard on them, **none**. That
is the same gap that let the kitchen board show dockets for cancelled tabs for
six days: the screens nobody looks at are the ones nothing is measured against.

Twenty more went in, and the first walk found two things.

**A modal is supposed to cover the page.** `/tenant/products/new` reported the
whole sidebar as unpressable behind a backdrop — all correct, because the
product form IS a dialog. The rule had never met one. It now judges only what is
inside an open modal, and still judges THAT: proved by planting a cover over the
dialog's own Close button, which is one of the defects this suite exists for.

**Eight controls announced as "edit text, blank"** — activity's two filters and
two date boxes, the orders and documents status filters, and NewSalePage's
**Discount and Amount paid**. Two money boxes side by side, labelled by a
`<span>` rather than a `<label>`: visible and silent. A discount typed into
amount paid is a bill that balances and is wrong. The `shopos-label-not-attached`
pass fixed what it could see; these screens were in nothing's field of view.

Standing figure: **0 of 758 visible controls across 34 screens**, up from
0 of 346 across 14.

Still uncovered: the trade-gated screens (forecourt, dispensary, workshop, bay
board, vehicles, warranty, riders, portfolio, reservations). Each needs a
fixture shop of that trade — the same fix as the `restaurant` project.

### 2026-08-24 — a pass is not a gate, and eight lines that lied

Full write-up: `docs/decisions/shopos-a-pass-is-not-a-gate.md`.

"CVE pass still owed" sat on the backlog for weeks and took two commands:
`composer audit` clean, `npm audit` clean. **That result is worth almost
nothing on its own** — an audit that was clean in August says nothing about
September, because the point of an advisory is that it is published after
somebody last looked. Both deploy workflows run it as a gate now.

Proven by POLARITY rather than by a clean run: `0 vulnerabilities` and *the
audit never ran* print identically, so the gate commands were pointed at
`minimist@0.0.8` and `guzzlehttp/guzzle@6.5.0` — exit 1 — and at our two repos —
exit 0. The first attempt to prove it reported `exit=0` on the vulnerable
project, because `$?` after a pipe is **tail's** exit code.

**And the backlog itself was audited.** Every "still pending" hook in
`MEMORY.md` was measured against the code, and **eight** described work that had
already shipped: variants editable since 23 Aug, recipe/BOM, dine-in POS UI,
inclusive tax, offline shift open/close, serial-on-receive, per-serial returns,
all four pharmacy items, Web Serial ESC/POS, and branch names on record screens.

The cause is structural, and it is the codebase's own lesson turned on the
notes: a hook carrying a STATUS is a copy of a fact living in the file, and
copies drift — silently, because the file stays right and nobody opens it.
`shopos-qa-sweep-aug09` had already recorded this exact failure ("check the
file, not this line") and the shape returned anyway, because that fix was one
line rather than a rule. **A hook says what a memory is ABOUT; status lives in
the file.**

What is genuinely left, verified against code: staff receive no operational
notifications (`notifyTenantOwners` is the only broadcast and it selects
`ShopOwner`), the two-week offline shadow RUN, and the 72-hour soak.

### 2026-08-24 — a docket outlived its tab

Full write-up: `docs/decisions/shopos-a-docket-outlived-its-tab.md`.

The e2e suite had no shop that could hold a dish — the fixture is a mart and
`itemTypesFor('mart')` is `["physical_product","deal"]` — so the floor, the tab
and the kitchen board had **no browser coverage at all.** Giving the suite a
restaurant meant building a fixture that puts a real ticket on the pass, because
a board with nothing on it passes every layout rule ever written. Reading what
was already on that board found the bug:

```
9 dockets on the pass — EIGHT belonging to tabs that had been VOIDED,
two of them fired six days earlier.
```

`cancel()` voided the tab and its line items and never touched the KOT rows;
`boardQuery` filtered on the docket's own status alone. The dashboard was worse
— `kot_waiting` counted `whereNull('served_at')` with no filter at all, so the
number an owner reads to know what the kitchen owes grew by one every time
anybody cancelled anything and never came down.

One rule now, `KitchenTicket::scopeForAnOpenTab`, read by both.

**Cancel writes, settle does not.** Cancel is a known fact — this food will not
be cooked or paid for — so the docket is written `void`, except anything already
`served`, because cancelling a bill cannot un-cook food. Settle is not a fact
about the kitchen at all: a tab being paid says nothing about whether anyone
pressed Ready, and writing `served` would put a claim in the kitchen's record
the kitchen never made. The board judges instead.

There is a `restaurant` playwright project now, signed in as
`sweep-food-restaurant@qa.test`, running `food.*.spec.ts` and
`recipe-size.spec.ts` and nothing else. The recipe spec no longer skips — it
FAILS if the shop cannot keep a dish, which is the point of the project.

Four fixture traps on the way, every one of them the harness rather than the
product: `tables[0]` was occupied; `fire`'s response `data` IS the kots array;
cleanup ran after the assertions so four failing runs stranded four open tabs on
a real floor; and `kot_number` is a per-tab sequence, so `KOT #1` matched five
cards.

Gates: backend **2205 / 9281** · panel **1137 / 90 files**.

### 2026-08-24 — when a Large uses more than a Small

Full write-up: `docs/decisions/shopos-when-a-large-uses-more.md`.

Measured before designing, through the real API. A sized dish with a `2 dough`
recipe: **one Small consumed 2, one Large consumed 2.** Nothing refused,
nothing logged — a recipe belonged to a DISH, so a pizzeria's ingredient stock
was right for one size at most and its food cost was wrong for every other.
`bomSnapshot()` had written the fact down itself: *"A recipe has no sizes and
passes null."*

A size's rows now **override** the dish's rows — not add to them, because
addition cannot express the ordinary case of a Large using more of the same
flour. A size that names nothing falls back to the dish's own rows, which is
what every recipe in the database is, so nothing that worked stops working.

One answer, `App\Support\RecipeFor`, for four readers: the counter deducts it,
the return restores it, the BOM snapshot records it and `RecipeCost` prices it.
The snapshot is the one that would have bitten quietly — it is what a refund
restores, so a returned Large would have put a Small's flour back.

**Warned, not refused**, unlike the deal case: a deal with no size was
unsellable, while a sized dish with one recipe sells fine and just deducts
wrong. Refusing would break every shop that wrote a recipe the only way the
software allowed.

`distinct` came off the ingredient id for the second time in a week — the same
flour once per size is the commonest sized recipe there is, and the pair
(ingredient, size) is what must be unique.

And one thing I had wrong: I read `OrderService`, saw no recipe branch, and was
about to file "the online door consumes nothing". The probe said it deducts at
COMPLETION — it only skips the placement-time hold.

**The e2e for this cannot run.** The fixture shop is a mart, and
`itemTypesFor('mart')` is `["physical_product","deal"]`, so a food spec asks the
server for a dish, is refused, and skips forever while printing as a line in a
green run. `e2e/skipReporter.ts` now separates skips **by project** (a flow
proven once, not four times) from skips **by what the shop or server said**,
and names the second kind with its reason. A food fixture shop is owed: until
there is one, dine-in, KOT, menu hours and recipes are proven by backend tests
only.

Two more found while writing this up, both in the audit trail shipped hours
earlier. Activity could filter to **Products** and no further, so an item's
eleventh-oldest price change meant paging every product change in the shop —
while the server had accepted `?record=` since the panel was built and nothing
passed it. And the trail **never named WHICH one**: rows read `Product ·
Changed · price 180 → 210` with no subject, though `subjectName()` had been
written for exactly that and the panel's type did not declare the field. A
writer with no reader, arriving in the same commit as the thing that needed it.

Gates: backend **2199 / 9236** · panel **1137 / 90 files**.

### 2026-08-24 — the Large ran out, the Small did not

Full write-up: `docs/decisions/shopos-the-large-ran-out.md`.

Eighty-sixing was a decision about a PRODUCT. A pizzeria out of large bases had
one move: take the whole pizza off — **Small and Medium with it, all evening, on
the busiest item on the menu.** A size is what a customer orders and what a
kitchen runs out of, so a size is what has to be markable. The product-level flag
stays: "no pizza tonight" is a different sentence from "no large".

The rule lives once, in `App\Support\SoldOut`, because three paths sell — the
counter, an online order and a dine-in tab — and a two-part rule written three
times is three chances for one of them to check the product and forget the size.
That has cost this shop before: `ITEM_SOLD_OUT` once lived on the counter alone
and the tab printed a kitchen ticket for a dish that was off.

**The size is asked first.** "No large, but we have medium" is a sale; "no pizza"
when only the large ran out is a lost evening.

`trusted` is deliberately not a parameter. A dine-in settle and an online
capture are food already eaten — those paths simply do not call the rule, out
loud, rather than passing a flag that hides the choice.

The chef presses it on the same row button, which now asks *which* when there is
a which. Not in the product editor: a chef is not opening a thirty-field form
twice a day.

The mirror carries `sold_out: boolean`, the till carries `sold_out_at`, and
`browse.ts` translates — **absence reads as "on"**, so a device that has not
synced since this shipped sells rather than refuses.

Gates: backend **2189 / 9193** · panel **1137 / 89 files**.

### 2026-08-24 — which pizza is in the Family Deal

Full write-up: `docs/decisions/shopos-which-pizza-is-in-the-deal.md`.

Probed before designing, on a shop holding ten Small and ten Large:
`PARENT stock: 0 · effective: 20`, and the sale came back **422 "Insufficient
stock: only 0 in stock."** Not a wrong number — a refusal on a full shelf. Any
deal containing a sized product was unsellable.

Three places, three answers: `combo_items` gained `variant_id`; a deal that names
no size is now refused at SAVE, where somebody is looking at it, rather than
discovered at the counter; and all four sites that move stock for a combo (POS,
online, refund, and the BOM snapshot) name the size.

`distinct` came off the component id — "two Small and one Large" is an ordinary
deal, and the pair (product, size) is what must be unique, which a rule cannot
express.

Gates: backend **2183 / 9167** · panel **1132 / 89 files**.

### 2026-08-24 — a code for each size

Full write-up: `docs/decisions/shopos-a-code-for-each-size.md`.

The till has resolved a scan to one SIZE through `product_barcodes.variant_id`
since the column existed, and **nothing ever wrote it**. A drinks shop could not
put the 500ml's EAN on the 500ml and the 1L's on the 1L — the entire reason those
codes are printed differently.

Writing it exposed three more, each of them correct in a world where no barcode
row could name a variant: the parent match swallowed the code so the variant
fallback never ran; replacing the alternates deleted every size's code; and the
payload omitted `variant_id`, so the panel's "Additional barcodes" box would have
listed each size's code and saved it back as the product's.

The grid's column had been headed "Code / barcode" while storing the SKU. Two
columns now.

`BarcodeNamespace` owns both the uniqueness rule and the writer, because there
are TWO paths that create variants and the first version wrote barcodes on edit
and not on create.

Gates: backend **2176 / 9142** · panel **1132 / 89 files**.

### 2026-08-24 — who works where

Full write-up: `docs/decisions/shopos-who-works-where.md`.

`ResolveBranch` pins staff to `users.branch_id` — a header cannot move them,
their reads are that branch, their sales draw down its stock. **The panel never
once set it.** The word "branch" did not appear on the staff screen at all, so
every staff member in every multi-branch shop fell back to Main and branch two's
cashier rang on branch one's shelf.

The worst version of built-but-unreachable: nothing looks wrong. No error, no
empty state, no 403 — a second branch quietly selling the first branch's stock,
with reports that reconcile perfectly against the wrong site. The Help Centre had
been promising the behaviour the whole time.

And the other half: `BranchSwitcher` returned null for staff and nothing else
named the branch, so a person counting a drawer had no way to check whose drawer
it was. They get a read-only label now — the pin is the owner's decision, and a
switch the server ignores would be worse than silence.

Also fixed: the panel's own `User` type had no `branch_id`, so the field arrived
from the server and was dropped.

Six backend tests (removing `branch_id` from `$fillable` kills three — the update
path only calls `fill`), three panel tests, and an e2e that fills the real form
and asks the server what it received.

That e2e then found a second bug on its next run: **re-hiring somebody you had
removed was impossible.** The validation exempts trashed rows from the email
uniqueness and the DATABASE index did not, so it crashed with a raw SQLSTATE
where a sentence belonged. Index is `(email, deleted_at)` now.

**Gap 3 closed the same day.** The four screens that STORE a branch now name it —
expenses, income, disposals, movements — through one shared `useBranchColumn`.
`null` reads "Main"; an id not in the list reads "—" and deliberately does not
fall back, because printing the wrong shop against a record of money is worse
than printing nothing. Purchase orders and the cashbook are excluded on purpose:
neither table has the column.

### 2026-08-29 — what this item used to cost

Full write-up: `docs/decisions/shopos-what-it-used-to-cost.md`.

Every other money authority had been auditable for a while — tax rate, coupon,
credit limit, group discount. The one a shop exercises DAILY was not on the list:
`Product` used no `Auditable` trait at all, so sugar went 180 → 210 and the only
record of 180 was the screen it was typed over.

The hard half was not recording it. A catalogue makes the trait's own warning
twice as sharp, so most of the work is about what must NOT be filed: an item
arriving with a price is not a price change (`auditCreate()` false), a rename is
not a money decision (`auditOnly` = the three selling prices), and an import of
340 items is ONE act — suppressed per row and recorded once, because suppressing
without recording would be making a write quiet.

`cost` is deliberately absent: it re-blends on every delivery, so auditing it
files a row per line per goods-received, none of them a decision. The purchase
order line is the truer record of what was paid.

Two things had to change underneath. The trail filtered by kind, person and date
but NOT by subject — the one question a shopkeeper arrives with — so `?record=`
was added. And `audit_logs.auditable_id` was NOT NULL, so an act about a KIND
(an import) could only be filed by pretending it happened to a row.

It shows under the price boxes on the item, gated by the Activity rule from the
same map: a stock keeper can change a price and is not shown who else has, and
for them the section renders nothing rather than appearing and 403ing.

**And two harness lies in the same run, both mine.**

The first full sweep after this printed 849 ok and **97 bugs** — every one a 401.
Measured: 100 of 107 cached tokens were dead while `personal_access_tokens` still
held 2,290 rows, so nothing had been deleted. `config/sanctum.php` says
`'expiration' => null`, which is why reading it proves nothing: **the expiry is
set per token, `created + 1 hour`, and a full sweep is longer than an hour.** The
client now renews on 401 and retries once, returns a status no route ever issues
if that fails, and `run.py` fails the run out loud rather than printing a summary
that cannot be trusted.

The second: phase T's new price check re-priced `state["product"]` — the item
every other phase SELLS — so the next run's baskets failed against phase C's
literal tenders and six shops reported six product bugs. The repair was then
worse than the damage: a script flattened every "Sweep %" product to 500,
destroying the fixtures whose distinct price is their fingerprint (Sized Item 111,
Shelf Lot 1200, Serialized 1500, Petrol 280) — 88 rows, restored from the phases
that own them. Phase T uses an item of its own now, and
`phase_c._ensure_product` puts the price back beside the restock it already did.

Gates: backend **2162 / 9108** · panel **1122 / 88 files** · Playwright **107
passed, 24 skipped, 0 failed**.

### 2026-08-23 — page two, asked of the list instead of the folder

Full write-up: `docs/decisions/shopos-page-two-per-list.md`.

Three defects inside the limit `unreachable-pages.py` had written into its own
docblock — the escape hatch credited to a FOLDER, not to a LIST.

**A buyer could not reach their own older reservations.** Server `paginate(15)`,
client `reservations: () => apiGet(…)` with no argument. The rows that fall off
are the oldest, which is where a forgotten hold sits — stock off the shelf for
somebody whose only way to cancel has scrolled away.

**`useMyOrders` took a page and no screen gave it one.** Hook sends it, keeps
previous data; the screen called it bare and rendered no pager. Built, tested,
wired to nothing — the eighth time.

**Stocktake repeated the workshop lesson.** `useStockCounts()` sent no page
against `paginate(25)`, and the folder passed as "search only" — crediting the
item lookup on the count SHEET next door. This list has no search box at all.

The scanner now asks two questions the folder cannot: can this CALL's request ask
for anything but page one, and does any hook offer a page nobody asks for.
Getting it right cost more than the fixes — 5 of the first 6 findings were the
detector's fault, widening the resolver made it blind to its own mutation twice,
and `if ".test." in f.name is False` is a chained comparison that emptied the
file list while printing a clean-looking zero.

Gates: panel **1122 / 88 files** · tsc, eslint (0 errors), build clean.

### 2026-08-23 — a rail you can read, and a name of our own

Full write-up: `docs/decisions/shopos-a-rail-you-can-read.md`.

**The collapsed rail could not be read.** Counted across eight trades × two
modes: **22 icon collisions in 16 menus.** POS = Sales in all eight; a
restaurant showed one picture for Kitchen, Day & banking and Quotes. The rail is
the default on a tablet and shows no words, so that is two different screens
looking identical at the moment somebody chooses between them. One picture per
concept now, held by `navRail.test.ts`.

Two more came from looking rather than from the test, and it could not have found
either: Help Centre printed blue (`info.svg` had `#0BA5EC` hard-coded) and
Branches wore the same cube as Products — different components, same drawing.

**Simple mode did not know what the shop does.** It was one list gated on modules
only, so a restaurant had Dine-in and no Kitchen, a workshop had Products and no
board, a chemist had no register, a station had no forecourt — the screen each
of those shops opens first and closes last. The trade's daily screen is now in
both modes from one definition. Simple ⊆ Full still holds.

**The sidebar's collapse button is gone** — the same control the header already
carries, four centimetres away.

**CartZe.** The product has a name and a domain (cartze.shop): 105 strings, the
manifest, new app icons, and a `<title>`, of which there had been none — the tab
said "localhost". The wordmark is now a COMPONENT, not an .svg: an SVG in an
`<img>` is its own document, inherits no font, fetches no webfont and knows
nothing about dark mode, which is why there were two files forever one edit
apart.

**Appearance.** The tab widens on hover and says its name (width animates, not
position — a tab that slides out from under the pointer aiming at it is worse
than a silent one), and Save has three states with three pictures, including a
tick that draws itself. Reduced motion keeps the tick, drops the journey.

Gates: panel **1122 / 88 files** · Playwright **105 passed, 18 skipped, 0
failed** · tsc, eslint (0 errors), build clean.

### 2026-08-23 — five copies of one rule, and a banner that lied

Full write-ups: `docs/decisions/shopos-the-menu-and-the-door.md` and
`docs/decisions/shopos-saved-that-saved-nothing.md`.

**The Kitchen preset could not open the kitchen board.** `kitchen.manage` exists
so a kitchen hand need not be shown the shop's takings to mark a curry ready, and
the preset grants nothing else. Four surfaces offered them the board — sidebar,
dashboard, trade panel, notification deep link, all reading `screenPermissions` —
and the route guard required `sales.manage` and redirected them home. **The one
screen their job is made of.**

`RequirePermission` took ONE string across 27 wrappers, so the four screens whose
rule is ANY-of could not be written there at all, and all four had drifted the
same way: kitchen, suppliers, purchases, activity. Checked against `route:list` —
**the map matched the server every time; the fifth copy was the only wrong one.**
The gate now reads its own location and asks the map, which is what
`RequireAdminScreen` already did on the admin console.

**"Saved with warning" on a save that never happened.** An online item with no
description: the form set a warning and returned — no request — and the banner
that renders warnings is hard-coded "Saved with warning". A shopkeeper corrects a
price, reads that it saved, closes the drawer, loses the edit. Measured on the
shop it was reported on: **4 products, all 4 online, all 4 with no description —
not one price could be corrected.** A refusal now says "Not saved"; on edit it is
no longer a refusal at all (the item is already online, so blocking the save only
stops unrelated work); create still blocks.

**Two of my own specs were breeding.** `chrome.spec` failed on four viewports
about a screen that worked: both variant specs named their fixture
`` `E2E … ${Date.now()}` `` and left one more behind every run — 9 shirts and 4
pizzas, all SIZED — crowding plain products off page one of the till, where the
cart test needs eight. Fixed names, cleared before use, 13 strays swept.

**The report that started it was not a bug.** "Edit main variants show ni ho
rahe" — reproduced the exact shape (variants from the API, no recorded axes) in a
real browser by both routes; the tab appears and the grid rebuilds. The running
copy was old. Which is its own finding: the service worker is `prompt` and a
browser looks for a new one **on navigation** — and the till is the one screen
nobody navigates, opened Monday and used until Saturday. `updateWatch` now asks
hourly. The reload is still the shopkeeper's decision; only the offer now reaches
them.

**New guard:** `docs/qa/screen-permission-drift.py` — does every screen's rule
exist on the server? 40 of 43 agree, 3 named exceptions, `--prove` fails if the
planted drift is missed. It caught its own first version, whose regex could not
read a nested `<Route>`.

Gates: backend 2154/9081 · panel **1098 / 87 files** · Playwright **105 passed,
18 skipped, 0 failed** · tsc, eslint (0 errors), build clean.

### 2026-08-23 — a size nobody could add

The size picker made variants sellable; this made them creatable. Three scouts
read the product form first, and the first thing they found made the rest
academic.

Full write-up: `docs/decisions/shopos-a-size-nobody-could-tap.md` (second half).

**`+ Add variant` was a submit button.** No `type`, `Button` had no default, and
the HTML default inside a form is submit. So pressing it created the product with
**zero variants** and closed the drawer — and reopening lands in edit mode, where
the section was hidden. **The variant editor had never worked once.** Every
variant in the system came in through the API, including the e2e fixture, which
is why nothing caught it. `+ Group` and `Save modifiers` had the same omission.

Of **305 `<Button>` usages in the app, exactly one asked for `type="submit"`**, so
the default was backwards. `Button` now defaults to `"button"` and the nine real
submits say so. The rule that sorted 22 bare buttons across 10 files: a `<Button>`
with its own `onClick` is never the submit; a bare one inside a form always is.

**What replaced the editor.** Name the axes — Colour: Red, Blue / Size: S, M, L —
and the twelve rows are generated. Regeneration keeps every price already typed,
matched by name, so adding Black after pricing six rows loses nothing. Real `<th>`
headers (from the stock count sheet, the only editor here that keeps column names
visible past row one), one-tap values per axis, "Apply to all" that disables when
it would be a no-op, and a name on every cell — `Price for Red / S`, not twelve
boxes all announced as "Price". The trade's axis names already existed and were
being spent on one line of grey hint text.

**And the backend that makes it more than a create form.** A grid you cannot
reopen is worse than no grid, so editing was built too: `SyncProductVariantsAction`,
rules on `UpdateProductRequest`, four lines in `UpdateProductAction`. It **touches
the parent** — the offline delta is keyed on `products.updated_at`, so without it
a retired size keeps selling on every offline till and each queued sale dies on
sync, non-retryably, after the cash crossed the counter. It **never
force-deletes** (five cascades, `stock_movements` among them). It **refuses to
leave a product with no sellable size**. `PUT /products/{id}` used to answer
**200 "Item updated"** and discard every variant.

**A scanner, from a question.** Nearly wrote `$product->branch_id` — a column
`products` does not have, which Eloquent answers with null, silently, for ever.
Asked "then it could be missed on other pages too", which became
`scripts/silent-nulls.py`: 836 reads judged, 1,816 honestly counted as unjudged.
**One real finding** — `Sale` had no `customer()` relation while
`sales.customer_id` had existed since the table was created, so
`SendSaleReceiptAction` would have thrown on its first line. It has no callers, so
it never had: SMS/email receipts were built, wired to nothing, and would have
failed the moment anybody wired them.

Also this session: grid tiles were unequal widths (my own regression — wrapping
the tile stopped it being the grid item, and a `<button>` sizes to content);
sizes moved out from under the cards into the sheet only, at the shop's request,
with "from" in front of a sized item's price; and the update prompt got a brand
rail, an icon and a two-word heading without becoming a modal.

Gates: backend **2154 / 9081**, panel **1081 / 85 files**, Playwright four
viewports.

### 2026-08-22 — a size nobody could tap

The ask was small: tapping an item at the till should ask **which size**, as
buttons, and take that size's own price — chips on a tile where there is room, a
sheet on a row where there is not, and the same on the dine-in tab. Scouted
first, which turned it into a different job.

Full write-up: `docs/decisions/shopos-a-size-nobody-could-tap.md`.

**Everything except the question was already built.** `ProductVariant` with its
own price, cost and stock. `BusinessTypes` naming the diner's variant attribute
"Size". Server pricing from `variant->price`, proven by `SalesTest`. The dine-in
path complete end to end — validated, priced, snapshotted, "Half"/"Large" printed
on the KOT and the kitchen display, carried into the sale on settle, with a test
asserting 800 + 1400 = 2200 through all of it. The offline mirror pricing the
same way and refusing an unknown variant. `addLine(p, variantId, name, price)`.

And the tap handler: `if (p.modifier_groups?.length) openConfig(p); else
addLine(p)`. No variant branch, so every tap sent `variant_id: null` and **the
barcode scanner was the only path in the whole product that could produce a
variant line.** `TabPage.fireAdd` was the same against a server that had been
ready the whole time.

**The bug underneath it.** `Product::effectiveStock()` says the parent
`stock_quantity` of a varianted product is "an orphaned leftover that must not be
read as truth". The till's `shownStock` read exactly that, and the tile is
`disabled` on the result — so a T-shirt with a full rail of S, M and L rendered
**"Out of stock" and unpressable.** Not a display problem: an item the shop could
not sell, with or without a connection. Fifth time this month a rule stated in one
file was contradicted by another file reading the thing the rule warns about.

**And the same size gave two answers depending on the screen.** The offline
projection resolved stock per branch; the online product list stamped no stock at
all, so the till read the shop-wide rollup. `/products` now stamps
`branch_stock` per variant — additive, rollup untouched — through one method the
quick-keys strip also calls, because those two had already drifted.

**One rule, six doors.** A tile, a row, a chip, a quick key, the scanner and the
tab. The fences were on four; the scanner had neither, so the door a mart uses all
day would ring a sold-out dish and an empty shelf in silence. I then wrote the
rule twice myself — PosPage and TabPage, twenty minutes apart, which is exactly
how the 86 rule and the discount ceiling came to disagree between those same two
screens — so it now lives in `src/modules/pos/availability.ts`.

Also fixed on the way: the tab's menu was capped at fifteen items; the tab showed
no availability at all while the server refused; a scanned size was dropped when
the options sheet opened; the pharmacy substitute picker charged the parent's
price for a two-strength medicine; and an always-mounted
`role="dialog" aria-modal="true"` Appearance drawer sat in the accessibility tree
on every screen telling readers the page was inert, tab-order included — found
because a browser test asked for "the dialog" and was handed two.

**A mutation of mine passed when it should not have.** Removing `SALES_MANAGE`
from the cashier preset left the new bay-board tests green — which should have
meant they were vacuous. The mutation was at fault: its anchor matched three
presets and it stripped the permission from the wrong one. Retargeted by line,
the same mutation fails 19 of 28. A mutation that passes is either a missing check
or a missing mutation.

**Not done, and it matters:** a variant cannot be edited, renamed, re-priced or
removed after creation — no route, no request rules, create-only form, `is_active`
read in five places and written in none. A shop must get its sizes right first
time and the Help Centre says so. That is the next thing to build. Nor can a
single size be 86'd, and a recipe has no size dimension.

> **Corrected 2026-08-29 — all three of those were built and this paragraph
> outlived them.** Sizes are editable (`SyncProductVariantsAction`, reached
> through `PUT /products/{id}`, `ProductVariantEditTest` 8/8); a single size can
> be 86'd (`OneSizeSoldOutTest`); recipes have a size dimension
> (`SizedRecipeTest`). Corrected rather than deleted, for the reason given
> further down this file — but note HOW it misled, because the trap is reusable:
> **`grep variant routes/api.php` returns only the sold-out routes**, since a
> size is edited as part of its parent and has no resource route of its own. A
> nested resource is invisible to a route grep, and I read that silence as proof
> and reported a shipped feature as the biggest thing outstanding.

Gates: backend **2146 / 9054**, panel **1057 / 84 files**, browser Playwright over
four viewports with a chip measured on a 390pt phone, a11y **0 of 367** unnamed.

### 2026-08-21 — the estimate that hid the work

Finished the verification lane that died mid-run, this time with three agents
told to answer **CONFIRMED / REFUTED / COULD_NOT_CHECK** — three verdicts, because
the previous run's two-value bucketing reported 22 unchecked claims as refuted.
Eleven confirmed, two refuted, and both refutations were of my own claims.

Full write-up: `docs/decisions/shopos-the-estimate-that-hid-the-work.md`.

**The measurement, which is the part worth reading.** The a11y backlog had been
recorded as "245 form fields with no accessible name" — a static grep of
`<Input>` usages without an `id`. Asked in a browser instead, across the fourteen
screens the layout suite already walks: **34 of 367 visible controls**, of which
**24 were two buttons in the shared header** counted once per screen. Two
`aria-label`s took it to 10; three more took it to 0.

245 reads as a migration. 34 reads as an afternoon. The estimate was the only
thing between them. A count can be precise, auditable and quotable and still be
taken at the wrong layer — a static count of *code* answering a question about
*what a cashier hears*.

And the fix was not 465 edits: `<Label>` is rendered 327 times and `htmlFor`
passed 5 times, so the fields were labelled and *unattached*.
`src/common/a11y/useFieldName.ts` joins them at runtime and **gives up rather
than guesses** — two controls under one label, a label already spoken for, a
label below the field all end with no name, because a field announced as
"Opening float" that holds the closing count lies to the one person who cannot
check it. The 27 label-less search boxes take their placeholder as a real
`aria-label`, stamped `data-name-from-placeholder` and counted **separately** in
the browser rule, so the second-best category cannot hide behind a green tick.

**The scanner with the bug it was written to find.**
`docs/qa/unreachable-pages.py` judges a folder by its own API calls, so
`src/modules/workshop/` — which fetches through `modules/documents`' service —
produced no endpoints, hit `continue`, and was never judged. Behind it, the bay
board read `page: 1` of 25 newest-first job cards: a workshop with 26 open jobs
lost the *oldest* car, the one the board colours amber as overdue, and if the 25
newest were all `received` the Ready column said "Nothing here." while finished
cars waited for collection. The board's whole job is answering *"is my car
ready?"*. It now drains its pages, and the scanner learned a third verdict,
`drains all`, beside "pages" and "search only".

Ten minutes later, the same reasoning found the combo and recipe pickers: a plain
`<select>` fed by `useProducts({ page: 1 })` against an endpoint that pages at
**fifteen**. A restaurant writing a burger recipe could choose from fifteen
possible ingredients.

**The rest, briefly.**

| | |
|---|---|
| "Everyone" excluded a whole role | `all` resolved to owners + customers; `UserRole::Staff` in no branch. "Till offline Sunday 2am" reached every owner and no cashier. `tenants` relabelled "Shop owners" rather than widened, so writing to owners alone survives |
| An alert with nowhere to go | `$type === 'stock.low'` is an exact test standing in for a family, so both expiry stages shipped `data.link` null — while `NotifyExpiringStock`'s own docblock said it "Links to Disposals". Third comment-as-implementation this month |
| The panel dropped a link the phone uses | `NotificationDropdown`'s handler only marked read. The resolver now refuses a screen that does not exist and a screen this person may not open |
| The drawer was right, the headline read zero | `deposits_held` summed layaways; a job-card advance is cash in the till that nothing said was the customer's. `balance_outstanding` split out, or the fix would have broken its neighbour |
| A car in the bay with 15 days to live | A two-way ternary over three kinds gave job cards `quotation_valid_days`. It printed "Expired on" and joined the chase list. Billing was never affected — that guard was already fenced |
| Four buckets that swore they added up | Comment said "Mutually exclusive (no double counting)". `suspended` is a status among three date questions; null end dates were in no bucket. Two errors cancelling, so the dashboard stayed plausible. `Tenant::scopePaymentStatus` had it right all along |
| A ledger that outlived its names | Soft-deleting a shop blanked every payment it ever made, while `DeleteTenantAction` promises history survives for auditing |
| A switch no keyboard could reach | `Switch.tsx` was a `<label>` with `onClick` — no input, no role, no tabIndex. A shop without a mouse could not take a till lane out of service |

Also: the POS tender selector carried its selection in hue alone; five till modals
rendered two close buttons in one corner (the shared named one and a hand-rolled
anonymous one); the dish-modifier sheet was the only till overlay never announced
as a dialog.

Gates: backend **2140 / 9039**, panel **1042 / 83 files**, browser **91** across
four viewports, a11y **0 of 367** unnamed. Every fix mutation-tested.

### 2026-08-21 — three agents, and a harness that mislabelled its own failure

Ran three read-only subagents — the pharmacy's paths, accessibility as a class,
the API areas the sweep has never driven — each claim to be attacked by a
skeptic before being believed.

**The verify pass never ran.** The session hit its usage limit: 23 of 25 agents
died, every verifier among them. And the workflow script **reported the 22
surviving claims as `refuted`**, because a failed agent returns null and the
script read `!verdict?.real` as a refutation.

> **A failed check is not a passed check, and it is not a failed subject
> either.** Exactly the `HARNESS_NO_TOKEN` lesson from the same morning: a tool
> that cannot do its job must say so rather than answer anyway. Three verdicts,
> never two.

So the claims were treated as unverified leads. Four verified by hand and fixed,
two verified and downgraded, one referred to the owner, the rest recorded
untouched.

**Verified by measurement — the shared form controls had no route to a name at
all.** Not "many fields are unlabelled": 360 uses of `<Input>`, **two** passing
an `id`, **five** `<Label htmlFor>`, and no `aria-label` prop on the component.
A field's name was its placeholder, and a placeholder is not a name — it
disappears the moment somebody types. `Input` and `Select` forward
`aria-label`/`aria-labelledby` now.

**Verified — `Alert` had no role and no live region.** "Sale failed" after a
button press was announced to nobody, while the till blocker ten lines away in
`PosPage` does carry `role="alert"`.

**Verified — this morning's Modal fix was half a fix.** `role="dialog"` +
`aria-modal` with no accessible name and no focus management: an unnamed dialog
announces as "dialog", and `aria-modal` declares the page inert while focus is
still standing in it. Named from the dialog's own heading — 107 call sites, every
one already renders one, so nothing to pass and nothing to forget. *A reviewer
who did not write the fix found the half that was missing; that is the argument
for the verify lane, and it is the lane that died.*

**Verified — the same two date fields, one component, two paths.**
`MoneyFilterBar` ties its labels in the desktop bar and the mobile drawer had a
visible label associated with nothing. This codebase's oldest bug shape wearing
an accessibility hat.

**Verified then downgraded — the advance the API threw away.** `deposit` is read
only inside `if ($isLayaway)`, so a job card's advance was validated, accepted
and dropped. But the panel never sends it and `POST /{document}/deposits` works,
so no shop has lost anything. Refused now anyway: an API that eats a figure it
was given is worse than one that says no.

**Verified then referred — `GET /shop/subscription`** carries no permission and
returns 24 payment rows. Deliberate and documented ("what the shop pays is not a
secret from the people who work in it"), but a payment LIST is more than a
monthly figure, and where that line falls is the owner's call.

**The measured backlog: 245 form fields still have no accessible name**, and the
route to give them one only exists as of today. Recorded with the number,
because a count is auditable and "we should improve accessibility" is not.

Backend **2128 → 2130**. Panel 1022, browser 87, build clean.

### 2026-08-21 — two doors, one drug

A schedule-controlled medicine could leave a pharmacy through the
telephone-order door with no prescription recorded, while the counter three feet
away refused the very same product. Proven, not reasoned — one product, one
shop, one shopkeeper:

```
  drug_schedule='G'  requires_prescription=false
  PHONE order  →  201  (ACCEPTED)
  TILL  sale   →  422  PRESCRIPTION_REQUIRED
```

Two fences reading two different columns: the till asks `drug_schedule`, the
order path asked `requires_prescription`. And on the product form those were
**free-standing fields with nothing tying them together**, so a medicine could
be marked Schedule G with the prescription box unticked and each fence then gave
a different answer about it.

The till's own check carries a comment saying the online case "is the order, not
the till". Right instinct, safe only if the order path refused. It didn't.

> **A comment that assumes another path did the work is a dependency, and an
> unchecked dependency is a hope.** Third time this month.

What it cost: a controlled drug dispensed with no prescriber recorded and
therefore **no line in the dispensing register** — the list a regulator asks to
see. The register was not broken; this door told it nothing.

Fixed in two places, and only one is the fence. **The root is
`Product::booted()`** — a controlled drug that needs no prescription is not a
thing, so the model will not hold that state. In the MODEL rather than the form
because there are four writers, and *a rule enforced in three of them is the bug
this one came from*. A migration backfills the rows written before it; not
reversible, because `down()` would have to guess which rows had the flag off on
purpose and the answer is none. **The fence is `OrderService::place`**, which
now asks about the schedule too — the hook fires on `save()`, so a raw query or
an old import slips past it and the door must refuse a drifted row by itself.

**A mutation that passed taught the useful part.** Removing the order-door check
left every test green, because the model hook answered for it: the fence was
real and nothing pinned it. A test now writes the drifted state past the model
with a raw update, asserts the drift exists, and then orders. Both halves go red
under their own mutation.

**And the scanner had said this was fine, in writing.**
`one-rule-many-paths.py` carried the note *"the order path has its own, stronger
RX_IN_PERSON_ONLY"* — believed, and false; it was written by somebody reading
two error codes and inferring the rest. *An exception on a list of exceptions is
a claim. Check it; do not admire it.*

Backend **2123 → 2128**. Full record:
`docs/decisions/shopos-two-doors-one-drug.md`.

### 2026-08-21 — the offline drawer, driven in a browser

The "still owed" list on the offline shift gap named five things. **Three were
already built and the document did not know it** — `shiftQueue`, `offlineShift`,
`flushShifts` and `PosShiftSyncController` had all shipped, wired into `usePos`
and `pullNow`, with 13 backend tests green.

> **A "still owed" list is a claim, and a claim goes stale.** Read the code
> before believing your own notes; twice this week a document has been more
> pessimistic than the repository.

What was actually missing was that **none of it had ever run in a browser**.
jsdom reports `navigator.onLine === true` no matter what, so every offline unit
test in the suite is an online test wearing an offline test's name — the
distinction that cost this repo five bugs the last time it was tried.

`e2e/offline-shift.spec.ts` drives the loop the way a shop does after a power
cut: reboot with no line, open a drawer, sell, count it out, and only then ask
the SERVER what it thinks happened. **Passes on all four viewports.** Getting
there cost four fixes:

- **The shared `Modal` had no `role="dialog"`.** Every modal in the app was an
  anonymous div — nothing announced when one opened, nothing said the page
  behind was inert, and the close button was an icon announced as "button". It
  also made the app untestable by role: a browser test asking for the dialog it
  had just opened waited five minutes and timed out, which is how this was
  found.
- **A notice raised in the Cart was invisible on a phone.** The till's one way
  of speaking lived inside the PRODUCTS pane, and a phone shows one pane at a
  time. Not hidden by a breakpoint, not missing — *somewhere else*, which from
  the counter is the same thing. Drawn once per layout now, carrying
  `data-pos-notice`. Found by the 390-point project and by nothing else.
- **Ten identical boxes, all announced as "0"** — the close-drawer denomination
  grid, on the screen where a shop counts its own cash. Labelled now.
- **"No held sales" is a false statement offline.** A shop may have ten parked
  tickets; a cashier told there are none rings one again from scratch. Holding
  is server-only by design (the list is site-wide and claiming is a locked step
  so two lanes cannot ring the same basket) — so the till now REFUSES in words
  and the list says it cannot be read, rather than pretending to be empty.
  Refused with words rather than a dead button: *a disabled control on a touch
  screen tells nobody why.*

Also: the **Z-read is provisional offline** — the plan always said so and the
till never did. The close screen now says it, naming how many sales are still on
the device.

**Still not built, deliberately:** holding a ticket offline. Two devices could
each hold and each claim the same basket. That is a design question with money
in it, not a missing feature.

The Help Centre was corrected: it had promised *"you can still park a basket…
but only on this till"*, which was never true.

Browser suite **83 → 87**. Panel 1022 + build clean. The four fixes are all in
shared components, so they land on every modal and every notice in the app.

### 2026-08-21 — the type made entirely of money screens

The per-type coverage table turned up one real gap, and this closes it.

**`finance` has one module: `expenses`.** No till, no catalog. Phase C needs a
till, so it skipped the shop outright — and every phase after C reads phase C's
output, so **17 of 19 phases had never once spoken about it.** The money screens
were covered, on other shops. *The one business type made entirely of money
screens had never been driven end to end.*

It could not simply be added to `sold`: that dict means "a shop that can ring a
sale", and **thirteen phases index `state["product"]` without asking**. So the
fix is a second, smaller mapping — `phase_c.BOOKS_ONLY` — handed only to phase
E, and nothing else changes. Everything there except the khata needs nothing but
a token; a khata charge is a SALE on credit and stays behind the till gate,
which the run says out loud rather than skipping quietly.

`finance` now answers all nine — the full run went 1743 → **1752 ok · 0 to
look at · 0 bugs** — with real figures rather than a no-op: expense
+1234 through summary, cashbook and net profit; income +777; `cashbook balances
— in 1554 − out 2468 = -914`.

**And the gap cannot silently reopen.** Phase E joins `GATES` as `expenses` —
deliberately not `pos` — so the run compares what it covered against every shop
whose modules say it should have. Proven by cutting the route: the summary
answers `E 8 … · SILENT ON: finance`.

> **A coverage gate tests REACH; a mutation tests a CHECK.** This was never a
> check that could not fail — it was a check that never ran, and only the
> denominator could have shown it.

### 2026-08-21 — the sweep asked as nobody

Asked a plain question — *has every business type actually been driven?* — and
ran the whole sweep to answer it. It printed **96 bugs**. Eighty-eight said
`401 Unauthenticated`, and one said "the shop has a Main branch — 0 branches"
about a shop with **eighteen**. None were about the product.

`Api.login()` returns None when a sign-in cannot be had — `throttle:auth` is
5/min per IP and a full run drives about a hundred identities. The phase then
called on with `token=None`, which falls through to an ambient token that was
ALSO None, so the request went out **bare** and the server correctly said 401.
The sibling of the bug `api.py` already carried a long comment about: `NOBODY`
guarded the deliberate anonymous call, and asking as nobody BY ACCIDENT had
nothing in front of it.

- A request that would carry no credentials **does not go out** — status `0`,
  `HARNESS_NO_TOKEN`, a status no route ever returns. `run.py` **fails the whole
  run** if one happens: *a summary that cannot be trusted must not read like one
  that can.*
- A sign-in is the one call that MUST carry nothing, and the new guard promptly
  blocked it. `_login_fresh` says `NOBODY` explicitly now.
- A failed sign-in reports the **server's own answer**. Phase A said "is the
  seeder run?" about an account that logs in fine, throwing away the status that
  explained it. Retries 4 → 10: **a slow run beats a wrong one.**

**Two of the surviving three bugs were mine.** The throwaway probe written that
morning to measure the audit trail had suspended a sweep cashier and set
retail's discount ceiling to 12%, and left both — so the standing sweep reported
`cashier can sign in` and `DISCOUNTS.APPLY ACTUALLY GRANTS IT — 403 above the
12% limit` for the rest of the day. *A probe that mutates a sweep shop leaves the
sweep lying, and the lie outlives the probe.* Restored.

The third: phase G's serialized product is created with fifty units and **never
restocked**, so every run ate one until `Insufficient stock: only 0 in stock`
was reported as a defect. The server was right; the sweep had emptied its own
shelf. "It must stay re-runnable" is this sweep's oldest rule.

**Final: 1743 ok · 0 to look at · 0 bugs**, 19 phases, zero throttle waits, zero
calls made as nobody.

**Per-type coverage, measured rather than remembered.** All 8 trading types plus
`food_restaurant` in 13 of 19 phases; the rest gate correctly on modules (K
needs `inventory`, L `dine_in`, R a listed shopfront, G trade specials).
**`finance` is thin by construction** — its only module is `expenses`, so phase C
needs a till it does not have and every later phase reads phase C's output:
**17 of 19 phases never touch it.** The money screens are covered, but on other
shops. Recorded as a gap, not fixed. The nine legacy codes are deliberately not
swept (*a sweep of an alias is a sweep of its target with a different label*);
`EveryTradeLoadsTest` runs every screen for all 17.

### 2026-08-21 — who changed what

The audit trail recorded who may DO things and said nothing about what those
things are WORTH. Eight sensitive acts driven through the API as a shop owner,
each proven to have changed something first, left three records between them:
the discount ceiling, a staff permission and a suspension. Not recorded: a
customer's credit limit raised from Rs 5,000 to Rs 90,000, a tax rate, a
customer group's discount, a coupon, a price.

Every line in the second half is a MONEY AUTHORITY, and every line in the first
is proof the shop already believed such things were worth recording.
`TaxGroup`'s own docblock says the consequence — "edit the rate once and every
product on it re-rates" — and the difference is owed to FBR.

> A trail that records permissions and not the money those permissions move is
> a trail about the door, not the room.

**And nobody in the shop could read it.** The only way in was
`/admin/audit-logs`, behind `role:super_admin`. An owner got eight rows on the
dashboard, no filter, no dates, no question — while the Help Centre told them,
correctly, that the log records who entered a figure and when. *A record that
nobody named in it can read is not accountability; it is a promise about a
filing cabinet in somebody else's office.* Eighth "built but unreachable", and
the first where the thing out of reach was the shop's own history.

Fixed in two halves:

- **`Auditable::auditOnly()`** — an allowlist, so a model can be audited in ONE
  respect. `Customer` records `credit_limit` and nothing else: a phone number
  corrected at the counter is not an event, and auditing the record entire
  would bury the line that matters. A create counts too, because a limit given
  on day one is the same act as raising it on day two. `TaxGroup`,
  `CustomerGroup` and `Coupon` are audited whole — all low-volume, which is the
  selection rule, not a coincidence.
- **`GET /audit-logs`** + an Activity screen in shop words (`TaxGroup` is a
  class name; "Tax rate" is what changed). Gated on `READS_AUDIT` =
  `settings.manage` OR `reports.view` — an ANY-of set, because the person most
  often being ASKED about is the one holding `settings.manage`.

**Deliberately not audited:** product prices (a five-thousand-row import would
bury the trail in an afternoon — "who repriced this" needs a price history, not
a bigger list), and supplier/branch contact details, which are not authorities
and already carry `created_by`/`updated_by`. Both said out loud in the Help
Centre rather than left to be discovered.

**One regression caught before it shipped.** Moving the exclusion filter earlier
meant an update whose only changed field is `password` would write nothing,
where it used to write a row with empty values. That row IS the signal. The
allowlist swallows a values-less change; nothing else does, and a test pins it
both ways.

**The probe was wrong twice first**, each time with a confident wrong answer: it
read `tenant_id` off `/auth/me` (which nests it under `tenant`), so the filter
became the literal string "None" and returned zero rows; then it keyed the trail
on `(entity, event, id)`, so a SECOND "User updated" for the same user deduped
away and it reported no record having just watched one appear. *Suspect the
detector before the code* — third time this week.

Sweep **phase T**, always two shops: `AuditLog` is not tenant-scoped as a model,
so one `where` in one controller is the entire boundary. Four mutations (40–43).
And `Report.expect` was hardened — it reads a collection `want` as
ALTERNATIVES, which phases S and T both walked into, so the API was the problem
rather than the callers.

Backend **2110 → 2123** (13 new, 8990 assertions). Panel 1022 + build clean.
Full record: `docs/decisions/shopos-who-changed-what.md`.

### 2026-08-20 — the other half of a date

Stock can be dated two ways and only one of them was ever read back. An
`expiry_date` had a shop-wide worklist, a dashboard tile, a counter warning, a
morning alert and a place in FEFO. A `manufactured_on` — the four digits off a
tyre's sidewall — had a badge inside one product's batch drawer, and
`ProductBatch::scopeAgedBeyond` sat with zero callers.

The one with money in it: depletion ordered on `expiry_date IS NULL,
expiry_date`, and a tyre has no expiry, so **every lot in a tyre shop tied.** The
database returned them in whatever order it liked — in practice the order they
arrived — and the newest pallet went out of the door while the 2019 set aged
quietly behind it. `DotCode`'s own docblock states the requirement ("a shop needs
to see the age, **sell the oldest stock first**") and nothing implemented it.

> **A requirement written in a comment is a requirement nobody implemented.**
> The comment is evidence that somebody knew, which is worse than not knowing,
> because it reads as done.

Three fixes, one root — the column was written and never read:

1. **`ProductBatch::scopeOldestFirst()`** — expiry first (a fence), then oldest
   manufactured (a hint), then the undated. One implementation, three callers,
   and the third is why it is shared: the lot a RETURN goes back into has to be
   the lot the sale took it from.
2. **The counter is told.** `pos/lookup` carries `aged` beside `near_expiry` —
   permanently null for a tyre, which is why the cashier heard nothing. Settings
   → Stock ageing had promised "the counter is told" in as many words. It names
   the OLDEST lot, because that is now the lot the customer is actually handed.
   Both notices are branch-scoped through one shared query now.
3. **`GET /inventory/ageing`** + an Ageing stock panel on Inventory. The badge
   answered *how old is THIS lot*; nothing answered *which of my lots are old*,
   and a tyre shop with two hundred sizes was not going to open two hundred
   drawers. Deliberately a quieter colour than the expiry banner: expired stock
   is money already lost, an old tyre is saleable stock in the wrong order, and
   painting them the same red teaches a shop to ignore both.

**Not built, on purpose:** no dashboard tile (an age is not a deadline and a
figure that moves once a month is a tile nobody reads); no morning alert (a lot
crosses "ageing" once in five years, so a per-stage alert would fire once and be
forgotten before it mattered); nothing offline (the sale is correct without the
warning, and the Help Centre says so rather than hiding it).

**Yesterday's scanners could not have found this.** `dead-rules.py` DID find
`agedBeyond` and its own `SETTLED` entry called it *"a GAP, not a defect"* —
wrong, and wrong instructively: it measured a missing FILTER and missed that the
same unread column meant the wrong tyre left the shelf. A "settings nobody
reads" scan was prototyped and thrown away: all 58 keys in
`ShopSettings::defaults()` have a real reader, and `stock_age_warn_years` was
read — once, for a badge. The shape was never "a setting nobody reads" but **a
setting read in one of the several places its own UI copy promised**, and no
scanner reads prose. Measured, recorded as measured, not kept.

**Two of my own tests passed against the bug first.** The insertion-order one
creates the old lot first, so the database gives the right answer by luck; its
mirror is the one with teeth, and both are kept. And every lot helper wrote
`branch_id` null — FEFO matches lots at THIS branch, so none were visible to the
depletion under test. Third time this repo has shipped that mistake.

Sweep **phase S** (the shelf that ages), gated on `features.inventory` rather
than a trade list, 8 of 9 shops. Five mutations (35–39); the sharpest hands the
sweep the exact wrong answer rather than no answer. Two harness fixes on the way
past: `Report.expect` reads a list `want` as *alternatives*, so phase S reported
the exactly-right answer as a query 18 times; and phase C's drawer check assumed
a 1,000 float with no prior takings, so a re-run called the shop's correct
arithmetic a query — it measures the delta now. `dead-rules.py` fails on a stale
`SETTLED` entry instead of printing one and exiting 0.

And the new phase found a fault in an old one. Phase S's shelf item carried the
SKU `SWEEP-SHELF-PETROLEUM`; product search reads the SKU, so it answered phase
Q's search for "Petrol", sorted newest-first ahead of the real fuel, and the
forecourt rate check spent its run trying to reprice a tyre. Which exposed the
deeper fault: **phase Q was GUESSING which product was fuel** — search for
"Petrol", else the first product in the shop, right by luck for as long as nobody
else added one. It asks `/fuel/tanks` now, because a tank names its product and
that is the only authority. *A check that guesses its subject is a check about
whatever happens to be first.*

One more, in my own new phase: its shelf reset zeroed lots with a batch-scoped
adjustment — **exempt from batch accounting by design** — and then deleted them,
which is **refused 422** on any lot still holding stock. The phase was green
before and after, because the lots each check cared about had usually been
depleted by the check before. The fault is narrower and worse than a wrong
answer: **the reset could fail and said nothing.** It disposes of the lot the way
a shop does now and files a QUERY when it cannot. *Setup is not exempt from the
denominator rule just because it is not the thing being tested.*

Backend **2098 → 2110** (12 new, 8947 assertions). Panel 1022, unchanged.
Sweep **233 ok · 0 queries · 0 bugs** on phase S; `mutate.py` **41 of 41**. Full
record: `docs/decisions/shopos-the-other-half-of-a-date.md`.

### 2026-08-20 — the ceiling that stopped at the counter

Two different questions, and only one of them had travelled.
`discounts.apply` answers **may you discount at all**, and it was checked on the
counter, the dine-in tab and the settlement alike. `max_discount_percent` and
`max_discount_amount` answer **how much**, and they were consulted in exactly one
place: `CreateSaleAction`.

The **cashier** preset holds `discounts.apply` and deliberately withholds
`discounts.override`. So a cashier was capped at the till and **uncapped the
moment the same bill was a table.** The ceiling an owner set in Settings was
simply absent from the Floor module. And `SettleTicketAction` rings on the
trusted path — deliberately, since the tab's snapshot IS the bill and live menu
state must not reprice food already eaten — so the counter's check did not run
there either, and a whole-tab discount keyed at settlement went through
untouched.

Fixed with `DiscountCeiling::assert()`: one implementation, the same argument
that produced one `ModifierResolver`. Judged on the WHOLE bill rather than per
line, because the counter has always summed every line discount plus the cart
discount against the subtotal — *ten lines at ten percent give away exactly what
one line at a hundred does.* Voided lines excluded, and both limits still default
to null.

**Found by listing what each selling path refuses and reading the difference.**
`DISCOUNT_LIMIT_EXCEEDED` sat in one column and nowhere else, next to eighteen
others that legitimately belong to a counter (khata, points, trade-ins, IMEIs) —
the signal was in a column where most rows are correct. That comparison is now
`scripts/one-rule-many-paths.py`, beside `dead-rules.py` from the same
afternoon. Nine rules are asked by all three paths and every difference carries a
reason. **The useful moment is not the clean run** — it is the day somebody adds a
refusal to one path and the tool asks whether the other two need it.

The tool was wrong twice. Adding `SettleTicketAction` as a peer collapsed the
intersection to zero, which is the tool losing its most useful line rather than
finding anything; settlement shares the giving-away question only, so that is
asserted by name instead of compared. And extracting the ceiling into a shared
guard moved the code out of all three path files, so a per-file scan would have
read the fix as REMOVING the rule from everywhere — a guard has to be credited to
its callers.

Backend **2098 green**.

### 2026-08-20 — the grep, kept

`Product::scopeSellableToday()` was found by hand. The technique is worth more
than the finding, so it is now `shopos-backend/scripts/dead-rules.py`: every
method whose **name is a decision** — `is*`, `has*`, `can*`, `requires*` — that
nothing anywhere calls. **57 such names, ten uncalled, one a real gap.**

**BUG · a supplier credit could be recorded twice.**
`POST /inventory/disposals/{id}/credit` records what a distributor actually paid
for goods sent back. It checked the permission and the disposition and never
checked whether a credit had already been recorded, so a second call silently
replaced a settled money figure and the "to claim" worklist did not reopen.
`StockDisposal::isCredited()` had existed the whole time with no callers — the
model stated the rule and nothing asked it.

*The screen was already right, which is what hid it:* the "Credit received"
button disappears once the credit is entered, so nobody clicking through the
panel could do it twice. The API is the contract, and a retry or a double tap on
a slow connection is not the panel. Refused (409 `ALREADY_CREDITED`) rather than
kept-first — pressing 86 twice is the same intent repeated, recording two
different amounts is not — and the refusal names what is already on the row. A
khata repayment is append-only so it has no such problem; this is a single slot.

**The other nine were fine, and that is the point.** Seven were one-line
derivations of a field other code reads directly. Two had the rule enforced in
the QUERY rather than the predicate — `OtpService::verify` selects
`whereNull(consumed_at)` under a row lock, so an OTP cannot be replayed even
though `isConsumed()` is never called. So the tool reports **leads, not
findings**, and each carries a line saying which, including "redundant".

**The scanner was wrong twice.** It read 62 of 74 rules as uncalled, because its
pattern excluded `>` to skip declarations — which is how PHP calls a method; it
reported `isSoldOut()` unused an hour after it was wired into three call sites.
Then it could not find the bug it was built from: with the guard deliberately
removed it still reported nothing, because the controller docblock EXPLAINS that
`isCredited()` had sat unused and the grep counted the explanation.
**Comments out, code in** — the rule `confirm/native.test.ts` already had to
learn. `--prove` asserts both by name before it reports anything.

Backend **2094 green**.

### 2026-08-20 — nine screens where page two did not exist

The coupon query the sweep raised turned out not to be about coupons.

**Thirty-seven endpoints paginate.** Fifteen screens had hand-written the same
fifteen lines of Previous/Next. **Nine had written nothing** — and on those the
rows past the first page were not awkward to reach, they could not be reached at
all. Owner reviews hold **ten a page**: a shop with eleven could never read the
first review it ever got, or reply to it. Coupons thirty, purchase orders
fifteen, notifications fifteen, transfers twenty, the three fuel lists 15–25.

Three of them had the plumbing built the whole way down and were one argument
short at the top — `useTransfers()` called with nothing, and the fuel hooks
already returning `{ rows, pagination }`. That is the argument for a component
rather than a snippet: **paging is fifteen lines every screen has to remember,
and a screen that forgot looks exactly like a screen with no rows to show.**

Fixed with one `<Pager>` in `components/ui/pager`, now on 24 screens. The
fifteen copies are gone and they had already drifted — `px-5` against `px-6`,
`setPage(page - 1)` against `setPage((p) => p - 1)`, several counting "items"
whatever the rows were. Filters reset to page one, or a search run from page
three of the old results shows an empty table that reads as "no matches".
`CouponController::index` gained a search, because a coupon is found by its code
and by nothing else.

Two smaller things fell out: three cards were their own horizontal scroller, so
a pager inside them scrolled sideways out of view with the table; and
`WarrantyLookupPage` carried `title="Close {closing?.product_name}"` — a quoted
JSX attribute is a STRING, so the merchant was shown that text literally.

**Two guards, in two places on purpose.** `ui/pager/reach.test.ts` keeps the
panel's half true — nobody writes their own, and the shared one is in use on at
least twenty screens (without that second assertion, "nobody writes their own"
is satisfied by an app with no paging at all, which is where this started).
`docs/qa/unreachable-pages.py` answers the question the panel cannot — *does
every list have one?* — because that needs the set of paginating endpoints,
which lives in the backend, and a copy inside the panel would be a second answer
to one question.

**The scanner reported a clean number four times before it was right.** It
believed a type (`{ page?: number }` with nothing passing one — *page state that
never changes is not paging*); it lost every `Route::prefix(...)` when parsing
`routes/api.php`, so eight routes matched nothing and the report said "1 of 12"
and looked healthy; it matched path prefixes, so `/products/{id}/branch-prices`
counted as listing `/products`; and it could not tell `to="/admin/tenants"` — a
link — from a fetch. And judging each folder on its own text called the
notification bell broken *after* it was fixed, because the bell fetches in one
folder and renders in another. Two texts for two questions: what a folder LISTS
from its own source, whether it can REACH from its source plus one hop of
importers.

`--prove` blinds it and requires the result to look blind — zero folders judged,
every route unplaced. **A scan that reads nothing reports "0 problems", which is
character for character what a clean sweep reports.**

`0 of 23` stuck. Backend **2093 green**, panel **1022 green**.

### 2026-08-20 — the dish, and the button only the till obeyed

Phase R gained the two things a food shop does that nothing had ever driven from
the customer's side. The first found nothing. The second found a defect in three
places at once.

**A dish ordered with choices on it.** Every other line on an order is *this
thing, n times*. A modifier is the one place where the customer changes both the
**price** and the **recipe**, and three separate things must all be true while
each fails quietly on its own: the menu SHOWS the choice and what it costs, the
bill CHARGES the shop's own delta, and the line REMEMBERS what was chosen. That
last one is **the failure money cannot reveal** — the total is right to the rupee
and the kitchen reads a plain pizza.

All three hold, along with the fences: a required group cannot be skipped, a
group's limit holds, an option belonging to a different dish is refused. Each
refusal is required to NAME the rule it enforced, because a 422 for having no
stock and a 422 for needing a crust are indistinguishable by status. The
completion hop was driven too — a completed order rings its sale down the
`trusted_prices` branch, which carries the captured price forward rather than
asking the resolver again; re-running it would add the +300 twice or reject an
order the shop has already cooked. It does neither.

`ModifierResolver` is deliberately one implementation shared by the POS and the
online order, which is why none of these checks are about its arithmetic:
**shared code diverges in what it is HANDED, not in what it does.**

**BUG · sold out at the counter, on sale in the app — NOW FIXED.** `sold_out_at`
— "eighty-six the fish" — has its own column, controller, button and eight
tests. All eight ask the till. The question is *may this be sold right now*, and
three places can start selling an item: `CreateSaleAction` refused it,
`OrderService::place` **took the order**, and `AddTicketItemsAction` **printed
the kitchen ticket**. So the cook presses 86, the till stops offering the fish,
and the app keeps taking orders all evening while a waiter puts it on table six.

Worse than an omission: `CreateSaleAction` *deliberately exempts* the trusted
path and says why — an online order is food the customer already committed to,
and refusing to bill it because the kitchen has since run out is a shop that
cannot close its own tab. Right reasoning, safe **only if placement refused
first**. It never did, so for an online order the rule was enforced at neither
end. *A comment that assumes another path did the work is a dependency, and an
unchecked dependency is a hope.*

Fixed in all three, plus `MarketplaceController::publicProduct` now publishes
`sold_out` so the storefront can grey the item out instead of letting the
customer find out at checkout. An order placed **before** the press still
completes — that is the reason the exemption exists, and it now has a test.

**Found by grep, not by a test:** `Product::scopeSellableToday()` had one
definition and zero callers. *A scope nobody calls is a rule nobody enforces.*

Five tests in `SoldOutTest` beside the eight that only ever asked the till; four
red before the fix, the fifth green before and required to stay green. Phase R
asks it from outside of every shop — 86 it, watch both counters refuse, **then
put it back and order it again**, because without that there is no telling
"refused because it is sold out" from "refused because this shop is shut".

**The full run also turned up one query, and it was the sweep's own.** Phase M's
`_coupon()` read the FIRST PAGE of `/coupons` looking for `SWEEP10`. `/coupons`
paginates at 30 with **no search parameter at all**, newest first; the single-use
check on the same page creates a fresh random code every run — correctly, since a
fixed one is spent on run one — and nothing deleted them. Thirty-two piled up,
`SWEEP10` sank onto page two, the create was refused as a duplicate, and the
phase reported it could not make a coupon **it had made thirty-two runs
earlier**. *A lookup that depends on WHERE a row sits is not a lookup.* Fixed at
both ends: create first, fall back to `/coupons/validate`; and the single-use
check sweeps up after itself.

That exposed a real gap, recorded and not fixed: the panel's coupon screen
requests no page and offers no search, so **a shop with more than 30 coupons
cannot reach the rest** to edit, expire or delete them.

**Backend 2091 green · panel 1017 green · sweep 1583 ok · 0 bugs · 36 of 36
mutations caught.**

### 2026-08-20 — phase R, and the actor nobody had ever been

Seventeen phases and 1,683 checks, every one of them run as somebody who **works
at the shop**: an owner, a cashier, a stock keeper, a super-admin. Nobody had
ever been **the person the shop exists for.** Phase R holds a `role:customer`
token and drives `/marketplace/*` and `/customer/*` — addresses, reviews,
reservations and orders.

Three questions it exists for. The **order** prices itself from the shop's
catalog and a price sent by the customer is ignored. The **boundary**:
`shop_slug` and `items.*.product_id` arrive in one body with nothing tying them
together, so an order naming one shop and carrying another's product is a single
request away. And the **owner**: orders, addresses, reviews and reservations are
all "mine", and every one of those controllers scopes by the signed-in user —
reading them says so, and reading is not proving. Two customers exist in the
phase on purpose, because a check that one person cannot see another person's
things is meaningless with one person.

**185 checks across three shops, 0 bugs, 0 queries.** Trustworthy because both new mutations are
caught — pretend every order was accepted and it reports `AN ORDER REACHED INTO
ANOTHER SHOP`; answer 200 to any customer reading any order and it reports
`ANOTHER CUSTOMER READ THIS ORDER`. **29 of 29** sweep-wide, and the full run
is **1566 ok · 0 to look at · 0 bugs**.

Two harness bugs first, both old friends. A **404 read as access** — the role
fence pointed at `/reports/sales`, which does not exist, and the check saw "not
401 or 403" and accused the product; 404 is "no such route", not a refusal,
which is the same mistake phase I made with 403 and `MODULE_DISABLED`. And **the
best check quietly did not run**: the cross-shop probe looked for a second shop
among the ones a customer can SEE, found none of eight, and said so — caught
only because the denominator `shops a customer can reach — 1 of 8` was printed
directly above it. It borrows from any shop the sweep built now, because a shop
being invisible to shoppers makes its products a better probe, not a worse one.

The first run covered `R  1  mart`, because a shop is orderable only when
active, `online_shop_enabled`, `setup_completed` and the `marketplace` module
are all true, and sweep tenants had never needed the last two. A grocery order
is the EASY path, so the phase now opens a restaurant and a chemist itself — the
platform's switch with the admin token, the shop's own with the owner's — and
coverage is `R  3`.

The chemist had a question nothing in the sweep had ever asked: **can a stranger
order a prescription-only medicine on a phone?** There is no prescription field
anywhere on the request and nobody standing at a counter to look at the paper.
The product refuses it — `RX_IN_PERSON_ONLY` — which is right.

**But the first version of that check would have passed either way.** It read
only the status, and the medicine it created had `stock_quantity: 0.000`, so a
422 for having none reads exactly like a 422 for needing a prescription: green,
having tested the stock rule. Fixed twice over — stock the shelf first so the
other rule cannot fire, and require the refusal to NAME the prescription. **A
refusal is not enough; it has to be a refusal about the thing being tested.**

Full argument: [phase R — the customer](docs/decisions/shopos-the-customer.md).

### 2026-08-20 — the slip number that could deadlock a till

The browser suite refused a queued sale with `Duplicate entry
'<tenant>-OFF-TILL-001D-000001'`, and the till offered that same number again
every few minutes, for ever, behind *"This sale could not be recorded. It is
still safe on the till."* It was safe. It could not leave.

The slip is `OFF-<lane>-<device>-<counter>`, and the two halves that make it
unique came from two places that **do not fail together**: the device segment
lived in localStorage, the counter in IndexedDB. A browser can evict one and
keep the other — this codebase already warns about eviction — and the counter
then restarts at 1 under the same segment. Separately, that segment was **the
first four characters of the random UUID the browser minted for itself**, with
nothing anywhere checking whether another till had them: 65,536 values, so a
shop running fifty tills had about a one-in-fifty chance that two of them
printed identical slip numbers for different customers. A hash where an
allocation belongs.

Fixed in three parts, and **the slip's shape never changed** — four characters
in the device segment before and after; only the guarantee behind them is
different.

**A label may never cost a sale.** The operation id is already the idempotency
key and is checked first, so if that is new the sale is new. It is filed under
`…-D2` now, with the collision reported to the shop rather than hidden, and the
printed number kept as the stem so a refund search still finds it.

**The counter cannot go backwards.** New `sales.offline_seq` — the sequence as a
number beside the label, because the label now has a `-D2` form a SQL parse of
the string would misread. The catalog pull answers `offline_sequence` for the
asking device and the till takes `max(local, server) + 1`.

**The device segment is allocated.** New `pos_devices.code`: four characters,
unique per tenant, handed out once and never changed under a till that has
already printed it. The alphabet omits `O 0 I 1 S 5`, because somebody reads
that code down a phone when they ring about a refund, and it is random rather
than sequential so one slip does not reveal how many tills a shop runs.

And one test that was lying: `test_a_tills_code_never_changes_under_it` passed
with the allocation deleted, because `assertSame(null, null)` is true. **Two
nulls agreeing is not a test.**

Full argument: [the slip number that could deadlock a till](docs/decisions/shopos-offline-slip-numbers.md).

### 2026-08-19 — offline selling, in a browser, for the first time

Two thousand backend tests ring sales over HTTP and a thousand panel tests
exercise the pieces in jsdom, and between them **no sale had ever been rung
through the actual screen** — and **no offline sale had ever been rung at all**,
because jsdom pins `navigator.onLine === true`. Every offline test in this repo
had exercised the offline path while the app believed it was online.
`context.setOffline(true)` is the only thing here that can change that.

Three defects, and all three are about what the cashier is TOLD.

**A dead Complete button.** The tender panel showed an error only for
`checkout.error instanceof ApiError`; `OfflineRefused extends Error`. So a
refused offline sale did nothing at all — no spinner, no message, no sale — with
a customer at the counter. The till had a perfectly good sentence ready that
nobody could see. Every failure shows now, and a refusal is titled as one.

**"1 still to send", for the rest of the shift.** Measured: the row went
`pending → acked` with an invoice number eight seconds after the line returned,
and the pill still read "1 still to send" a minute later. `pendingCount()` was
right; it was never called again. The count was read on `[enabled, connected]`,
and neither moves when a flush finishes — the till was already connected, which
is *why* it flushed. So the shop watches "Sending 1 of 1" settle into "1 still to
send", at the one moment the badge exists for.

**A till that could lock itself out of its own shop.** Unlock is HTTP and the PIN
lives only on the server — correctly, since a PIN mirrored into IndexedDB is a
PIN anybody holding the tablet can read. A till that locked during an outage
could not be opened until the line came back, with offline selling switched on
and a queue of customers; and the escape hatch under the keypad signs the till
OUT, through the same server. **A lock nobody can open is not security, it is a
shutter.** The idle lock no longer fires offline, hand-over is disabled and says
why, and a till already locked is told which door is shut.

**A dropped line could sign the till out.** Found because a 1.5-hour suite run
ended on the Sign In page. `refreshTokens()` was a bare `catch { clear(); }`
carrying the comment "refresh token dead → hard logout" — a cause the code never
checked. A dropped line, a timeout, a 502 during a restart, a rate limit: all of
them signed the shop out. On a till that is the worst outcome in this
application, because the outbox can only be sent WITH a token — sign the till
out mid-outage and a day's takings are stranded behind a login screen that also
needs the server. **Only the server may end a session:** `clear()` on 401/403,
and on nothing else.

**And a phone never said it was offline.** The connection pill was
`hidden … sm:flex`, and a phone is below `sm`. It is the only thing on the till
that reflects the connection, so a phone selling through a power cut looked
exactly like a phone selling normally. Proven in a browser: the offline sale
went through and not one visible word mentioned it.

One thing is deliberately NOT fixed. The offline slip is
`OFF-<register>-<4 chars of device id>-<counter>`, and the device id lives in
localStorage while the counter lives in IndexedDB. Evict IndexedDB, keep
localStorage, and the counter restarts under the same device segment — every
later offline sale then collides with one already recorded and can never be
sent, retried for ever behind "This sale could not be recorded. It is still safe
on the till." It is safe, and it cannot leave. `DEVICE_SEGMENT = 4` is 65,536
values, so two tills in one tenant can collide the same way. The slip is
printed, handed to a customer and is the handle a refund is found by, so
changing its shape is a decision, not a patch — three options are written up in
`docs/qa/FINDINGS.md`.

The tests fooled themselves five more ways, the best two being
`expect(after.length).toBe(before.length + 1)` against a **paged** endpoint —
fifty rows, so the length can never change again and the check reads "the queue
never drained" for ever about a queue that drained in eight seconds — and
`useKeepInSync.test.tsx` mocking `pendingCount: async () => 0`, **a constant, so
a stale count was unobservable by construction.**

Full argument: [offline selling in a real browser](docs/decisions/shopos-offline-in-a-real-browser.md).

### 2026-08-19 — the cart that hid its own lines

> "i add 8,9 rows cart / on mobile and tablet showing 6,7 / last wali rows hide
> ho rhi nichee"

The cart's scroll area carried `min-h-[19rem]`. **A `min-height` on a `flex-1`
child of an `overflow-hidden` card is a promise the parent cannot keep:** the
child will not shrink, the parent will not grow, and the difference is *cut off,
not scrolled* — and with `overflow: hidden` **no finger can reach it**. On a
390×664 phone the cart pane is 128px and the floor demanded 304px, so **188px of
the list lay outside the card**. Nine lines went in and three could be seen.

The floor's own comment said it was there so a short basket would not make the
payment bar jump. That bar had moved out of the card long before. It was holding
nothing up.

Two more changes came out of measuring it. On a phone, 664px minus a 51px top bar
minus a 188px money bar leaves 425px for the catalog **and** the cart, so below
`sm` the two panes now **take turns** behind a Products / Cart switch, with the
Grand Total and Tender always on screen. And the cart's eight columns wrapped
every row onto three lines at 390px — `Disc` and `Tax` now print on the item's
own sub-line, only when non-zero. Row height 73px → 49px; money bar 248px → 177px.

**The test written to catch this passed against the bug, three times over**, and
the third is the one to remember: **`scrollIntoViewIfNeeded` will scroll an
`overflow: hidden` box.** A finger will not. The check scrolled the last row into
view, asked whether it was visible, and was told *yes* — about content nobody can
see. A reachability check that reaches by means the user does not have is not a
reachability check. Also: `overflow-x-auto` computes `overflow-y: auto` too, so
the row's horizontal wrapper looked like the cart's scroller and swallowed the
scroll; the fixture had five sellable products so a nine-line cart was
impossible; and `reuseExistingServer: true` served a stale build in which a
newly-added test hook did not exist yet. **Rebuild before believing an e2e
result.**

Full argument: [the cart that hid its own lines](docs/decisions/shopos-cart-that-hides-its-own-lines.md).

### 2026-08-18 — the same blindness twice in one day

`crypto.randomUUID` exists only in a **secure context**. Over plain http — every
staging droplet on a bare IP, every shop without a certificate yet — it is
**undefined**, and calling it throws. It had crashed the POS once already, which
is why `common/uuid.ts` exists and opens by explaining itself.

**Four call sites went on calling the raw API.** The worst by a distance was the
offline sale's `op` id, minted *before* the sale is queued — so on a plain-http
shop, ringing an offline sale would throw with the goods already on the counter
and nothing recorded. The whole outbox, durable and append-only and tested
against every failure it could imagine, sat behind one call that could not run.

> A helper written because of a bug does not prevent the bug. Only a rule does.

**Why nothing caught it:** jsdom runs in a secure context and defines
`crypto.randomUUID`. Every unit test passed against code a shop on http cannot
execute — the same sentence as the react-query finding hours earlier, where jsdom
reports `navigator.onLine` as true and so never paused anything.

> Twice in one day: **the test environment agreed with the code instead of with
> the world.**

So the rule is a source scan, not a runtime guard — reading the source is the
only check that does not inherit the environment's opinion. It carries its own
denominator and strips comments, because both the helper and the rule have to be
able to name the API they guard.
`docs/decisions/shopos-secure-context.md`.

Panel **994** green (+4).

### 2026-08-18 — the pill is the Sync now button

The last entry on the panel's unreachable-exports list, and the way it left is
the point.

`isPulling` had sat there for weeks with **"needs a manual Sync now control"**
written against it. The control exists now: the offline pill IS the button. A
separate one would be a second thing to find, in the one corner a cashier
already looks at to answer "is my day safe?" — pressing it asks the same
question out loud.

**A press gets its own answer**, which the automatic sync deliberately does not.
The automatic one is silent when there is nothing to send, because narrating
"Sending 0 of 0" four times an hour teaches a cashier to stop reading the pill.
A press is the opposite case: the commonest outcome shows nothing at all — an
empty queue, a zero-row delta, a 300ms request — so without a state of its own
the control would look broken exactly when everything is fine. `Sync now →
Syncing… → Up to date`, and the two failures are told apart, because "Sync
failed" is something to report and "Still no connection" is something to wait
for. Not "Synced!" — this round finished, which is not a promise that the whole
day went up, and overclaiming is how a cashier stops believing the next message.

Then the honest part. A helper was written to OR the press state with
`isPulling()`, and **deleted rather than shipped**: it reads a module variable,
which React does not subscribe to, so it would have reported a stale answer for
ever. `pullNow` is single-flight anyway — a press during an automatic pull joins
the one in progress.

So `isPulling` moved to `TEST_ONLY`, not off the lists. What it genuinely is:
scaffolding that exposes the single-flight slot so a test can prove the slot
CLEARS when a pull fails — without which one network blip wedges the till for
ever.

> An entry leaving `NOT_SURFACED_YET` is not automatically progress. What it
> waited for was named, the named thing was built, and the honest answer was
> that it still had no correct caller.

Panel **990** green (+6).

### 2026-08-18 — the offline till was never reachable in a browser

Found by the user, not by a test. Wifi off, press Complete, and the button said
**"Processing…" for ever**; turn the wifi back on and the sale goes through.

TanStack Query's default `networkMode: "online"` **pauses** every query and
mutation while `navigator.onLine` is false — it does not fail them, it never
calls them. So the sale mutation was never invoked. Not the outbox, not the
pricing mirror, not `canSellOffline` and its refusals: all of them live inside a
mutation or a query, and with the line down not one was reached.

> Phases 0–5 were built, tested, shadow-checked and shipped. In a real browser,
> with a real dropped line, a cashier could not ring a single sale.

It had already bitten the same day, quietly: a paused query never calls its
`queryFn`, so the shift-mirror fallback written that morning was **green in the
suite and dead in a browser**.

**Why nothing caught it:** every test here runs in jsdom, where `navigator.onLine`
is true. Nine hundred green tests were exercising code the browser would not
call. Same shape as the guard tests found earlier this month, one level up —
**the test environment agreed with the code instead of with the world.**

Fixed with `networkMode: "always"` globally, pinned by a test. The app already
has a better connection model than the browser's: `connectionStore` is driven by
real traffic, because a till on a shop router with a dead uplink is "online" by
`navigator.onLine` and can reach nothing.
`docs/decisions/shopos-offline-was-never-reachable.md`.

Two more in the same pass. **A shop's drawer-close settings never reached the
till** — `pos_blind_close`, `pos_denomination_count`, `pos_declare_tenders` were
not in `TILL_SETTINGS`, so the close screen fell back to hardcoded defaults and a
shop that must declare its card takings **was never asked**, losing that shift's
declaration. And **held tickets offline**, parked on the device and deliberately
never pushed afterwards: a ticket is an intent, not money, and a queue could only
flush after the line returned, by which time the basket has been rung.

Also shipped: the offline shift queue — open, drawer movements and close with no
server, `POST /pos/sync/shifts`, flushed **around** the sale queue (opens before
the sales that name them, the count after them, or a close reports a variance the
exact size of the day's takings). And `SYSTEM-REQUIREMENTS.md` at the root.

Backend **2070** green (+14) · panel **984** green (+43).

### 2026-08-18 — the power cut the Help Centre promised to survive

Two bugs, one wrong question, both in the gate in front of selling.

**A till that reloaded while offline could not sell.** `PosPage` disables
Tender/Pay on `!open`, and `open` came from a live `useQuery` with nothing behind
it — no query persistence anywhere in the app, and a service worker that caches
product images and no API responses. The shift lived in memory and nowhere else.

An outage with the page still mounted sold fine; that is the case that was
tested. A **reload** did not — and a reload is a tablet waking up, a PWA
relaunch, or a power cut. The Help Centre names the power cut by name: *"a till
keeps trading through a power cut or a dead connection."* After a power cut the
tablet reboots, the page reloads, and the whole offline module sat behind a gate
that needed the server it was built to do without.

`STORE.SHIFT` was created for exactly this in the first schema, listed among the
stores that are never dropped, and covered by a migration test. **Nothing had
ever written to it.** The store was protected from a migration that would never
have had anything to destroy.

Fixed by mirroring the session row on every answer and handing it back on
silence. The fallback is narrow on purpose: `ApiError.status === 0` only — a
**401 must not** hand a drawer to a signed-out till, and a **500** is a broken
server, not a dead line. A closed shift is cleared, not remembered. And it is
tenant-fenced in both directions: shop B must not be offered shop A's drawer, and
mirroring for shop B must not delete shop A's row — which the tests caught after
I wrote it.

**And the second: a reliever could not ring at all.** `open` is null under cover
by design, and both selling gates asked `!!open`. So somebody covering a break
saw "Open a shift to sell." with Tender greyed out, while `activeSessionId` and
the sale payload beside it were already built to ring under the cashier's drawer.
Relief cover exists so the reliever rings.

Two questions that look like one: *do I have a drawer of my own* (right for the
X-read, the close, the count) and *is there a drawer to ring into* (right for
selling). `ringableSessionId()` now answers the second and is a named function
rather than a boolean buried in a 3,000-line component.

`cover.test.ts` opens by saying the narrowing must not *"leave them unable to
ring at all"* — and then tests only the type predicates, which were never the
part that was wrong.

> A test file that describes the failure and then checks something adjacent is
> the most convincing kind of missing test: it reads as covered.

Six mutations, all fired. Help Centre corrected to say what is true — the shift
survives a restart, and a shift is still opened and closed with a connection.
`docs/decisions/shopos-offline-shift-gap.md`, `shopos-cover-cannot-ring.md`.

Panel **958** green (+17).

### 2026-08-18 — the slip in the customer's bag matched nothing

An offline till cannot mint an invoice number — the shop's sequence is one
counter, and two tablets offline would both take `INV-1043`. So it prints
`OFF-LANE1-A3F2-000042`, and on sync the server keeps BOTH, for the reason
`receiptNumber.ts` states plainly: **the slip in the customer's bag is the only
reference they have.**

It was kept, and **searched by nothing.** All three lookups — the sales ledger,
its CSV export, and the ⌘K palette — matched `invoice_number`, `customer_name`
and `customer_phone`. Never `offline_number`.

A return is `POST /sales/{id}/returns` and the id comes from that search. **A
customer who bought during an outage, holding the only paper they were ever
given, could not be found — so could not be refunded, returned, or have their
receipt reprinted.** For as long as offline selling has existed.

And the Help Centre had already promised it, in the shopkeeper's own words:
*"BOTH are searchable, so a customer holding the slip can always be found."*
Written when the design was decided; never true.

> **Documented as working is the most expensive way for a feature not to exist.**
> Nobody goes looking, because the documentation says it works. That is a worse
> shape than the "built but unreachable" one found eleven times before it.

Fixed as `Sale::scopeMatchingSearch()` — **one clause, not three.** The export's
whole job is to be the same rows as the screen, and it can only stay the same by
being the same clause; and two copies of a rule do not remain one rule, which the
till's status pill demonstrated earlier the same day.

Found is not recognised, so the slip travels back: the ledger row prints it under
the invoice number, the detail says `Slip OFF-… · rung offline`, the palette
leads its subtitle with it (`saleSubtitle()`, extracted so the rule is testable),
and the CSV gains an `offline_number` column for reconciling a day that arrived
three days late.

`isOfflineNumber` stays exempt **on purpose** — every one of those surfaces reads
the *field*, none has to judge a string, and inventing a caller to empty an
exemption list is building for a checklist rather than for a shop. Its line now
names what a real caller would be.

Removing the clause fails all three new tests.
`docs/decisions/shopos-slip-number-lookup.md`.

Backend **2056** green (+3) · panel **941** green (+4).

### 2026-08-18 — the other direction, and a warning that was not true

`dead-endpoints.py` asked one question — *which routes does no client call?* —
which finds capability nobody can reach. It never asked the reverse, and **the
reverse is the one a customer holds**: a call no route serves is a 404 in the
hand, on a screen that compiles perfectly. It compiles because the clients
describe the API in their **own hand-written types**, so a path renamed on the
server changes nothing `tsc` can see. The mobile app's own 31 tests cannot see it
either — they mock the API, so they agree with whatever the app already believes.

A third question came with it: a real route called with the **wrong verb**. A 405
reads to a shopkeeper as "the button does nothing", which is the report you get
and the thing you then cannot reproduce.

What prompted it was a line in section 6 of this file, warning since July that
the mobile contracts had "moved under them" — `item_types`, `other_income`,
`logo_url`. **Nothing had ever checked.** It was prose, and prose is not checked.

| | |
| --- | --- |
| call sites read across both clients | **359** |
| reach a route that serves that verb | **359** |
| hit nothing · wrong verb | 0 · 0 |
| unresolvable (variable path head) | 4, printed not dropped |

Mobile `tsc` clean, 31 tests pass, `Tenant` matches `TenantResource` on all three
named fields, and `other_income` does not appear in the mobile app at all. **The
warning was not true and had not been for some time** — the customer app is
behind on features, not out of contract. The line is corrected rather than
deleted, because a stale caution sends the next person hunting a defect that does
not exist, and teaches them the cautions here are approximate.

The clean result is worth believing only because it was made to fail first: two
probes planted, both caught (`NO ROUTE GET /marketplace/shoppes/${slug}`,
`WRONG VERB POST /auth/me`). It aborts if it reads zero calls, for the reason
this fortnight kept paying for — a checker that silently discards what it cannot
parse reports a clean sweep it did not earn.

Also checked and **already correct, no change needed**: `CORS_ALLOWED_ORIGINS` is
env-driven and `shopos:readiness` blocks on `*` in production, so the standing
"CORS accepts every origin" note was itself stale. Worth knowing that
`shopos:readiness` is invoked by **nothing** — not CI, not the deploy — and that
wiring it in as a gate is a decision about the deferred items it would block, not
a tidy-up.

### 2026-08-18 — the backup that had never been restored

Writing the docs owed for the session above meant opening section 3 of this
file, which explains how to give a rebuilt laptop its memory back. **The command
it gave was lossy in both directions**, and had been since it was written.

`docs/decisions/` and Claude Code's memory directory are not two copies of one
thing. The documents are long-form reasoning for a person; the notes are short,
carry frontmatter the memory system indexes by description, and are a different
set of files. The restore said `cp docs/decisions/*.md` **into** the memory
directory — so it would have overwritten 24 notes with essays that no longer
index, and **nine notes had no document here at all**, among them two standing
rules: *a workflow test must fail when a step is deleted*, and *a detector that
only recognises what was already fixed is not a rule*.

`docs/decisions/MEMORY.md` had drifted past stale into **wrong**: it still called
the admin-side backlog "REQUESTED, not built" months after it shipped. A restore
handed a new machine a false index — and an index is precisely the thing nobody
re-verifies.

`docs/memory/` is now a verbatim snapshot of the directory, `scripts/
sync-memory.sh` keeps it current in one command (`--check` exits 1 on drift, and
deletions propagate — a note is sometimes deleted **because it was wrong**, and a
backup that keeps it is worse than one that lost it), and the two indexes are one
index. `docs/memory/README.md`.

> A backup that has never been restored is a belief, not a backup.

Same shape as everything else found this fortnight — written, correct in
isolation, and never once exercised end to end.

### 2026-08-18 — the gap between "47 saved here" and "Online"

The till's offline pill had four things to say and said three. The missing one
is the one a shopkeeper waits for: **the line came back and my day's takings are
going up right now.** It jumped from `47 still to send` straight to `Online`
with a silent stretch in between — and a gap is where somebody starts pressing
things, during the exact ninety seconds a bad shop connection had to give.
`docs/decisions/shopos-sync-progress-pill.md`.

The wording existed **twice**. `pillLabel` says of itself *"One place, because
the wording is the feature"*, and it was sitting on `NOT_SURFACED_YET` while POS
grew its own inline copy. The two had drifted, each having learned something the
other never did: the exported one could say `Sending X of Y` and not `No server`;
the POS one the reverse. `No server` is not a rewording of `Offline` — **"wait
for the line" and "telephone somebody" are different instructions**, and nothing
else on the screen distinguishes them.

> An entry on `NOT_SURFACED_YET` is not free. While `pillLabel` sat on it, the
> screen that should have used it wrote its own, and then the two diverged.

Three decisions inside the progress: the **denominator freezes at round 0**, or a
sale rung mid-flush makes the bar walk backwards; progress counts **rows that got
an answer, not rows that went on the wire**, because a round that all came back
retryable moved nothing; and it is **cleared in `finally`**, because a flush that
throws must not leave `Sending 12 of 47` frozen for the rest of the shift — a
worse lie than saying nothing. Nothing owed says nothing at all: `Sending 0 of 0`
every fifteen minutes teaches a cashier to stop reading the pill.

`isPulling` deliberately did **not** ride along. The pill reports the outbox,
which is money; a catalog pull is housekeeping, and an indicator that flickers
for what does not concern a cashier stops being read for what does. Its
exemption now names what would surface it — a manual **Sync now** — because a
person who presses a button is owed a different answer than one watching money
leave.

Both mutations fired: counting wired rows instead of answered ones, and letting
the total float.

Panel 937 green (+7).

### 2026-08-18 — drag it, and a detector that only found what was fixed

Categories screen rebuilt: drag-to-reorder by **pointer events** (mouse, pen and
finger with one set of handlers — `react-dnd` is in `package.json`, imported by
nothing, and its HTML5 backend does not fire on touch anyway), collapse/expand
that says **"2 inside"** when closed, and the item count turned into a link that
opens Products filtered to that category. Arrow keys too, because a grip is not
reachable by keyboard. `docs/decisions/shopos-categories-and-row-actions.md`.

**A bug written and caught in the same hour:** the new search box filters the
tree, and `sort_order` is written as each row's position from zero — so a drag
inside a filtered list renumbers the rows the search is hiding. Grips now
disappear while searching. *The question is not whether the drag works; it is
what the drag writes.*

Then the third instance of one lesson in a day. `rowAction.test.ts` guarded row
actions with a detector made of **two literal class strings — the exact two the
Aug-17 sweep had replaced.** Every other spelling walked past it. **Seventeen
were sitting in table cells**, several of them rows where Delete had been swept
and the Edit beside it had not, which is worse than neither because the pair
stops reading as a pair.

> **A detector that recognises the instances somebody already found is not a
> rule. It is a record of one afternoon.**

The rule now: any `<button>` inside a `<td>` with no height, padding or size,
carrying its own denominator so a broken matcher fails instead of reporting a
clean sweep. Scoped to table cells on purpose — a button inside a sentence is
legitimately a text link.

Also: `MODAL_CLOSE` / `INLINE_DISMISS` for the till's close buttons, which were
bare 20px glyphs pressed with a thumb mid-queue; and `autoFocus` + `onKeyDown`
on the shared `Input`, whose absence is why screens reach past it for a raw
`<input>`.

48 bare buttons remain, **none in a table cell** — card-list actions and genuine
prose links, which is reading rather than matching.

Panel 930 green (+27).

### 2026-08-18 — the review nobody could take down

Reachability one level up: not "does anything call this method" but **does any
client call this endpoint**. `shopos-backend/scripts/dead-endpoints.py` reads
`route:list` plus every file in the panel and the mobile app — 294 routes.
`docs/decisions/shopos-endpoint-reachability.md`.

A script rather than a test on purpose: it needs two sibling repos, and a test
that fails on a missing directory gets switched off within a week.

It found `DELETE /customer/reviews/{id}` — written, tested, correctly scoped,
called by nothing. **A customer could post a review and never take it back.**
The reason it was never wired is the better half: the public list carries a
display name and nothing else, so no screen could tell which review was yours.
The capability was unreachable because **the data needed to reach it did not
travel**. `is_mine` on the public payload was rejected — that response is the
same for every visitor and cacheable, and a body that varies by token is how one
shopper's view gets served to another. `GET /customer/reviews` instead, beside
favourites and addresses; the shop page now prefills your own words, badges your
row **Yours**, and offers **Remove**.

The audit had two bugs of its own: it missed paths built from a variable
(``apiGet(`${basePath}/presets`)``), and its retry required a tail of 8
characters — `presets` is 7, so `staff/presets` was reported dead while
`useJobPresets` was calling it.

Then adding the Remove button failed `destructive.test.ts`, and **the rule was
right while its parser was not**: the word list is anchored, and a button with a
pending state labels itself `{busy ? "Removing…" : "Remove review"}`. Every
destructive button with a spinner was invisible to it. Teaching it to read the
string literals out of an expression turned up two the Aug-17 sweep had missed —
the delete confirmations on Products and Categories were rendering the brand
colour, so **the button that deletes a product was the same button as Save**.

> A guard test that cannot parse the thing it guards reports a clean sweep.

Backend 2053 green (+5) · panel 903 green (+1).

### 2026-08-18 — the item rule the sync endpoint never applied

The panel's reachability rule got a server half, `tests/Unit/ReachableTest.php`,
and it found something on its first run.
`docs/decisions/shopos-item-rule-on-sync.md`.

`OfflinePolicy` has five offline rules. Four are about the SALE — tender,
dine-in table, redeemed points, coupon. One is about the ITEM: a medicine, or
anything tracked by serial. **`PosSyncController` enforced four.**
`refusalFor()` was written, tested, and called by nothing, so a medicine synced
up from a till landed recorded as a clean offline sale — `offline_violations`
null, nothing in Reports → Offline, nobody ever looking. Proven against the real
endpoint before it was fixed: `"status": "applied", "violations": []`.

The till refuses all five at the counter, and that refusal is good. But
`OfflinePolicy`'s own docblock says why the server checks again — *"the outbox
is a JSON queue in a browser database on a tablet that may have left the shop"*
— so the layer that exists for a wrong till had a hole exactly the shape of the
one rule with the worst ending: a medicine out with no batch recorded, or one
IMEI sold by two tills.

Fixed as a FLAG, never a refusal (the money crossed the counter), with the
reason **naming the item** because a report read a week later is not a cashier
holding the box; deduplicated per product; and the catalog asked **once per
request**, pinned by a test that counts the query — move it into the per-sale
loop and it reads 12 instead of 1.

The rule's own first version reported nineteen findings, fourteen of them noise:
it stripped string literals along with comments, and **in Laravel a route names
its method as a string**. Comments out, strings in. *An audit that produces
findings is a thing to verify, not to believe* — third time that has earned its
place. What the rule cannot see is written down in it: private methods, and
methods whose name is a common word (`for`, `all`, `get`) which self-exempt.
`Product::isLowStock` was exempted with a warning rather than deleted — it is a
PHP copy of a SQL rule and **it is branch-blind**.

Backend 2048 green (+9) · panel 902 green.

### 2026-08-17 — built, tested, and reachable by nobody

The oldest shape in this codebase is now a rule that runs on every commit.
`docs/decisions/shopos-reachability-rule.md`, `src/common/reachable.test.ts`.

Eleven instances had been found by hand. The check is one sentence: **an export
whose own test file is the only thing that uses it.** Tests prove a thing works;
they do not prove anybody can get to it.

Two exemption lists, deliberately separate. `TEST_ONLY` is scaffolding and
always will be. **`NOT_SURFACED_YET` is unshipped capability, and each line
names what must be BUILT for it to leave** — four today (a sync-progress
indicator, an offline badge on a sale row, a barcode sized by the symbol). That
second list is the one to watch: past a handful it means the product is
accumulating work nobody can use.

`code128Svg` was the instructive one — it looked like dead code, and deleting it
would have thrown away a deliberate decision. Its own file explains why
`LabelsPage` uses the bars-only variant, and that its XSS escaping was written
*because* it has no caller. **Read the file before deleting the thing the file
already explains.**

The rule had three bugs of its own: `RegExp.test` with `/g` is stateful (it
accused `flushVariances` while `pullNow` was calling it); comments counted as
callers (**a rule a leftover sentence can satisfy is not a rule**); and it timed
out until the stripping was done once per file instead of once per lookup.

Also closed my own instance from earlier today: recurring income shipped with a
backend, a service, hooks, tests and **no screen**. The Income page now has the
tab — the same three tabs as Expenses, so the two sides of the books read the
same way.

Panel **902** green · eslint 0/18 · build clean.

### 2026-08-17 — the shelf the till had and never showed

Same question as the last finding, pushed further: what has the till been given
that it does not read? `docs/decisions/shopos-offline-browse.md`.

`STORE.CATEGORIES` had **zero readers**. And `searchCatalog()` /
`categoryIndex()` — a pure, tested offline search written over the cached
catalog — had **exactly one caller between them: their own test file.**

The POS pane read `useProducts`, a plain HTTP query with no fallback, and
`client.ts` has no cache path either. So offline **the pane went empty and the
only way to add anything was to scan a barcode.** A mart mostly scans; **a
restaurant could ring nothing at all**, because a dish has no barcode — and
FOOD is the first of the three daily-revenue trades.

**The shadow run would never have caught it**: a sale that cannot be started
produces no variance to look at, so two weeks of evidence would have come back
clean on a till where half the shop could not sell.

`loadShelf()` reads catalog + categories ONCE (not per keystroke — exactly what
`searchCatalog`'s own note argued for), `shelfRows()` filters in memory. The POS
swaps source on `connected`, same tabs, same search. Paging is off offline: the
whole catalog is already there, so "load more" would ask a server nobody can
reach. Images are honestly absent — not cached, wrong trade — and tiles fall
back to the placeholder they already draw.

**It was a cluster, not one gap.** Running the same check over every export —
what is tested and has no caller outside its own test? — found the rest:
`findByCode` (**the scanner asked a server nobody could reach**) and
`withLocalStock` (the shelf showed whatever the last pull said). Together with
the empty pane that meant **a till could not put a single item in the cart, in
any trade.** All three are wired now.

One caution: the first version of that scan had a bug of its own —
`RegExp.test` with `/g` is stateful, so real callers looked absent and it
reported `flushVariances` as uncalled when `pullNow` calls it directly. **An
audit tool that produces findings is a thing to verify, not to believe.**

Ninth, tenth and eleventh instances of the pattern, in one cluster, and the
largest yet: not data left unread, but whole built-and-tested capabilities
nothing could reach.

Panel **899** green · eslint 0/18 · build clean.

### 2026-08-17 — the discount the till was given and never read

Found by auditing the offline pricing mirror against features that shipped
after it, not from a backlog.
`docs/decisions/shopos-member-discount-offline.md`.

The shadow run is the evidence for granting offline selling, and that evidence
is only worth what the mirror covers: a pricing rule that shipped after the
mirror was written makes the shadow run report "agreement" on sales that never
exercised it. Coupons, loyalty and bank offers turned out to be properly
REFUSED offline. One was not.

**The server sends `customer_group_id` on every cached customer and the groups
with their `discount_percent`** — its own comment says "the group is here only
because pricing cannot work without it". The till stored both and **nothing
ever read them.** `priceCart` omits group discounts deliberately, and
`canSellOffline` never refused a member, so a customer in a 10%-off group
served during an outage was charged full price on a printed receipt.

It hid because it is HALF implemented, which is worse than none: a group's
price LEVEL is honoured, so groups look handled right up until the one carrying
a percentage.

Fixed the way the same file already fixed the identical case one field away —
the bank-offer refusal, whose reasoning is *"a receipt wrong by the whole
discount, which the customer discovers days later with no way to check"*. Only
groups with a percentage; wholesale groups still sell, because a refusal nobody
needed is how the feature gets a reputation for not working.

Eighth instance of the pattern, and the sharpest: the data was shipped to the
device *specifically for this* and the comment saying so was in the controller
the whole time.

Panel **886** green · eslint 0/18 · build clean.

### 2026-08-17 — the other side of the same page

Recurring income. **The Aug-09 gap list is now closed.**
`docs/decisions/shopos-recurring-income.md`.

Only half of it existed. The expense manager's second pass gave rent, salaries
and the internet bill a template that falls due. Income got the same table, the
same categories, the same drawer link, the same branch scope — and no template
at all. The flat upstairs, the let shutter, a monthly supply contract: every
one arrives on the same day each month and had to be typed from scratch, while
the electricity bill three fields away offered itself.

Copied deliberately, down to the column names. Two screens doing one job in two
vocabularies is how one of them ends up half-maintained, and this is a books
module where a shopkeeper reads both sides of the same page.

The rules, restated because they carry more weight on this side: **a template
falls DUE and never posts itself** (income that appears because a clock ticked
is income nobody checked against a payment, and rent is exactly what goes
unpaid quietly); **the amount is overridable at posting** — an expense template
forcing last month's figure files a wrong one, but an income template forcing
the agreed figure files a receipt for money nobody received; **the schedule
advances from the DUE date**, so three unposted months catch up one at a time
rather than erasing two of them; and it files against **the month it was owed
for**, not today.

12 tests. `test_nothing_posts_itself` runs `schedule:run` and asserts zero rows
— the assertion that would notice if somebody ever "helpfully" automated it.
Mutation-checked: advancing from today fails 6, removing the due fence fails 11.
Migration rolled back and re-applied per the rollback audit's standing rule.

Worth knowing: test helpers named `run()` and `post()` collide with PHPUnit's
final `TestCase::run()` and Laravel's `TestCase::post()`, and both fail as
FATALS rather than assertions.

Backend **2039** green · panel **882** green · eslint 0/18.

### 2026-08-17 — what is running out, turned into orders

`docs/decisions/shopos-reorder-to-po.md`. Second of the three Aug-09 gaps.

It was a HALF link, not a missing one. "Order these 12 items" handed the whole
list to Purchase Orders as ONE pre-filled form: every item a line, quantity 1,
priced at the shop's own blended cost, supplier left blank. It saved the typing
of names and nothing else, and could only ever make one order.

**One draft per SUPPLIER is the whole design.** A grocer's Monday reorder list
holds twenty lines from five distributors, and one order containing all twenty
is not an order anybody can send.

Three things the form could not know, and the server does: who each item was
last bought FROM, what was last PAID to them (not what the shop's stock is
worth), and how many it takes to get back above the reorder level.

The supplier is DERIVED, not stored. A product carries no `supplier_id` and
should not: a grocer buys sugar from whoever was cheapest that week, so a
"preferred supplier" field would be wrong within a month and wrong silently.
The purchase history already knew — the answer was in the database and nothing
read it. Last, not cheapest ("quotes a price nobody will honour today") and not
most frequent ("keeps proposing the distributor they stopped using in March").
A cancelled order is not a relationship.

The quantity is the shortfall and nothing cleverer — multiplying would be a
number invented here rather than chosen by the shop. Never placed, only
drafted. Items never bought before are named rather than guessed, and the list
now marks them so a buyer knows before pressing.

12 tests, mutation-checked. Load-bearing one is `test_one_order_per_supplier`.

Backend **2027** green · panel **882** green · eslint 0/18.

### 2026-08-17 — the loss that makes no noise

Near-expiry alerts, the most valuable of the three gaps left from the Aug-09
sweep. `docs/decisions/shopos-expiry-alerts.md`.

Batches carry expiry dates, the dashboard counts what is near, the pharmacy
screen lists it, Disposals records where it went. **All of it pull-only** — a
shop learned its stock was dying by going to look, so it learned on the day
somebody happened to look. Expiry is the only loss in a shop that makes no
noise at all: nothing breaks, no figure looks wrong, and the stock sits on the
shelf looking exactly like stock.

**The design question was never whether, it was how often.** A daily "you have
43 items expiring" is worse than silence — the same sentence every morning
stops being read within a week, and then the morning it says 44 nobody notices
either. So it speaks per lot, per stage, exactly ONCE: when the lot crosses the
shop's own window ("still time to sell it down or agree a return"), and when it
actually expires ("it cannot be sold — record where it goes in Disposals").
Twice in a lot's life, never again.

Two stages, not three: the obvious middle one — "return it to the distributor
now" — needs a number nobody has given us. Supplier terms are per-contract, and
inventing 30 days would be a guess dressed as advice.

Capped at 20 per shop per run so the first morning against an existing chemist
is readable, expired lots sent before approaching ones so a capped run spends
its budget on stock that is already dead. Runs at 07:00, before the shutters go
up. It enforces nothing — expired stock is already unsellable.

11 tests, mutation-checked. The load-bearing one is
`test_a_lot_is_mentioned_once`.

Backend **2015** green · panel **882** green · eslint 0/18.

### 2026-08-17 — eighty-six, and the switch nobody could reach

Clearing the pending list turned up two things.
`docs/decisions/shopos-sold-out-and-reachability.md`.

**A dish could never be out of stock.** `InventoryService` lets recipe
depletion go negative on purpose — a dish is made to order, and refusing to
settle a tab for food already eaten is worse than a negative figure. The
consequence: a sold-out fish went on selling all evening. Now `sold_out_at` —
a TIMESTAMP, because the failure mode is forgetting to switch it back on, and
"off since Tuesday" is the sentence that fixes that. It does not clear
overnight (an item that un-86s itself while the kitchen still has none puts a
customer in front of a dish that never arrives). Refused server-side
(`ITEM_SOLD_OUT`), exempt on the trusted path, sent to the till rather than
filtered out, `products.manage` not `sales.manage`.

**Offline selling could not be granted by anyone.** `offline_selling` has been
in PlanLimits the whole time — server reads it, till obeys it, outbox refuses
without it — and **no screen in the admin console could set it**. The limits
modal lists five countable ceilings and this is not a number you extend, so it
fell between them. Seventh time this codebase has produced that shape. It has
its own card now; revoking sends `null`, because `extendLimits` refuses
anything below 1.

So the answer to "how does a shop set up offline?" is **it doesn't** — the till
registers itself, caches the catalog and runs shadow pricing on its own. The
admin's grant is the only decision.

Also: **PWA icons** (all three entries pointed at a 48×48 file while claiming
192/512 — the second, unfamous blocker on installing the till), an **install
prompt** that handles Safari by telling a person where to tap (iPadOS reports
itself as `MacIntel`, so a user-agent check misses the exact device this is
for), and the **CVE pass**: panel 15 → 1, backend clean, every advisory checked
against `dist/` rather than assumed.

**Four backlog entries were stale** — the Aug-09 nine were fixed on 08-11,
kitchen-station typos were already handled, coursing and receivables are built.
Still open: near-expiry notification, recurring income, reorder → PO.

Backend **2004** green · panel **882** green · eslint 0/18 · build clean.
Still not rendered by me — Chrome tools stayed disconnected; the shop's
screenshots caught the two POS bugs.

### 2026-08-17 — the screens that looked blank

A shop pointed at the bank screen: "white white", and edit/delete with no
colour. Both true; neither was a bank-screen problem.
`docs/decisions/shopos-ui-sweep-aug17.md`.

Five identical grey `outline` buttons on one card, one of which deletes a bank.
**Undifferentiated reads as blank, and is worse than blank — nothing is
emphasised, so nothing is warned about either.** The cause was a level down:
`Button` had `primary` and `outline` and no way to say "this one destroys
something", so every screen reached for the grey one.

Reading for it across all 64 tenant pages found five things: **15** native
`window.confirm`/`prompt` boxes, **27** row actions hand-written as bare
coloured text across 20 files, **8** tables wrapped in `overflow-hidden`,
**11** layouts splitting at `xl` with no `lg` step, and **23** panels capped
against `vh`.

The native dialogs were the loudest. One cannot be styled, cannot say what the
press does, and has **no tone at all** — so the fifteen most dangerous moments
in the app were exactly the fifteen with no colour in them. `useConfirm` had
existed the whole time; it gained an optional input (overloaded so `null`
"dismissed" and `""` "confirmed, left blank" cannot be confused) for the two
sites that needed text. `TillDevicesPanel`'s test drove `vi.spyOn(window,
"prompt")` — **which is exactly why the native box survived there.**

**The unit that hid the Appearance Save was everywhere.** `vh` is the LARGE
viewport; it is not what a tablet has. Reading for it found 23 more — including
`ModalForm` at `85vh` (**the component every long form in the app is built
on**, Save in its footer) and the **POS root** at `h-screen`, a column ending
in the action bar: Reset, Hold, Drafts and Quote laid out past the bottom of
the glass. Plus Kitchen, the dine-in tab and the Help Centre. One unit, 23
appearances, one of them reported.

Row actions were not only cosmetic: a line of text is a ~17px tap target on a
screen held in a hand, with Delete beside Edit and the row itself clickable.
Now `ROW_ACTION` / `ROW_ACTION_DANGER`, a ~36px padded pill.

`overflow-hidden` was chosen for rounded corners and also cut off anything
wider than the box, unreachably. **Scrolling is fine, squashed is honest,
clipped looks finished and is wrong.**

Two the shop photographed: the till's **bottom bar had the top bar's exact
bug** (both groups `shrink-0` inside `overflow-x-auto no-scrollbar` — at 768
the wordmark and connection pill slid off the left with no indication), and the
**Appearance gear sat on the cart's TOTAL** because `fixed right-0 top-1/2`
lands on a page margin everywhere except the full-bleed till.

Eight guard files, all source-text rules, all mutation-checked. Panel **865**
green · eslint 0/18 · build clean. **Still not rendered by me** — Chrome tools
remain disconnected; the shop's own screenshots are what caught the last two.

### 2026-08-17 — the width nobody agreed on, and a Save below the glass

Four complaints off one tablet. Two causes, both "a number written down more
than once, then drifting". `docs/decisions/shopos-tablet-chrome.md`.

**"Is the rail pinned, or a drawer?" was answered at three different widths** —
`SidebarContext` at 768, `AppHeader.handleToggle` at 1024, and every class in
the shell at `lg:` = 1024. Between 768 and 1023 they disagreed, and that band
is a tablet held upright (iPad 820, Pro 11" 834, 10.2" 810). The rail sat
off-canvas while the state said "expanded desktop", and `handleResize`
force-closed the drawer on **every** resize — which on a tablet fires when the
address bar slides away, i.e. the moment you scroll. Now `DRAWER_BELOW = 1024`
is exported once and read.

**The drawer measured the header.** `mt-16 h-[calc(100dvh-4rem)]` hard-coded a
64px header; below `lg` it is 64 shut and ~140 with the account menu open, and
on a tablet that menu is the only route to notifications, branch and profile.
Open it and the header (z-99999 vs the rail's z-50) printed over the nav. The
only close was the header's toggle — a control in another component. Now the
drawer is `inset-y-0 h-dvh`, stacks above the header, carries its own X, and
closes on navigation.

**Appearance: `h-screen` on a flex column ending in Reset and Save.**
`100vh` is the *large* viewport — the height the page would have with the
address bar hidden. It isn't hidden, so the footer laid out past the bottom
edge, and the middle is the only scroller by design. A merchant could change
every colour in their shop and had no Save to press. `h-dvh`.

Also: hover-to-peek gated to `(hover: hover) and (pointer: fine)` (touch fires
`mouseenter` on tap and often no `mouseleave`, so the rail latched open), and
the pinned rail starts collapsed below 1280 — a tablet in landscape was giving
290 of its 1024 to a rail and leaving phone width for the page.

**POS tiles/rows toggle** (`docs/decisions/shopos-pos-view-toggle.md`). The view
was `isRestaurant ? "grid" : "list"` with no way round it. Now two buttons by
the search box at every width, stored per DEVICE (`terminalStore.posView`,
null = follow the trade, which is what every existing till holds). It surfaced a
real one: rows have always refused an out-of-stock item, tiles never did —
harmless while tiles were food's alone, a way to sell stock you don't have the
moment a pharmacy could pick them. Tiles now carry the same rule, plus the stock
figure the rows always showed.

10 new tests, mutation-checked: revert any of the three fixes and its own
assertion fails, and only its own. Panel 837 · eslint 0/18 · build clean.

**Not verified visually — Chrome tools were disconnected for this session.**
Every judgement here is read from the source. The tablet still needs eyes on it.

### 2026-08-16 — a laundry runs the same board as a workshop

Found by reading the SERVICES trade — the eighth and last.

A job card is work TAKEN IN: lines accumulate, nobody knows the price on
arrival, it becomes an invoice when the customer collects. That is a workshop,
and it is exactly a laundry, a tailor, a cobbler and a repair counter.

`StoreSaleDocumentRequest` accepts `job_card` from **any** tenant — no trade
gate, no setting gate. Only the SCREEN was automotive-only, so a dry cleaner
could create the document it needs and had nowhere to see it. Sixth time this
shape has turned up here.

**Fixed as vocabulary, not a second flow.** `boardWords()` moves the nouns and
nothing else; the registration, the vehicle quick-create and the odometer are
fenced to `tracksVehicle`, because a form that asks a tailor for an odometer is
a form a tailor closes.

**This is not booking and must never become it** — booking promises a FUTURE
slot and owns a diary; this board only holds work already in the shop. Written
into the code and the Help Centre, because the two are close enough to confuse.

Backend 1996 · panel 827.

**The eight trade areas are now closed.** Eight findings, six of them one shape:
the answer was already in the database and nothing read it. No script would have
found any of them — nothing was missing, nothing errored, every figure on screen
was correct.

### 2026-08-16 — a workshop opened the app and was shown low stock

Found by reading the AUTOMOTIVE trade. The dashboard carries a deliberate
per-trade block — "what THIS trade needs and nobody else does" — with exactly
two implementations: the dining floor for food, the dispensing count for a
pharmacy. **Automotive had none**, and its profile led with low stock.

The bay board shipped two days earlier and the owner still had to open it.

**One number existed nowhere at all:** a job card marked `ready` is finished
work, and while its document is still `open` nobody has invoiced it. A car
handed back without converting the card is work the shop will never be paid for.

`workshopBay()` + `BayPanel`: booked in, on the ramp, **ready-and-not-billed
with its value**, and how many are past the promised time.

`work_status` is where the CAR is; `status` is whether the paperwork is live.
Every figure is scoped to OPEN documents or last month's work would read as
outstanding forever. Overdue counts at every stage. Absent, never empty — a
grocer shown an empty workshop board would read it as a fault.

Backend 1995 · panel 820. 6 tests, 2 mutations caught.

### 2026-08-16 — the cost of goods was typed once and never moved

Found by reading the MART trade. The one that reaches every shop that buys
stock.

Every margin, profit and COGS figure comes from `products.cost`, and **nothing
ever wrote to it except a human on the product form**. `ReceivePurchaseOrderAction`
touched `cost` only to stamp a batch. `weighted|average_cost|moving_average`
grepped to nothing.

A kiryana bought sugar at 140/kg in March. Every delivery since was 148, 155,
162, **each recorded at its true price on the PO line** — and the product's cost
stayed 140 all year. The Margins report told him he was making Rs 22/kg while he
was making eight.

`MovingCost::blend()` on receive. **Weighted, not last-price:** the shelf holds
both, and a margin calculated on the newest price gives away what was already
earned on the old stock. Self-correcting as the old stock sells through, so
nobody keys anything. **Never blanks a known cost** — a delivery with no price
is missing information, not free goods. **Per base unit**, or a pack price would
multiply the error by the pack size. Variants blend against their own shelf.

9 tests, 3 mutations caught. 1989 green **with no regressions**, which is the
number that matters when a core receiving path changes.

### 2026-08-16 — a restaurant's margins came from a number nobody maintains

Found by reading the FOOD trade. Every margin, profit and COGS figure is built
from `sale_items.unit_cost`, and that came from `product.cost` — one number
typed onto the item once. For a tin of paint that is right: it is what the shop
paid.

**A cooked dish has no such number.** It costs half a kilo of chicken, onions
and oil, and those move violently here. So the Margins report — the one a
restaurant opens to decide what to charge — was computed perfectly from a figure
nobody updates, while **every ingredient of the real answer was already in the
database**: the recipe held the quantities, the ingredients held their costs,
and nothing multiplied them.

`App\Support\RecipeCost` now costs a portion from its recipe, and
`CreateSaleAction` uses it — which corrects COGS, profit and margins at once.

**Unknown is not zero.** One ingredient without a cost makes the dish
uncostable, not cheaper — a partial food cost is wrong in the direction that
makes a kitchen underprice. It falls back to the old figure (so nothing
regresses) and the product form NAMES the ingredients stopping it. Recipes nest,
because a gravy base is a real thing.

**A mutation survived and was resolved rather than papered over.** The recursion
carried both a depth cap and a visited-set; each terminates a cycle alone, so no
test could tell them apart. The cap was removed — it silently answered
"uncostable" for a legitimate four-deep nest, which is a wrong answer wearing an
honest refusal's clothes. Same call as M51.

**A real bug the suite caught:** a sale line's `$source` can be a
`ProductVariant`, not only a `Product`. Six pre-existing tests failed at once.

Backend 1980 · panel 820. 12 tests, 3 mutations caught + 1 survivor resolved.

### 2026-08-16 — expired stock could leave, but not be accounted for

Found by reading the PHARMACY trade. The largest of the four trade findings.

A medical store's money does not mostly leak at the counter — it expires on the
shelf, and the loss is avoidable, because distributors here take medicine back
for credit inside a window that closes MONTHS before the printed date.

The platform computed the warning perfectly — batches, FEFO, an expiry fence,
a dashboard count — and a pharmacist could act on none of it in a way the books
could see.

**Three parts, compounding.** Removing a batch wrote one movement reading
"Batch X removed/expired", which covers a write-off (a loss), a return to the
distributor (money owed back) and a mis-keyed lot (not an event) — then
hard-deleted the row, taking its cost with it. **No return-to-supplier concept
existed anywhere** (`purchase_return|debit_note|credit_note` grepped to
nothing), so the claim had no record at all. And `expiringWithin(30)` was
hardcoded in three places, so **the one figure built to prevent this loss fired
after the claim window had already closed.**

`stock_disposals` carries snapshots — batch number, expiry, unit cost —
*because* the batch row is gone by the time anybody reads it. That
disappearance was the defect.

**The rule:** a batch with stock in it cannot be removed without saying where
it went; an empty one needs no explanation. Demanding a reason for housekeeping
trains somebody to pick whatever clears the dialogue fastest.

**Never summed.** Written-off is money lost; returned is money neither lost nor
recovered. Adding them overstates the loss by everything the distributor is
about to pay back. **Unknown is not zero** — a lot with no recorded cost is
counted but not valued, and the screen says so. **A return does not touch the
supplier ledger**: it is a claim, and what ARRIVED is recorded separately,
usually short of what was asked.

The window is now `ShopSettings::expiringSoonDays()` — one place, because the
tile and the screen it opens must agree. 90 for a pharmacy, 30 otherwise, and
the shop's own setting always wins.

**A lead checked and found FALSE before building on it:** I suspected
`destroy()` double-depleted batches. It does not — `reference_type: 'batch'`
sets `$batchScope = false`, which the code already documents.

Backend 1968 · panel 820. 16 tests, 4 mutations caught. One pre-existing test
updated: it removed a batch with stock and said nothing, which is now refused.

### 2026-08-16 — the report credited the person who typed

Found by reading the RETAIL trade. `staffPerformance` groups sales by
`created_by` and the panel called it **"Staff performance"** — two different
claims. The service's own docblock was honest ("the staff who rang them up");
the screen was not.

One-person shop: same person, report correct. Showroom floor: salesmen work the
customers, one cashier types, and the report credited the cashier with
everybody's month. **Worse than the forecourt version of this, because a wrong
name on a performance report reads as a judgement about a person.**

`sales.served_by`, nullable. The till figure is untouched and keeps its own
heading saying what it actually counts; the seller table sits above it when a
shop tracks one.

**It is never inferred, and the POS box is never pre-filled with the signed-in
cashier** — that would reintroduce the same lie while looking like the cashier
had chosen it. Unattributed sales are reported as unattributed; a test asserts
the cashier never shows up as a seller for one.

Off by default (`pos_ask_who_served`) and absent rather than disabled: most
shops here are one counter and one person, and a picker on every sale is a
slower till bought with nothing.

Worth not re-deriving: the seller list rides `GET /pos/sellers` and the cached
catalog, **not** `/staff`. A cashier holds `sales.manage`, not `staff.manage`,
and gating a name list behind the permission that EDITS people is this
codebase's own documented `*.manage` mistake. One private method feeds both.

Also checked and NOT gaps: exchange is atomic and reachable; serial-on-receive
and per-serial returns exist on both sides — the memory listing them as
outstanding was stale.

Backend 1952 · panel 820. 12 tests, 3 mutations caught.

### 2026-08-16 — the year nobody files against

Found by reading the FINANCE trade. Nothing was broken and every figure on
screen was correct — it just answered a question nobody in Pakistan asks.

Every "yearly" window resolved to 1 January – 31 December, in all three places
that compute one. Grepping `fiscal|tax_year|financial_year` across both apps
returned nothing at all.

**FBR's tax year runs 1 July – 30 June.** The annual return, the audited
accounts and every advance-tax working sit inside that window; a calendar-year
total is a figure that goes nowhere. It bites hardest on the tenant we sell
bookkeeping to as the entire product — Finance Manager has no catalog, no stock
and no till, so the date shortcut is not a convenience there, it is the screen.

**Added, never substituted.** A shopkeeper asking "is saal kitna kamaya" usually
does mean January to December. Two buttons, because they are two questions.

`App\Support\TaxYear` holds the rule and `reportPeriod.ts` mirrors it, with a
test asserting the two agree to the day — that pair has already drifted once
here, over which day a week starts.

**Not a setting.** July–June is statutory, this platform is PKR-only and
Pakistan-only, and a setting 99% of tenants must never touch is one the other 1%
gets wrong. **Quarters were checked and need nothing:** calendar quarters and
tax-year quarters fall on the same four boundaries.

Backend 1940 · panel 820. 16 tests, 4 mutations caught.

### 2026-08-16 — whose nozzle it was, and the column nobody could reach

Two entries in one, because the second is the first one's fault.

**The finding.** Read the petroleum trade rather than measured it — the kind of
finding no script produces, because nothing was missing. The forecourt close
already computes the number that matters most at a pump: `unbilled_litres`, fuel
that crossed a meter and was never rung up, per nozzle, meters against till,
test litres out of both sides, and kept deliberately apart from tank variance so
a hose being worked is never confused with a hole in the ground.

**It landed on the SHIFT.** An owner read "forty litres unbilled" and could not
say by whom. `opened_by` and `closed_by` are the manager, not the men on the
hoses. At a Pakistani pump the attendant IS the control — each works assigned
nozzles and hands over cash for their litres, that evening or never. A
station-wide total is a number an owner can worry about and cannot act on.

`attendant_id` went on the READING, not the shift: one shift has several
nozzles, and two men can be short on the same night for unrelated reasons.

**What it refuses to do is the honest half.** It does not split the unbilled
litres per man, and cannot: a till sale of twenty litres does not record which
nozzle it came from, so that gap is a station figure. Dividing it would be
inventing an accusation you could not defend to a man who says it was not him.
A test asserts the split is absent. Unassigned nozzles roll up under nobody
rather than vanishing — a shortfall no one is named for is still a shortfall.

**Then the second half, found the next day in my own work.** The column, the
validation, the relation, the computed totals and the API field all shipped —
and `attendant_id` had exactly one caller: the test suite. The panel's
`Start shift` button posted an empty body. **Fifth time this shape has been
found in this codebase; first time the author was me.**

Worse, the API made the panel's case impossible. `opening_reading` was
`required` on every entry of the array `attendant_id` rides on — so naming a man
obliged you to send a meter too, and **an echoed reading is written back to the
nozzle**. A screen posting its cached figure would have moved a totaliser while
assigning a person, silently, into the one number the whole reconciliation is
measured from. Every attendant test had passed `opening_reading` alongside
`attendant_id`, so the suite never exercised the case every real screen has:
**the tests agreed with the API because they were written against it.**

Now `opening_reading` is required only when the entry names nobody, the override
keys on the FIGURE rather than the entry (a missing key read as an override
would wind every assigned nozzle back to zero), and an entry carrying neither is
refused — which is what catches a mistyped key.

The start-shift screen asks the one thing the equipment cannot know and nothing
else; the meters open where the last shift left them. The closed shift leads
with a **Handover** table above the meters, because that is the part somebody
acts on tonight and the rest is read next morning if at all.

Backend 1931 · panel 813. 7 tests, 5 mutations caught across the two.

### 2026-08-15 — a bank funding its own card's transaction

Asked for as "banks ka CRUD, card par discount", and the design turned on one
sentence that changes the whole build: **this is not the shop's discount.** HBL
runs the offer, the customer pays less, and HBL reimburses the shop. The shop is
a channel for somebody else's marketing.

So the CLAIM REPORT is the feature and the till is the easy half. A discount
folded into a sale total is one the shop cannot invoice back — a marketing win
becomes a straight loss discovered at year end. It shipped WITH the POS row, not
after it. Full write-up in `docs/decisions/bank-card-offers.md`.

**The arithmetic is where this goes quietly wrong.** `total` does not move: the
shop parted with the whole bill and is owed all of it, part by the customer and
part by the bank. What drops is what is DUE, and the card tender with it, since
that money never crosses the counter. `bank_discount` is its own column beside
`discount` and `promo_discount` — three different people fund those three.

**The card field takes four digits and refuses sixteen** rather than trimming
them. A full PAN puts the shop and this platform inside PCI DSS, which is an
audit regime and not a setting, and a number accepted into the request is a
number in the logs. The label is half the control: a box saying "card number"
has sixteen digits in it by lunchtime on day one. The first six are refused too,
tempting as they are — six plus four is most of a card.

**Four open questions, answered.** Promotion and bank offer BOTH apply (the shop
prices the cart, the bank discounts the card slice of what is left) — "largest
wins" would let a campaign the shop is paid for cancel one it is paying for. The
split follows the card slice. The last-4 is optional and never blocks a sale;
the claim report flags what is missing. Permissions are the promotions split
exactly: `coupons.manage` to set up, `sales.manage` to apply.

**`OfferWindow` came out of it.** "Is this offer running right now" now has one
implementation, read by both engines. Two copies drift, and this codebase has
already paid for that — the offline mirror silently stopped applying promotions
the server was applying. Proof it is shared: one mutation of the
midnight-wrapping branch fails a bank test AND a promotion test.

Offline REFUSES a cart with a bank offer, and the reason is worth keeping: a
bank offer genuinely IS decidable by one till, so the refusal is about what this
till currently knows rather than what the rule permits. The words say so, and
tell the cashier the customer keeps the discount if they wait.

Six existing fences caught this on the way in and every one was right — the
nav-reachability pair, `screenPermissions`, the report-tab contract, the
mutation-feedback rule, and the Help Centre test, which is the standing "update
the Help Centre" rule enforced rather than remembered.

Backend 1898 / 8237, panel 813. Eighteen mutations across the engine, the sale
path, the claim report and the offline refusal — all caught.

Still open, both written down rather than half-built: returns do not yet reverse
a bank discount (decide with a bank first — most reimburse on the transaction),
and the claim report has no export.

---

### 2026-08-15 — three things that were built and never plugged in

Asked "what is actually pending on the web side", and answered it by measuring
rather than by re-reading a list: **every authenticated backend endpoint matched
against every string in the panel's source.** 252 of 259 endpoint shapes are
called. Of the seven that are not, three are false positives — the staff screens
build their path as `${basePath}/permissions`, which a literal match cannot see.

The other four were two real gaps, and a third turned up separately when the
receipt-size question was verified. All three are the same shape this codebase
keeps producing: **capability built, one link missing, nothing fails.**

**A buyer retyped their delivery address on every order.** The saved-address
endpoints have been on the server since the marketplace shipped — list, add,
edit, remove, one default kept correct atomically — and nothing ever called
them. Checkout had a bare text box. A customer ordering from the same shop every
week typed the same address every week, and a mistyped one is a rider at the
wrong gate. `DeliveryAddressField` makes it a pick; a signed-out visitor still
gets the plain box, because losing an address book must never cost an order.

**A buyer could not see or cancel a reservation they had made.** The shop's half
is complete — accept, reject, complete, with stock actually held. The buyer's
half was built and only `create` was ever wired. So somebody could ask a shop to
hold a fridge and then had to phone to find out what happened, while the shop
held stock for a person who changed their mind a week ago.

**A printer's own paper size was stored and read by nothing but its own test
page.** The receipt-size question came back half clean and half not:
`receipt_width` DOES reach the counter — the print and the settings preview
render the same Blade file, so they cannot drift, and that was deliberate. But a
shop with an A4 default (because it issues A4 invoices) and an 80mm thermal on
Lane 2 got a correct test print and a wrong receipt. The printer was already
being resolved in `show()` for the print log; it now also decides the paper.

The `mutationFeedback` test caught the address field on its first run — it could
delete a saved address and say nothing, which reads as a glitch rather than as
something you did. That test exists because of an earlier session's finding, and
it paid for itself again here.

Also written, not built: **`docs/decisions/bank-card-offers.md`** — banks that
fund a discount on their own cards. Two things settled before any migration: the
discount is the BANK's money, so the claim report is the feature and the POS
interaction is the easy half; and the card field stores the **last four digits
only**, because a full PAN puts a shop inside PCI DSS, which is an audit regime
rather than a setting. Four open questions listed there change the build.

Backend 1842 / 8098. Panel 809. Three mutations on the paper-size fix, all
caught.

---

### 2026-08-15 — the security pass, and the lock that locked the wrong people

The standing item from the 2026-08-11 backlog, and item 4 of the verified list.
Full write-up in `docs/decisions/security-pass.md`, with the denominator beside
every surface — because a count of findings is not evidence without a count of
attempts, and that discipline earned its keep twice in one session.

**The first sweep nearly filed a catastrophe that did not exist.** It reported
that *zero* of 215 mutating routes were authenticated. `route:list --json`
returns resolved middleware CLASS names, not the aliases routes are written
with. A surface where nothing at all is authenticated is not a finding, it is a
broken measuring stick — rerun properly, 185 of 209 carry `EnsurePermission` and
the other 24 are role-gated or self-service.

**The one that cost a real shop money: anyone could lock a shop out of its own
till.** The failed-attempt lock was checked BEFORE the password was, and that
guard is shared by both login paths. Five wrong passwords against a known email
took the shop off its POS — password *and* one-time code — for fifteen minutes,
from anywhere, with no credential at all, repeatable for as long as somebody
cared to. A locked counter at Friday rush hour is the whole loss.

The lock now refuses a wrong password and never a right one. An attacker still
gets five guesses per account per fifteen minutes; the owner who types their own
password gets in. Nothing was traded for it — a lock cannot stop somebody who
already has the password, so refusing them only ever cost the person it was
meant to protect. Two things fell out: every failure now reads identically (a
distinct "locked" reply was a free oracle for whether an address is real), and
knocking again while locked no longer extends the window, or the DoS returns at
one attempt a minute.

**The one that bypassed a guard that already existed: changing somebody's
password.** Staff create and update both refuse to grant a permission the actor
does not hold. Complete about permissions, blind about identity — a manager who
could not tick a box could set that person's password and sign in as them. Email
and phone are the same door, since login is by either. One sentence closes all
three: *you may only take over an account you could have created.*

Two smaller ones: a barcode's own characters reached the markup in `code128Svg`
(no caller today — escaped now rather than the day it gets one, because its
sibling IS rendered through `dangerouslySetInnerHTML`), and `vehicle_id` was not
tenant-scoped, which was explicitly **not** an exposure and is written up as
such — every read goes through the tenant scope.

Sound and recorded so nobody audits them twice: the customer surface (all three
controllers re-scope by `customer_id`), route-model binding, raw SQL, token
abilities and refresh rotation, uploads, receipt privacy, cost-price fencing.
Accepted and written down rather than fixed: tokens in `localStorage`.

Backend 1838 / 8086. Panel 809. Twelve mutations across the four fixes, all
caught — including putting the original lockout bug back, which kills five.

---

### 2026-08-15 — the three fields a synced sale was believed about

Offline's last five items, and four of them turned out to be the same bug wearing
different clothes: **the sync request carries something, and the server simply
believed it.**

**WHEN (P4-4).** `sold_at` decides the trading day, the shift, whose figures a
sale lands in and whether that day was already counted and banked — and it
arrived from a tablet. A cheap Android flat for a week comes back believing it is
the day it shipped, and a whole outage would file into days closed before the cut
began. Two layers now: the till corrects itself against the drift it measures on
every catalog pull (one place — `clock.ts` — so the sale's stamp, the promotion
windows, the pricing clock and the till's own last-contact record all move
together), and the server bounds what it cannot know. Not in the future. Not
before the till last reached us. The claim moves the smallest distance that makes
it possible, so P3-18's forty-day outbox is untouched. The tablet's wrong reading
is KEPT and rolled up per device on the offline report — a correction nobody can
see is a tablet that stays three days out for ever.

**WHO (P4-6).** `created_by` defaults to the authenticated user. Online that is
the cashier; on sync it is whoever reconnected. One person's entire outage was
landing in another's staff report. The till now names who rang it, checked to be
a live user of this shop. Deliberately the till's word and not the shift's —
under relief cover the reliever rings and the drawer stays the cashier's, so the
shift names the person who was on their break.

**WHERE (P5-5).** A tablet registered at Gulberg and carried to Saddar would file
a week of Gulberg's queue into Saddar's books and take it off Saddar's shelf. The
branch now comes from the device row, written by the server at registration.
Resolved beside the header it replaces rather than beside the sale row, because
branch prices are read from it.

**The hard stop (P3-17).** Opt-in, 0 = never. Judged from when the CART STARTED,
so a ceiling reached mid-transaction never strands a cashier with the goods
bagged. The one guard on the offline path whose every doubt falls towards
SELLING — a counter closed over a number nobody chose is a loss with no risk
behind it.

**P4-5** pins two screens against each other instead of adding a third: every
rupee the offline report calls late is a rupee the cashbook also has, on the day
it happened — and after a day close, `after_close_total` is exactly how far the
cashbook now stands ahead of a drawer that cannot move.

**Then the per-trade sweep** (`EveryTradeSellsTest`). Each trade already had deep
tests of its SPECIAL thing — FEFO, serving windows, serials. None proved the
ordinary thing: that a shop of that type can open, ring a sale, and have the
money arrive everywhere a shopkeeper looks for it that evening. That is exactly
where this codebase's recurring bug lives — *capability built, one link missing*
— and what catches it is not a deeper test of one feature but a shallow test of
the whole chain, repeated for every trade, because the missing link is never in
the same place twice. Seven trades × (the sale, the drawer, the cashbook, the
staff report, the cost that must never leave the server), plus finance asserting
the opposite: money moves, catalog stays shut. Plus each trade's offline verdict,
so the day somebody adds a fourth refusal to `OfflinePolicy` the question asked is
"which shops just lost the ability to trade through a power cut".

**Eighteen mutations run, all eighteen caught.** Two of them mattered: one proved
a fixture-level bug in my own reasoning (a mutation of `itemTypesFor` that looked
like it should fail and correctly did not — the guard it removed is redundant on
the live path and defensive only), and one caught a test asserting on an empty
loop, which is the `assert-not-empty-on-an-envelope` anti-pattern the standing
rule exists to stop.

Backend 1823 / 8059. Panel 801. **Offline: 63 of 64 — only the soak is left, and
it is a run, not a build.**

---

### 2026-08-15 — the shadow check earned its keep on day one

Phase 2's entire argument was that a mirror cannot be trusted until it has been
measured against real carts. The first day a real shop ran it, it returned nine
disagreements — all the same shape, all exactly ten per cent:

```
discount: server Rs 106.00, till Rs 0.00
total:    server Rs 954.00, till Rs 1,060.00
```

The shop had an active "Weekend 10% Off". The server applied it; the offline
engine did not, because `priceCart` had said so in a comment since the day it
was written. Nobody was mis-billed — the customer pays the server's price — but
a till allowed to sell offline would have printed a receipt ten per cent high on
every sale of that day. **That is the whole feature working exactly as designed.**

**Promotions are now mirrored** (`bestPromotion.ts`) and they were the exception
all along: an automatic promotion is a rule the shop wrote down in advance, the
same for every till, nothing to reserve and nothing to race over. A single till
CAN decide it alone, which is the only test the offline rule applies. Coupons,
loyalty and group discounts stay out for the reason they always did.

Fourteen new golden fixtures, rung through the real endpoint. Writing them found
two bugs in the fixtures themselves: promotions LEAKED between cases (every cart
after the fourth was priced against promotions it never asked for — the numbers
said so, a Rs 250 discount on carts meant to have none), and my first version
embedded database UUIDs, which would have made the gate go red on every run
instead of when pricing changed. A gate that always fails is the same as no gate.

Also: **a promotion the engine cannot evaluate stops the SHOP selling offline**,
not the cart — no cart can be rearranged to fix it. And switching a promotion off
travels as a TOMBSTONE, not a flag: the till drops the row entirely.

**Three other things this session, all found by the user testing:**

- **"Too many requests" after three quick sales.** The `api` limiter was 60/min
  for the whole SPA, set when the panel was a handful of pages. A POS spends it
  in twenty seconds. The counter now has its own — 600/min keyed by DEVICE,
  because small shops run four lanes off one login and keying by user alone
  would refuse the busiest shop first.
- **A till could not be given a name.** The backend accepted one and nothing
  ever sent it, so every device read "Unnamed till" — including in the offline
  report, whose whole point is that a fault on ONE tablet is a different problem
  from a fault in the shop. `PATCH /pos-devices/{id}`, deliberately NOT the
  register call, which stamps `last_seen_at`.
- **A P0 I had introduced.** IndexedDB is scoped to the browser ORIGIN, not the
  tenant, so one laptop used for two shops has ONE outbox — and a flush after
  switching accounts would post shop A's unsent sales under shop B's token, into
  shop B's books at shop B's prices. Rows now name their shop, and an unknown
  one is HELD rather than sent: everywhere else in that file the tie breaks
  towards sending, but here there is a third outcome worse than both.

Plus the **offline kill switch** the plan called for and nobody had built
(`offline_selling`, tenant-owned, default OFF), and the variance list is now
grouped by finding rather than one row per cart.

Backend **1754 → 1757**. Panel **735 → 780**. 20 mutations, all caught after two
of my own tests turned out too weak to kill theirs.

**Known flake, NOT from this work:** `DemoWorldIsCompleteTest::test_income_exists_and_one_row_carries_a_receipt_that_resolves`
failed once in a full run and passes in isolation and on re-run. It asserts a
file exists on the real public disk, so it is order-dependent on whatever else
touched storage. Worth fixing; not touched here.

### 2026-08-17 — two opinions, or a sale can disappear

Three items: P3-15 (training survives sync), P3-18 (a 40-day outbox), P4-3 (a
day already signed off). The first was supposed to be free and was not.

**P3-15 — the hole under the easy test.** `is_training` is inherited from the
shift and the offline payload already carries `cash_session_id`, so a practice
sale rung offline should just stay practice. Writing the test found the other
direction. Online a training sale is *loud* — banner, TRAINING on the slip,
`TRN-` number — and `SyncRequest` had deliberately dropped the `OwnOpenShift`
rule so a Tuesday sale could still land on Friday. Together those mean naming a
practice shift on a synced operation would turn a **real** sale into one that
takes no stock, earns no revenue and shows up nowhere. Silently. That is a way
to walk goods out of a shop, and it existed only on the path I built.

Fixed with a second opinion: the drawer says training, and so must the till
(`operations.*.training`). The till's word can only ever *withhold* — the
existing rule that a client flag must never create training still holds. Silence
counts as real, because a practice sale shown as real is visible and voidable
while the reverse is invisible. Disagreements are flagged, never silently
resolved. The same flag stops a trainee's afternoon walking the till's own local
stock figure down through goods that never moved.

**P3-18 — and a comment that lied.** A 40-day outbox syncs in full, and days 1
and 2 of a 40-day outage are *not* late while days 20 and 39 are. Writing that
test showed the doc comment on `beyondWindow` described an example the code does
not produce ("a sale rung five minutes before a till reconnected is not late").
The code is right — lateness is *how long had this till been away when it rang
this*, not *how old is this sale now* — so the comment was corrected in both
places it had been copied to.

**P4-3 — the money nobody was told about.** The spec said a sale from a closed
day should "post to the open day". It does not and must not: `sold_at` decides
the day, and moving Tuesday's sale to Wednesday makes both days wrong. What was
actually missing is the consequence — a business day's totals are frozen at
close and never recomputed, so Tuesday's *recorded* takings end up short of
Tuesday's *sales* with nothing saying so. New `sales.after_day_close`, stamped
at sync, and the report names the **amount in rupees** because an adjustment is
written from a figure, not a count.

**Mutation notes, both mine.** A `perl -0pi` mutation "applied" but hit the
*first* matching site in the file rather than the intended one — the file
changed, so my own applied/unchanged assert passed while proving nothing. Two of
four day-check mutations then survived on tests that were too weak (no day at
all, so a status filter was never exercised; one branch, so a branch filter was
never exercised). Both strengthened, all four now caught.

**One pre-existing flake fixed on the way.** `test_the_buying_price_never_leaves_the_server`
asserted the raw JSON body does not contain `190`. A randomly generated UUID
ending `bf19079b` contains `190`, and it failed on a build that had nothing to
do with it. Rewritten against the decoded item — and it now also catches a cost
leaked under a *renamed* field, which the substring check never did.

Backend **1734 → 1744**. Panel **693 → 703**. tsc/eslint/build clean, 18
warnings (baseline). 13 mutations run, all caught after the fixes above. Help
Centre and `docs/decisions/offline-pos.md` updated; the edge-case register rows
E9 and E12 were describing behaviour that no longer matches the code and were
corrected.

**60 of 64 test IDs.** Left: P3-10 (offline returns — the returns path is
untouched), P3-17 (the opt-in hard stop), P4-4 (a device clock days out), P4-5
(variance totals against the cashbook), P4-6 (offline sales in the staff
report), P5-4 (the 72-hour soak — a run, not a build), P5-5 (a device moved
branch offline).

### 2026-08-16 — out of room is not the same as low on room

P5-1, and it turned on splitting a condition that had been one.

The shift-open screen already warned about storage, and its comment said
plainly that it warns rather than blocks — *"a shop refused its own till over a
browser permission is worse than the risk"*. That reasoning is right and stands.
It is also about a different case.

`not-persisted` is a PROBABILITY: the browser may evict, some day, under
pressure that might never come. Being out of room is not — the next write fails,
and the write that fails is a sale, discovered with a customer at the counter.
So `shiftBlocker` blocks only at `FULL` (0.98), leaving `NEARLY_FULL` (0.9) as
the warning it always was. Refusing before a shift costs nothing: nobody has
paid. Refusing after costs a sale that already happened.

The message names the fix — sync, or clear cached images — because a blocked
till with no way forward is just a broken one, and a mutation that strips the
fix from the sentence is caught.

Panel **687 → 693**. 4 mutations, all caught. Help Centre updated.

### 2026-08-16 — the upgrade that must not eat the queue

Phase 5's first piece, and the one that can lose real money.

A shop trades through a two-day outage with two hundred sales queued. On the
third morning the app updates. If that upgrade drops, renames or recreates the
outbox, two hundred sales that already crossed a counter are gone — no copy
anywhere in the world, nobody aware they existed. **Nothing else in the app can
fail this way:** a lost catalog re-downloads, a lost cursor re-bootstraps. The
outbox is the one store with no upstream.

`db/upgrade.test.ts` seeds a till at an old version, writes two hundred queued
sales, runs the REAL `upgrade()`, and asserts every one survives **with its cart
intact** — a row whose cart was emptied still counts and is still worthless.
Three mutations confirm it bites: a release that recreates the outbox, one that
demotes the receipt counter to a cache, one that drops a store.

**The fixture has to be hand-written, and finding that out cost twenty minutes.**
The obvious build is `upgrade(db, 0)` at version 1 — but oldVersion 0 runs
*every* block, producing today's schema under an old version number, a database
no till has ever had. It failed with a ConstraintError that looked like a schema
bug until I instrumented `createObjectStore` and saw `categories` being created
twice.

Also: the update strip now says the queued sales survive the reload. The fear is
unfounded, but an unanswered fear postpones the update for a week.

Panel **678 → 687**. 4 mutations, all caught.

**Left in Phase 5:** P5-1 (quota → refuse to open a shift), P5-4 (72-hour soak —
a run, not a build), P5-5 (a device moved branch offline must not change branch).

### 2026-08-16 — the morning after

Phase 4's screen: **Reports → Offline**, `GET /reports/offline`. One question,
asked before the shop opens — *what did I miss, and is anything wrong?*

**Oversell is a SHELF query, not a sales query.** Two tills offline can each
sell the last carton and both are telling the truth. No sale is wrong, so no
sale can be found by looking for the mistake — the shelf is what is wrong, and a
negative `branch_stock` says so plainly. The screen calls it **"count these
again"**: naming it an error sends an owner looking for somebody to blame
instead of for a clipboard.

**"Nothing happened" is written as a real answer.** Most mornings this is empty,
and an empty table reads as a report that failed to load. It says the tills were
in touch the whole time — and a load FAILURE says something different, pinned by
a test, because a failure rendering as "nothing came in late" would tell an
owner everything was fine.

Also: offline **refunds and exchanges** are blocked with the reason *before* a
cashier promises the money back (P3-10) — the words live in `MONEY_BACK_OFFLINE`
and are tested, because "not allowed" sends someone hunting for a setting while
"take the customer's details" sends them to the counter. The POS pill's title
still said *"Sales can't be rung until this clears"*, which my own change had
made false; it now reads **"12 saved here"**.

**🔴 P3-16 as the plan wrote it is not safely buildable.** It asks for the
owner's PIN once the offline window has passed. Verifying a PIN with no server
means shipping its hash to the device, and a ShopOS PIN is four digits — ten
thousand guesses on a stolen tablet, after which that PIN opens every till in
the shop for ever. Built instead: selling continues, every sale past the window
is stamped `beyond_offline_window` and listed for the owner. The protection that
needs no secret on the device already exists — Settings → Your tills → Sign out.

Backend **1717 → 1729**. Panel **666 → 678**. 14 mutations, all caught after two
fixes: a `beyond_window` count test with only one sale could not tell the filter
from `count()`, and a UI test I wrote rendered **its own copy** of the refund
controls rather than the real screen — deleted, and replaced by testing the
shared copy for real.

### 2026-08-16 — a till that sells with nobody listening

Phase 3 of offline (`docs/decisions/offline-pos.md`), most of the way. A till
now rings a sale with no server, prints a slip, counts the stock down, and sends
everything when the line comes back.

**Server — `POST /pos/sync`.** Per operation, never per batch: one bad row in
fifty must not cost the other forty-nine. Its job is explicitly NOT to approve —
the money already crossed the counter, so out-of-stock sells to negative
(`allow_negative`, the mechanism the recipe path already used), a closed shift
still accepts, and a broken rule is flagged rather than fixed. **Rewriting a
credit sale into a cash one would leave a shop believing it had been paid.**

**Two trusts, deliberately not one.** `trusted_offline` lets the sync path set
`sold_at` and the device; `trusted_prices` stays off so the server re-prices
every cart. A mutation proved the second is dead code today — `SyncRequest`
borrows a rule set with no `unit_price`, so nothing arrives to trust — and it is
kept anyway as the second layer. Mutating **both** at once is caught.

**Client — the outbox.** Status machine, oldest-first, capped backoff, Web Locks
so one tab sends. `SENDING` is not a state a row may rest in: every one goes
back to PENDING on boot, because the tab was closed mid-request and nobody knows
whether it landed. A refused sale is KEPT — dropping it leaves a customer
holding a receipt for something the shop has no record of.

**Local stock is derived from the outbox, not stored beside it.** The shop this
is for: a mart shifts forty cartons of milk in one load-shedding evening, and
without it the till reads "forty in stock" on the fortieth sale. A second store
of deltas would drift, and the day it did the cashier would read the wrong one
silently. Summing the queue cannot drift, because it *is* the queue.

Backend **1694 → 1717**. Panel **565 → 663**. 18 mutations across both, all
caught. Two findings on the way: `pendingCount` counted every outbox row
including acked ones (a badge reading "47 unsent" at a till owing nothing), and
`owedCount` now counts anything NOT definitively finished — an over-count makes
a cashier ask a question, an under-count makes nobody ask anything.

**Still open in Phase 3:** offline returns (P3-10), training mode surviving sync
(P3-15), the `offline_days` PIN gate and hard stop (P3-16/17), a 40-day-old
outbox (P3-18). Then Phases 4 and 5 entirely.

### 2026-08-14 — the number that makes zero mean something

Phase 2 of offline (`docs/decisions/offline-pos.md`) had a hole in the middle of
its own gate. The build counted **findings** and nothing else, so the screen an
owner would read said "no disagreements" in both of these shops:

| what happened | what it showed |
|---|---|
| the engine agreed on 1,284 real carts | no disagreements |
| no till finished its catalog pull, so every check silently skipped | no disagreements |

Only the first is safe to ship on, and the second is the quieter of the two. The
plan's own gate already said "over **1,000 live carts**" — the code simply had
no way to tell you whether it had seen one.

**The tally.** Each till now counts what it did — checked / matched / skipped /
differed — bumped **inside** `runShadowCheck` rather than by its caller, because
a caller that forgets costs the denominator. It rides the device boot, not the
variance report: a till that finds nothing never reports a variance, and that is
precisely the till whose count the shop needs. Skips are counted **by reason**
(bounded at 12 + `other`), so a fortnight of "an item is not in the local
catalog yet" reads as the projection gap it is instead of a clean sheet.

Three rules, all following from the fact that this number's only job is to
authorise a risky change, so it must fail by **under**-claiming:

- Totals are **stored as sent, never accumulated** — a re-sent boot is a no-op,
  and a wiped till counting down takes the shop's total with it, correctly.
- The window is the **newest** reset across the fleet, not the oldest.
- **Revoked tills don't vote** — the question is whether the working fleet has
  been exercised.

**A Phase 1 bug fell out of it.** `deviceService.register` runs once per app
start, and nothing else touched `last_seen_at` — the clock the entire offline
policy reads. A counter tablet opened Monday and still open Friday, syncing
every fifteen minutes the whole time, sat on the owner's roster reading "last
reached us 4 days ago". It was measuring **time since the browser was
reloaded**. `pullNow` now touches the device at most every five minutes; the
boot claims the window it just used so a cold start is not two requests, and the
clock advances only on success so a failed touch retries immediately.

**Also:** Settings → POS → Lanes & PINs gained *Offline pricing checks*, which
leads with the denominator and warns separately when only part of the fleet is
reporting or when skips exceed 20%. Help Centre article `tills` added.

Backend **1677 → 1694**. Panel **520 → 565**. 19 mutations run across both, all
caught; two initially reported *file unchanged* (perl `$` interpolation) and one
was green for the wrong reason — `test_half_a_tally_is_refused` dropped several
fields at once, so it passed on whichever rule fired first and left the other
four unguarded. Now a `#[DataProvider]` over one field at a time.

### 2026-08-13 — the three fixes the verified list actually called for

Everything on the code side of `docs/audit-2026-08-12/VERIFIED.md` is now done.
Full suites green either side: **1601 backend tests**, **233 panel tests**,
build and eslint clean.

**The product-field fence** (`ProductCreateParityTest`, 5 tests). The bug class
was never the three fields already fixed — it was that nothing stopped a fourth.
The test has two halves that need each other: one diffs
`StoreProductRequest::rules()` against a declared list, so a NEW rule fails the
suite until somebody says where the field lands; the other POSTs a maximal
payload and reads every field back **out of the database**, so being named in
that list is an assertion rather than a promise. Every value is chosen to differ
from its column default — `is_active` and `visible_in_marketplace` default true
and are sent false, `sold_by` defaults to 'unit' and is sent 'weight' — because
a dropped field that happens to match the default proves nothing. Mutation-
checked both directions: removing `kitchen_station` from the insert fails the
round trip, adding a rule fails the fence.

**"Still selling this"** on the product form's Codes & packs tab. `is_active`
was the only accepted field with no control anywhere, and the list row offered
Delete and nothing else — so retiring a line meant deleting the record its own
sales history points at. The toggle sits deliberately OUTSIDE the goods-only
block above it: a service gets discontinued the same as a tin of paint.

**Settings tabs now filter on the module map.** The list went straight to
`FilterTabs` unfiltered, so a Finance tenant — no till, no catalog, no stock —
was handed Point of Sale, Loyalty, Receipt and Barcodes: four tabs of switches
that saved without complaint and changed nothing, on the first screen a new shop
opens. Only the POS *sub*-tabs filtered, which is why Kitchen hid itself
correctly and the four above it did not. Order and `needs` moved to
`src/modules/shop/settingsTabs.ts` so they are testable without mounting the
screen; the page keeps only the icons. "Sells" is the same `pos || marketplace
|| dine_in` test `reportTabs` uses — on purpose, so the two screens cannot
disagree about whether this shop sells anything. 6 tests including a brute force
over all 16 module combinations.

Help Centre updated for both screens per the standing rule, and
`docs/qa/ShopOS-QA-Testing-Guide.md` too — the settings map's module column, a
new tab-visibility step, seven new steps for retiring a product, and two rows
struck off its do-not-log list. It carries a dated note at the top so a tester
holding the earlier copy can see what moved.

**Still open, and none of it is code:** the published super-admin password (P0,
owner), the security pass neither side has had, the automotive job card and the
`food` inventory default (both P2 builds needing their own scope), and the two
deployment chores.

### 2026-08-13 — a handover list, verified against the source

An audit handoff arrived with eight claims to check. Every one was read in the
code rather than grepped for, and the result was roughly half: **three worth
fixing, five closed**. Written up in `docs/audit-2026-08-12/VERIFIED.md`, which
carries a CLOSED table with the reason for each rejection so the next pass does
not re-raise them.

**What survived.** `CreateProductAction` still names every column by hand while
`UpdateProductAction` fills the model wholesale — but the diff against
`StoreProductRequest` is **clean today**, all 42 fields written. What is missing
is the fence: only `drug_schedule` has a create-time assertion; `tax_group_id`
and `kitchen_station` have none. One parity test closes the whole bug class.
Separately, `is_active` is the only API field with no control in the product
form, and the list row offers Delete and nothing else — so a shop that stops
stocking an item must delete it and break its sales history, or re-import a CSV.
And automotive has no job card: `CustomerVehicle` and quotation→sale cover the
two ends, but not the car sitting in the bay accumulating parts and labour.

**What did not survive.** The trade gate genuinely does not exist on the backend
— and is not a security hole. `BelongsToTenant` scopes every model, and
`StoreProductRequest::withValidator` refuses `item_type: medicine` to a mart, so
a mart calling `/pharmacy/dispensing` reads an empty register of its own rows.
The finance-tenant Reports claim was wrong the other way: `reportTabs(features)`
already gives it exactly one tab. And the note saying none of the 9-Aug QA bugs
were fixed is stale — all nine were fixed on 2026-08-11.

**Services appointment booking is closed permanently**, reconfirmed by the owner.
It is in the CLOSED table and in the QA guide's do-not-log list.

**New, found while writing the QA guide:** `SETTINGS_TABS` is handed to
`FilterTabs` unfiltered, so a Finance tenant is offered Point of Sale, Loyalty
and Barcodes. Only the POS *sub*-tabs filter on the module map, which is why
Kitchen correctly hides. Cosmetic; the fix is the one line the sub-tabs already
have.

**`docs/qa/ShopOS-QA-Testing-Guide.md`** is new — a tester was given an account
and could not tell what to do first. It is ordered by dependency rather than by
screen: settings first (with a table mapping every settings tab to the module it
belongs to and where its effect shows), then category→product→supplier→PO→
receive→stock, then the till, then the aftermath, then one trade-specific
section per business type. It leads with how to read the module map off the
sidebar and the three gates, because most "this screen is missing" reports are
one of those. It also carries the known-gaps list so the same items stop coming
back, and it repeats the save→close→reopen rule, since the create-vs-update bug
shape above is exactly what a tester would otherwise miss.

### 2026-08-12 — the two audits that never ran

Both agents died on a session limit on 2026-08-09 and the work had been owed
since. Run inline. One real defect, one design question, and a lot cleared.

**The migration audit found `migrate:rollback` broken.** Two migrations dropped
a column while an index still named it — `product_batches.branch_id` and
`sales.customer_id` — so the recovery path for a bad deploy did not exist at
the moment it would be needed. Nothing caught it because the suite only ever
runs `migrate:fresh`; the down direction had never been executed by anything.

The fix order is **driver-specific and had to satisfy both**: SQLite refuses to
drop a column an index still names, so the index goes first; MySQL refuses to
drop an index a foreign key still needs, so the constraint goes before THAT.
Constraint → index → column. My SQLite-only fix passed locally and failed on
MySQL, which is the whole argument for running this against a real MySQL schema
(a scratch database, dropped afterwards — the dev DB was never touched).

CI now runs up → down → up on every push, against a FILE sqlite database, since
each artisan call is its own process and `:memory:` would not survive between
them.

**Cleared by the migration audit**, so it is not re-audited: every migration
has a real `down()`; money columns are consistent (12,2 money, 12,3 quantity);
the raw backfill subqueries all read a different table than the one being
updated, so none hits MySQL's restriction on that.

**The POS audit found no defect.** Recorded in detail because four separate
things looked wrong and were not: the checkout mutation has no `onError` but
renders `checkout.error` as a "Sale failed" alert; the till DOES send an
idempotency key, regenerated on every cart change so two identical baskets in a
row get different keys; underpayment is refused server-side with cash rounding
folded in; and schedule-controlled drugs are blocked server-side, with
`requires_prescription` only warning — a coherent split between law and shop
policy.

**One "design question" I raised here was WRONG, and the correction matters
more than the original note.** I reported that a cash POS sale with no
`cash_session_id` is ungated and that making it mandatory was an open product
decision needing a migration.

It is already built, already enforced and already tested. `pos_require_shift`
is a shop setting, `SaleController::store` throws `SHIFT_REQUIRED` (409) on the
counter channels when it is on, `MultiTerminalPosTest` pins that behaviour, and
the toggle is on Shop Settings → POS labelled "Require open shift". It ships
OFF, which is right — a one-person shop that never opens a drawer must not have
its sales refused on upgrade day.

I got it wrong by reading `CreateSaleAction` and not `SaleController`, which is
the layer the gate lives at. The 96 failures I cited were not the codebase
saying shift-less selling is sacred — they were the result of enforcing it
UNCONDITIONALLY, ignoring the setting that already existed. **Nothing to
decide and nothing to build.** The existing gate covers every counter sale
rather than cash alone, which is the stronger rule: it attributes every sale to
a cashier's shift, not just the ones that touch the drawer.

1596 tests, 7281 assertions · panel 227 tests.

### 2026-08-12 — every screen that changes something now says so

Closing the class QA found on Staff, and putting a guard under it.

**Three screens were genuinely mute.** `LabelsPage.generateAll` was the worst:
a loop of `mutateAsync` inside `try/finally` with **no catch**, so a failure
part-way through abandoned the rest silently — ask for 200 barcodes, get 40,
hear nothing. It reports the partial count now, because a partial result is
still a result. `MyOrdersPage` let a customer cancel their own order with no
word either way. `MarketHeader` could fail to sign you out and leave you signed
in, which matters most on a borrowed phone.

**Deletes reported nothing on failure** on collections, coupons, suppliers,
banners and announcements — and a refusal there is nearly always a REASON
("still referenced by something"), so it looked like a row that would not go
away. They surface the server's message now.

**A global `MutationCache` onError was the obvious fix and is the wrong one.**
A probe confirmed it fires even when the caller passed its own `onError`, and
`mutation.options.onError` is `undefined` for per-call handlers — so it cannot
tell whether the screen already spoke, and would double-report on fifteen
screens. Written down so it is not attempted again.

`mutationFeedback.test.ts` is the guard: a component calling `.mutate(` must
contain some route to the user. It uses `import.meta.glob` rather than
`node:fs`, which the app tsconfig has no types for. Mutation-checked by
stripping the feedback back out of `MyOrdersPage`.

**A correction worth keeping.** My sweep first reported 21 offending screens.
Most were a bad regex — `set[A-Z]\w*Error` cannot match `setError`, it consumes
the E — and `TakeOrderModal`, `OwnerOrdersPage` and `RidersPage` had proper
error handling all along. The real count was three. Third time this session a
grep produced a false finding; confirm "no caller" by reading the file.

1596 tests, 7281 assertions · panel 227 tests.

### 2026-08-12 — a QA report, and the screen that never said anything

Muhammad Bilal's staging report. Six findings; five were real, one could not be
reproduced, and the two headline ones turned out to be the same defect.

**"Suspend does nothing" and "no success/failure message" are one bug.** The
Staff screen had no feedback of any kind. Its only error surface was inside the
form modal, and Suspend is a button on the row BEHIND it — so a failed suspend
went nowhere at all, indistinguishable from one that worked. The backend was
never at fault: `QaStaffReportTest` proves create succeeds on the first attempt,
suspend suspends, and a suspended person cannot sign in.

**"Server error on the first create, works on the second" could not be
reproduced** — both consoles create first try. Most likely a cold start on the
$6 droplet or a 422 that only rendered inside the modal. With the feedback fixed
it will now say what went wrong; it needs a network-tab repro if it recurs.

**"Address and location not working" is staging config, not code.** Vite bakes
`VITE_GEOAPIFY_API_KEY` in at BUILD time and the droplet builds from its own
untracked `.env.production`, which has none. The DEV-only startup warning was
right — a production build must not crash over a map key — but silence was the
wrong other half. `MapPicker` now says the map is not set up on this
installation and that the address fields still save. **The droplet still needs
the key.**

**The CSV headers** shipped raw field names to somebody pricing shelves in
Excel. Fixed via `ProductCsv`, and the constraint is written where the next
person will edit it: the importer normalises `strtolower` + spaces-to-
underscores, so Title Case with the SAME WORDS round-trips — renaming a column
to something friendlier but different would normalise onto a field that does
not exist and drop silently, which is worse than the bug being fixed.

**What QA missed.** The template CSV was hand-rolled with `fputcsv` and carried
no UTF-8 BOM, while the export goes through `CsvExport` which writes one "so
Excel opens Urdu names correctly" — the one file a merchant TYPES INTO was the
one without the protection. And the no-feedback problem is not confined to
Staff: 21 screens mutate with no success toast, two of them
(`LabelsPage`, `MyOrdersPage`) with no feedback whatsoever.

**POS was checked and is fine** — record it so it is not re-audited. The
checkout mutation has no `onError`, which looks alarming, but `checkout.error`
renders a "Sale failed" alert in the tender modal; shift conflicts get an
in-modal error carrying the way out; scan failures show inline with a sound.

1596 tests, 7281 assertions · panel 225 tests.

### 2026-08-11 — the button the error message promised

Asked whether tables can be pre-assigned to staff. They cannot, and after
looking I do not think they should be yet — but the question found a bug.

**What exists** is claim-on-open: `restaurant_tickets.waiter_id` is set by
whoever opens the tab, `assertMayWork` blocks everyone else, `tables.serve_any`
lifts it. `dining_tables.area` is a free-text section label (already guarded by
a datalist), assignable to nobody. There is no `assigned_waiter_id` anywhere.

**The bug:** the refusal reads *"Ask them or a supervisor to hand the table
over"* — and `POST tickets/{ticket}/waiter` had never been called by anything.
No hook, no screen, no button. A shift change with open tabs had exactly one
resolution: grant `tables.serve_any` permanently, which is the blunt instrument
that permission exists to avoid.

**Why it was never finished** is the interesting part, and it is not laziness.
Naming the new waiter means choosing from a list, and the staff directory is
gated on `staff.manage` — hiring and firing — which a waiter neither has nor
should get. So the feature was blocked on a read that did not exist.
`GET /restaurant/servers` is that read, deliberately the smallest possible one:
id and name of colleagues who can work a floor, nothing else. A waiter already
sees those names on every tab that is not theirs and in the refusal itself.

Filtered in PHP, not SQL: `permissions` is a JSON column and a LIKE against it
matches a permission that merely CONTAINS this one.

**On pre-assignment — the recommendation, so it is not re-litigated.** Don't
build it until a real restaurant asks. Claim-on-open already gives the "if
nobody is assigned, anyone can take it" behaviour, which is the half that
matters; pre-assignment would only add the restrictive half. When it is built,
build it at SECTION level (20 tables is 20 decisions that go stale every
shift), and as a DEFAULT, never a fence — a fence fails relief cover, the same
way every other rule tried here has failed it. A section decides who a table
FALLS to when unclaimed; it never decides who MAY serve it.

`TableHandoverTest`, 12 tests. Three mutations checked: dropping the
`sales.manage` filter, the ownership guard, or the active-status filter each
fails it.

1581 tests, 7220 assertions · panel 225 tests.

### 2026-08-11 — the reorder list nobody could open

A flow audit that mostly disproved itself. I diffed all 331 tenant endpoints
against what the panel calls and claimed three findings; **two were wrong**, and
the corrections are the useful part of this entry.

**WRONG — "the permission registry has three copies."** Both consoles share one
`StaffPage` and both FETCH the list from the server (`useStaff.ts`, via a
templated `basePath` my grep normalised away). Which permissions exist has had
one source all along.

**WRONG — "expired stock cannot be written off."** `DELETE
/inventory/batches/{batch}` zeroes the lot, posts a stock movement OUT
referencing the batch, and the panel has reached it from the batch manager for
months.

**RIGHT, and the reason to do this at all — the reorder list.**
`GET /inventory/low-stock` existed, was branch-scope-FIXED on 2026-08-10 (so
somebody believed it was live), and `useLowStock()` existed in the panel. **No
screen called it.** The dashboard said "12 items are running low" and sent the
shopkeeper to the unfiltered inventory list to hunt a 500-row table for orange
badges. Now: `Needs reordering` on Inventory, driven by `?filter=low` so the
dashboard row deep-links to exactly the items it counted, and `Order these N
items` hands the whole shortfall to a draft purchase order — every low item a
line at its last known cost, supplier and quantities left to fill in. Retyping a
dozen products by hand was the step that made the list not worth opening.

Note the out-of-stock and expiring rows deliberately do NOT carry the filter:
the reorder list requires a reorder level, so an item at zero without one would
be missing from the very screen sent to fix it.

The two smaller gaps behind the wrong findings, both real:

- **Write off** now sits on each row of the expiry banner, where the shop is
  TOLD about it, instead of three steps away in the batch manager.
- **Permission labels moved to `Permissions::LABELS`**, beside the permissions.
  The server now ships `{key, label, hint}`. This is the guard that was missing
  when `tenants.reset_password` and `billing.view` shipped as bare slugs the
  panel humanised into "Tenants Reset Password" — the most dangerous checkbox
  on the platform, offered with no warning. `PermissionCatalogTest` fails on
  the same commit now; mutation-checked by adding a permission with no label.
  The panel keeps its map as a fallback for permissions a person holds that the
  catalog no longer offers.

Two walkthrough assertions were strengthened: `assertJsonFragment([KEY])` still
passed against the new shape by matching a substring, which is not what it was
written to check.

Help Centre updated for both screens, per the standing rule. The Inventory
article had been *promising* a reorder list that did not exist.

1569 tests, 7193 assertions · panel 225 tests.

### 2026-08-11 — the buying price stops walking out on the grid

The last open finding from the 2026-08-09 sweep, and the whole sweep is now
closed. The margin report was correctly shut to a cashier; the same figure then
walked out on the product grid the till loads every shift. Product reads are
gated on `READS_CATALOG` — which includes `sales.manage`, `kitchen.manage` and
`orders.manage` — and the model was serialised whole, so a cashier, a waiter
and the kitchen could all read what every item cost the shop.

`Permissions::READS_COST` (products / purchases / inventory `.manage`, plus
`reports.view`) and a `HidesCostPrice` concern used by **both** `Product` and
`ProductVariant`. The variant matters: it carries its own `cost` and is
serialised inside the product it belongs to, so guarding the parent alone moves
the leak one level down rather than closing it.

Guarded at `toArray()` rather than `$hidden` or a narrowed select, because
attribute access has to keep working — costing a sale line, valuing a shelf,
the CSV export behind its own permission. Only the serialised payload changes.

**`wholesale_price` is deliberately NOT hidden.** A partial version of this fix
stripped it alongside `cost` and a walkthrough test had been updated to pin
that. It is wrong: `wholesale_price` is a SELLING price, and the POS reads it
to offer the wholesale level (`levelBase` in `PosPage`). Hiding it from a
cashier protects nothing and silently removes wholesale selling from the till.
The assertion in `MartTenantWalkthroughTest` was corrected to require it.

`reports.view` is in `READS_COST` but not in `READS_CATALOG`, so it 403s on
`/products` — it earns its place for report payloads, not the catalog grid.
Written down in the test's provider so it is not "fixed" later by mistake.

`CostPriceVisibilityTest` — 10 tests. Three mutations checked: guard removed
(4 fail), variant guard removed (1 fail), and the over-broad version that also
strips `wholesale_price` (1 fail).

1563 tests, 7177 assertions.

### 2026-08-11 — the software explains itself

The question that started it was not a bug report: *"kitchen ki screen kisko
deni? table se order lene ki screen kisko?"* — an owner holding a finished
product and unable to work out who to hand which screen to. That is a defect in
the product, not in the owner. Full reasoning in
`docs/decisions/shopos-help-centre.md`.

I answered it first with `BUSINESS-FLOWS.md` and `MODULE-GUIDE.md`, and was
told plainly that was the wrong shape: *"not in md file make a help center type
screen."* Correct. A shopkeeper does not read the repo. Both docs were kept —
they serve a developer at handover — and the answer moved in-app.

**`/tenant/help` and `/admin/help`.** Full screen, outside `AppLayout` like the
POS, with its own header and a **Back to portal** button. Left rail: search plus
grouped, numbered topics that expand. Centre: the article. Right: "On this
page", built from the `h` blocks and tracked with an IntersectionObserver.
Anchors are handled by hand — the *pane* scrolls, not the window, so the
browser's own `#hash` handling never fires and `?topic=pos#taking-payment`
would otherwise land at the top.

**Filtered on the same three axes as the sidebar: module → trade → person.** A
restaurant is never shown how to count stock; a kitchen hand is never shown the
till. This was requested twice, the second time reversing the first — the route
was briefly public, then *"no public… each shop owner see content according to
his business type."* The reversal is right: help describing a screen you do not
have does not read as a stale document, it reads as a fault in the software.

**48 articles cover 43 of 44 tenant screens** — the 44th is the Help Centre
itself. 12 nest under a parent (Stock count and Transfers under Inventory,
Suppliers under Purchases). When asked whether it was complete I checked
instead of claiming, found **21 of 44**, and said so; the gap was then closed.

That check is now a test rather than a promise. `covers every screen the shop
has` diffs the articles against `TENANT_ROUTES` and **fails the build** when a
screen ships undocumented, with a written `NEEDS_NO_ARTICLE` list so "I forgot"
cannot look like "needs none". A second test proves a child is never shown when
its parent was filtered out — that would leave it in the rail with nothing to
hang under. Mutation-checked: deleting the module filter fails 4 of the 20.

Adding the route broke two existing tests, both correctly: `shopNavReach` (new
route absent from `src/test/routes.ts`) and `screenPermissions` (which pins
*exactly* which screens are ungated — was 3, now 5). Those firing is the guard
working.

**Standing rule, in the user's words: "whenever any change/update in code we
will also update help center screen."** Recorded in §8.

1553 tests, 7154 assertions · panel 224 tests.

### 2026-08-11 (later) — the admin side grows up, and a receipt stops being public

Six things asked for in one message; four were not what they looked like. Full
reasoning in `docs/decisions/shopos-admin-side-and-the-public-receipts.md`.

**Nobody could change their own password.** Not the owner, not a cashier, not
the super admin whose seeded password is printed in a public repo. The endpoint
and the panel's service method had both existed for months — no screen ever
called either. One `SecurityPage`, mounted at `/admin/security` and
`/tenant/security`, reachable from the avatar menu, which until now offered
platform users nothing but Sign out.

**A locked-out owner had no way back in** — the OTP reset needs the phone or
email they have lost, so recovery meant a MySQL console. `POST
/admin/tenants/{tenant}/owner-password` now exists behind its OWN permission
(`tenants.reset_password`, deliberately not part of `tenants.update`: editing a
phone number and taking over an account are different acts). Kills every session
the owner had, writes its own audit row naming both parties, never echoes the
password. Refuses to guess between two partners.

**Billing dates at creation** — `period.starts_at/ends_at` and a backdatable
`payment.paid_at`. Creation is the only moment the renewal anchor can be set
correctly, because every later period stacks onto it; a shop that joined
mid-cycle had the wrong renewal date forever.

**paid / grace / unpaid / suspended** — `Tenant::scopePaymentStatus`. Grace is
per PLAN (7/14/30 days), so a fixed grace puts enterprise shops in the wrong
bucket for three weeks; there is a test that fails if that regresses. The date
arithmetic is rearranged into PHP (`ends_at > now - graceDays`) because SQL
date maths differs per driver and this runs MySQL live, SQLite in tests. Buckets
are mutually exclusive by construction; deleted tenants belong to none.

**Security pass — five findings, all fixed.** The worst: expense and income
**receipts were on the `public` disk**, so a business's bills were served by the
web server with no token and no tenant check — the random filename was the whole
access-control model. Now private, behind an endpoint carrying the same scope
and permission as the row. Legacy files still read from `public`. Also: billing
was gated on role alone (every platform staffer could read the platform's
revenue) — gating the endpoint alone would have missed the dashboard printing it
anyway, and a test caught per-plan takings still riding along underneath. The
admin rail had **no** permission filter at all; the rule now lives in one file
read by the sidebar, the Quick Actions and a route guard. Plus CORS `*` and an
unrestricted CSV upload.

What the pass **cleared**, so it is not re-audited: `throttle:api` IS applied
globally (I suspected defined-but-unapplied; it is not), raw SQL is
parameterised, login does not leak account existence, refresh tokens rotate
single-use.

**Two manuals written** — `BUSINESS-FLOWS.md` (who gets which screen per trade)
and `MODULE-GUIDE.md` (how every module works). Writing them surfaced two more
"built but unreachable" defects: five permissions had no labels on the staff
form (including the most dangerous one on the platform, offered with no warning
at all), and `supplier_payment` — a fifth ledger row type added on the server —
was unknown to the panel, so those rows appeared unlabelled and unfilterable.

`Forecourt attendant` preset added: a station's counter job needs
`inventory.manage` because closing a forecourt shift sets stock to the dip, and
"Cashier" was the only thing on offer.

1553 tests, 7154 assertions · panel 204 tests.

### 2026-08-11 — the checklist runs, and one rule was tried and rejected

`php artisan shopos:readiness` is the launch checklist as a command. It lived in
prose here and in the deployment doc since July, and prose is not checked — the
seeded super-admin password has been "still TODO" in writing for two weeks and
is still `password`. It exits non-zero when the install is not fit to take
money, which is the part a deploy can act on; the tests are about the exit code
for that reason. Run against the dev box it failed immediately on that password.

A books-only shop can finally name who it paid. `expenses.supplier_id` was
validated and rendered, but `/suppliers` rides the inventory module, so the one
tenant whose whole product is the expense list could not use it. Fixed with a
`payee` (and `payer` on income) rather than by widening the gate — which was
tried and reverted, because most trades carry `expenses` and it opened the
vendor directory to everyone. A supplier is a stock-chain party with payables; a
landlord is not one.

**Tried and rejected: scoping the sales list to who rang each sale.** It looked
right — a cashier reprints their own receipt, a waiter cannot read the takings,
no date cliff. `BranchScopedReadsTest` then failed, and the reason is RELIEF
COVER: a cashier steps away, someone else works the same lane, and the reliever
would be unable to find the sale they need. The existing branch scope is the
honest limit for this screen. Recorded here because the idea will look good
again to whoever reads the leak report next.

STILL OPEN: a waiter on a single-branch shop therefore still sees that shop's
sales history. Narrowing it needs a rule that survives relief cover, and none of
the obvious ones do.

1493 tests, 6958 assertions.

### 2026-08-10 (later) — the pass, the floor, and who can hear whom

Three things the user found by using the real app, which no test covered.

**A kitchen hire was shown the shop's takings** to be allowed to mark a curry
ready. Not a missing gate — the rail filters by module and then by permission,
and the permission the kitchen board asked for was `sales.manage`, which is also
the key to the sales ledger, the day's banking and the quotes screen.
`kitchen.manage` is now its own permission; the board takes either, so a small
kitchen where one person cooks and rings up needs no second grant. The routes had
to MOVE, not just change — nested inside the floor's `sales.manage` group, an
inner ANY-of gate cannot loosen the wrapper above it.

Guards now exist in both directions. `PresetCanDoItsJobTest` proves a preset CAN
do its job; `presetSees` (panel) pins what all five presets are OFFERED across
six trades, and a backend test refuses a cook `/sales`, `/pos/day`,
`/reports/summary` and `/expenses`.

**The floor never heard back from the kitchen.** Firing looked live and marking
ready did not, and that difference was the bug: firing is the waiter's own
mutation so their cache invalidates locally, while the cook bumps in a different
browser that can invalidate nothing. `useTicket` — the query carrying kot_status
per line — had no `refetchInterval` at all. A sweep found only 7 of 33 modules
polling; held tickets and the lane picker had the same hole.

**Polling, not sockets, deliberately.** There is no realtime transport in this
product. Worth revisiting when the offline PWA lands, which needs one anyway.

**The floor gained a branch.** `dining_tables`, `restaurant_tickets` and
`kitchen_tickets` had none, so a two-site restaurant shared one floor and one
kitchen queue while its takings split correctly. Each row inherits — a tab from
its table, a KOT from its tab — and the models default the branch on create,
because a floor row with no branch is invisible on every branch-scoped screen,
which is worse than being on the wrong one.

STILL OPEN, both product decisions rather than bugs:
- A waiter sees the sales ledger and the day's banking, because they settle bills
  and hold `sales.manage` honestly. Recommendation: filter the ledger to TODAY
  for counter staff rather than raising the permission, which would take a
  working screen off cashiers.
- A books-only tenant still cannot name who it paid. `/suppliers` rides the
  inventory module and widening that gate broke six module-isolation tests.

1488 backend / 158 panel.

### 2026-08-10 — the branch that was added to money but not to stock

A four-tenant QA walkthrough (food, pharmacy, mart, books-only — 39 tests, every
one mutation-verified) found 11 defects. Six of them were one root cause: branch
was threaded through the MONEY last week and never through stock or the floor.

Eight are fixed here. The shape of each fix matters more than the count:

- **Receiving** honours the operating branch, resolved ONCE and reused for the
  movement, the lot and the serials — the bug was those three disagreeing, and
  fixing them separately would have left the same class of drift.
- **Supplier payments** are a fifth money source in the cashbook and ledger, NOT
  a fabricated Expense: inventing one double-counts the day a shop also files
  the wholesaler's bill. Refunds set that precedent already.
- **The reorder list** reads the branch's own shelf with a correlated subquery,
  because a product with no row on that shelf holds none of it — the most urgent
  case of all, and a join drops it.
- **Budgets** in the all-branches view count only company-wide ceilings. One
  shop's limit is not the company's, and unbudgeted is not a budget of zero.
- **Cost prices** are masked in `Product::toArray()` rather than in a
  controller, because a product is serialised from a dozen places and a rule
  enforced at one leaks from the other eleven. New `Permissions::READS_COST`.
- **Sale reads** now carry a module gate: a books-only shop gets 403, not an
  empty list. An empty list describes a shop with no trade rather than a shop
  without the feature.

Also: a flaky test that would have randomly reddened the new CI gate —
`assertStringNotContainsString('800', $json)` over a payload carrying timestamps
and hex UUIDs, where `…58.080026Z` contains "800". Replaced with a structural
assertion plus a recursive money-key scan.

TWO NOT FIXED, deliberately:
- **Books-only tenants still cannot name who they paid.** Gating `/suppliers` on
  `inventory OR expenses` broke six module-isolation tests, because most trades
  carry `expenses`. Needs a product decision: free-text payee, a separate payee
  list, or simply granting those tenants the inventory module.
- **The dine-in floor has no branch dimension at all** — `dining_tables`,
  `restaurant_tickets` and `kitchen_tickets` carry no `branch_id`, so a
  multi-site restaurant shares one floor and one kitchen queue.

OPEN, found by the user testing the real app after this work:
- Staff on the waiter/kitchen presets **see more than their permissions allow**,
  in the sidebar and the module list. `PresetCanDoItsJobTest` proves a preset CAN
  do its job; nothing proves it cannot do the rest.
- **Kitchen → floor is not live.** Firing pushes to the kitchen board without a
  reload; marking ready/served does not come back to dine-in without a refresh.

1487 tests, 6933 assertions. Pint clean.

### 2026-08-09 — a demo world that contains the product, and the seams tested

The demo seeder had stopped covering the product. Zero rows anywhere for
refunds, income, budgets, schedules and closed shifts — five features built,
tested, and then invisible to anyone clicking around, so the only way to see
them was to type the data in by hand. The branch-scope work could not be shown
at all, because no demo tenant had ever had a refund.

Metro Chain Superstore now has two branches, and it is the only tenant that
does. That is the point: every money screen scopes by branch, and with one
branch per tenant a scoping bug looks exactly like a working one.

Refunds and shifts go through the real actions rather than being written
straight to the table — a hand-written refund row restocks nothing and proves
nothing. The receipt on the income row is a real file on the public disk, since
a path pointing at nothing renders a broken link, which demonstrates the
opposite of what the receipt feature does.

`TradeWorkflowTest` is the QA pass: one daily loop per trade shape, asserting
on the FAR end of each chain. Both of its assertions were vacuous when first
written — `GET /restaurant/kitchen` returns a `{kots, stations, server_time}`
wrapper and `GET /cashbook` emits a row per day whether or not the shop opened,
so "not empty" passed in both cases. Found by mutation, which is now the
standing rule for a workflow test: **delete a step and watch it fail, or it is
not testing the chain.** The dependency graph and the traps are written up in
`docs/decisions/shopos-module-dependencies.md`.

1448 tests, 6250 assertions.

### 2026-08-07 — shift history

`/pos/sessions` has returned every shift in a date range, with per-lane totals,
since registers shipped, and `useShiftDay()` has been fetching it. **Nothing
rendered either.** A cashier counted out and a manager had no way to look back.

It is a fourth tab on the Day page rather than a new screen, because it is the
same subject the other way round: Today and Past days are organised by TRADING
DAY, this one by DRAWER. That answers what a day view cannot — how Lane 3 has
been counting out this week, which of Adeel's shifts came up short — and it is
the only place a **training shift** appears at all, since those belong to no
business day.

Unpaginated on purpose: the server returns the range whole with its own totals,
so the rows always add up to the figures above them. Training rows are tinted,
badged, and stated in words beneath the totals, because a total that visibly
skips rows reads as a bug until you know why.

Gated on `sales.manage` **and** `settings.manage` — what the route actually
asks for. Naming only one would have offered a tab that answers 403.

### 2026-08-07 — training mode (the web side is feature-complete)

A new cashier has to learn on something. The live till at a busy counter costs
phantom stock and a variance nobody can explain; nothing at all means learning
on real customers.

**The unit is the SHIFT, not the sale.** A per-sale switch lets practice and
real money mix in one drawer, and forgetting to switch back is exactly the
mistake that must be impossible. You open a shift in training, everything rung
on it is practice, and the mode cannot change while it runs
(`SHIFT_MODE_MISMATCH`).

Two structural fences, both chosen over "remember to filter it":

- **A global scope on `Sale`.** Practice is invisible to every query that does
  not explicitly ask for it (`Sale::withTraining()`). This is the mechanism the
  codebase already trusts for tenant isolation, and for the same reason: what
  must never leak cannot depend on every report written next year remembering
  to exclude it. The one raw `DB::table('sales')` read — `LedgerService` — does
  not go through Eloquent and filters by hand.
- **No business day.** A training shift belongs to no trading day, and the
  day's roll-up and banking gather sessions by `business_day_id`. Practice is
  not filtered out of the day's takings; it was never in them.

Training invoices take their own **`TRN-`** sequence. The real one is gap-free
on purpose — a tax authority reads a hole in it as a deleted sale.

**What training refuses matters as much as what it allows.** Khata, loyalty
redemption, serials and trade-ins all reach outside the sale and touch a real
record. Each could have been skipped silently, and each skip would be a quiet
lie — a khata sale that charged nobody, a serial sold twice. It refuses, with
`TRAINING_NOT_AVAILABLE` and a reason.

**What it deliberately keeps:** the drawer still reconciles — `DrawerMath` is
the one place that lifts the scope, safe because every query there is keyed by
`cash_session_id` and a sale inherits the shift's flag — and the receipt still
prints, stamped TRAINING top and bottom, in words, because that paper is
otherwise indistinguishable from a real one. The POS wears a full-width bar,
not a chip among chips.

**One leak found while building it:** the shift history summed every session
into its totals. A training shift is now listed but never summed.

There is also a test asserting a practice sale writes to **no table but the
sale itself** — it will fail on the next feature that writes somewhere new
during a sale, which is better than discovering it in a revenue figure.

Backend **1312 → 1329**. Panel **116 → 121**.

### 2026-08-07 — a tab belongs to the waiter serving it

The dine-in floor had one gate, `sales.manage`, and behind it every waiter could
open, work, settle and cancel every table in the building. The floor showed
which tables were taken and said nothing about by whom.

The reason that matters is money, not privacy. `/restaurant/reports/waiters` is
what a restaurant pays tips and commission off, and it attributes each tab's
takings to its waiter. If anybody can settle anybody's bill that report says
nothing about who earned it — and the error is **invisible**, because a settled
tab looks identical either way.

Writes to a tab now require that it is yours, or the new `tables.serve_any`.
Three edges are deliberate:

- **Reads stay open.** A waiter running a colleague's food needs to see the tab.
  A floor where half the tables are blank is worse than one where half are
  read-only, and hiding a bill prevents no mistake.
- **An unclaimed tab is everyone's.** No waiter set — a counter takeaway, a tab
  from before the column existed — must not become an orphan only an owner can
  settle.
- **Opening is always allowed.** You cannot trespass on a table nobody is
  serving; opening it is what makes it yours.

Hand-over is not the loophole: you may give your own table to anyone, but
taking someone else's needs the permission. Merge checks **both** tabs, since
folding another waiter's table into yours moves their evening onto your name.

Cashier, shift supervisor and manager presets carry `tables.serve_any` — the
till settles what the floor opened. **Waiter deliberately does not; that is the
feature.** A migration grants it to every existing staff member holding
`sales.manage`, so nobody loses access overnight, and it is tested by being run
by hand — `RefreshDatabase` migrates an empty database and would never execute
the loop.

**A real bug found while testing it:** reading the floor sat behind
`settings.manage`, which no preset grants. So the Waiter preset produced someone
who could not load the one screen they work all night. Reading the floor is now
`sales.manage`; laying it out stays with the owner.

Two more things that existed and did nothing: `dining_tables.area` was accepted
by the API and never set by the panel (now a Section field with grouped
headings, and a reorder that stays inside its section), and `hint` in the
panel's permission map was declared and never rendered — now shown under the
checkbox, which is exactly where "void a sale" and "refund a sale" needed
telling apart.

Backend **1295 → 1312**. Panel **109 → 116**.

### 2026-08-07 — settings the server enforced and nobody could set

Auditing the web side rather than answering from memory. Two sweeps:

**Dead endpoints: none.** Every tenant route has a panel caller. The first pass
reported 45 orphans and every one was false — the probe matched literal paths
and the panel builds most of its URLs from template literals
(`/products/${id}/images`). This is the *second* time that trap has produced a
fake audit result. Match on the longest literal segment, never the whole path.

**Inert settings: four real.** Of 57 keys, 18 looked suspicious and four were:

- **The discount ceiling was unreachable.** `max_discount_percent` and
  `max_discount_amount` have been enforced in `CreateSaleAction` and
  `CreateSaleDocumentAction` since they shipped, and `discounts.override` exists
  precisely to let a supervisor exceed them — but no field ever existed to set
  them, so both sat `null`, the ceiling was infinite and the permission guarded
  nothing. A cashier could take any amount off any bill. The enforcing code's own
  comment said *"an owner sets them in Settings → POS"*. Now that is true.
  Blank still means no limit, which is why this stayed silent for so long.
- **Tips were trapped inside the Kitchen card**, which only renders for dine-in
  tenants — so a salon, a workshop, a café counter or a delivery-only shop could
  never switch them on. Now its own card, gated by nothing.
- **Stock ageing had no field.** `BatchController` reads
  `stock_age_warn_years` / `stock_age_old_years` and its comment calls them
  "both configurable". Trade-gated to `automotive`: for a tyre this is age from
  a DOT week, not an expiry date, and calling it expiry in a pharmacy would be
  a dangerous mislabel.
- **`delivery_provider` was removed.** Declared in defaults, validated on save,
  read by nothing. Config that promises behaviour it doesn't have is worse than
  a missing feature; it comes back with the code that reads it.

**One thing I got wrong, recorded because the reasoning is the useful part.** I
also added server-side enforcement of `tips_enabled` — reject a tip when the
shop has tips off. It broke four `FoodServiceTest` cases, and on checking, the
premise was wrong: a tip is added to `$due`, so the cash really is in the drawer
and `DrawerMath` already expects it. There is no shortage to prevent.
`tips_enabled` is a client prompt toggle like `pos_auto_print`, and enforcing it
server-side would have rejected legitimate money. Reverted rather than amended
the tests to fit.

Backend **1295** (unchanged; a deletion). Panel 109.

### 2026-08-07 — job presets on the staff form

Confirmed the architecture rather than changed it: **ShopOS has no job roles.**
`UserRole` has five cases and a shop uses two — `shop_owner` and `staff`.
Cashier, waiter, kitchen and rider are **permission sets**, not roles, and
anything that branches on a role name for them is a bug that compiles.

What was missing was the question, not the model. An owner hiring their first
cashier faced seventeen bare checkboxes and had to already know that a cashier
needs `sales.manage` and `discounts.apply` but must **not** have `sales.void` —
knowledge the software has and the owner does not.

`GET /staff/presets` now answers "what job does this person do?", and the form
asks that first.

Three properties make it safe:

- **A preset is a starting point and leaves no trace.** What is stored is the
  same plain `permissions[]` array — no role column, no preset id on the user,
  nothing downstream that can tell one was used. That is precisely why it
  cannot rot into a shadow role. It also means editing a preset later does not
  silently re-permission anyone hired under it, which is the intended
  behaviour.
- **Filtered to the shop.** By granted modules, and by trade where a job exists
  in only one. A pharmacy is never offered "Waiter"; a books-only tenant is
  offered Accounts and Manager and nothing implying a counter. Noise on a
  permission screen is how the wrong box gets ticked.
- **No preset hands out `staff.manage` or `settings.manage`** — who works here
  and how the shop is configured stay with the owner unless deliberately
  ticked. There is a test asserting it for every preset.

The Kitchen preset says out loud that it also grants the floor, because the
kitchen board deliberately shares `sales.manage` (in a small kitchen the same
person cooks and rings up). Better stated than discovered.

The form shows which job the current ticks describe, recomputed from the ticks
themselves — deviate by one box and it reads "Custom".

Backend **1279 → 1295** (16 new). Panel 109.

### 2026-08-07 — loose ends cleared

Four small defects, each real:

- **`layaway_cancellation_fee_percent` was inert.** It existed in settings and
  in the panel's types, and nothing anywhere read it. It now has a field in
  Shop Settings and pre-fills the cancel dialog. Deliberately a **suggestion,
  never an application** — the server still defaults to handing every rupee
  back when no split is stated, because keeping a customer's money by accident
  is the worse mistake. All the setting saves is the arithmetic.
- **Three endpoints existed with no caller.** `GET /auth/sessions` +
  `DELETE /auth/sessions/{id}` — signed-in devices, now in Shop Settings, so a
  lost tablet can be signed out without throwing every working till off with
  "log out everywhere". `GET /restaurant/reports/waiters` — now the *Sections*
  button on the dine-in floor. `POST /restaurant/tables/reorder` — now move
  buttons in Edit floor mode (move, not drag: the floor is laid out on a tablet
  by the till, and a drag target that small means a table in the wrong place).
- **`auto_workshop` sat under two business types** with the same words and
  silently different capability — under `services` it cannot stock a single
  tyre. Relabelled "Auto Workshop (labour only)" rather than removed, because a
  mechanic who fits customer-supplied parts is a real trade.
- **Setup called a Finance Manager tenant a "shop" four times** on the first
  screen it ever shows. Now reads the capability the panel already knows.

City stays required at setup — every business has a location, and reports group
by it. Only the framing was wrong.

### 2026-08-07 — relief cover shipped

A cashier can now step away without the lane stopping. Someone else takes the
till, rings under their **own** name, and the drawer stays the responsibility of
the cashier who will count it.

`POST /pos/session/cover` · `/cover/end`. New `cash_session_covers` table.

The rule the whole design protects: **a cover moves the queue, not the drawer.**
Cover grants the right to SELL, never the right to RECONCILE — so a reliever
cannot close the drawer, cannot pay in or out of it (only `no_sale`, to make
change), and is never shown its opening float or expected cash. If it granted
both it would just be a handover with extra steps, and two people would be
accountable for one box.

Three decisions worth keeping:

- **Figures freeze at hand-back**, not on read. "What did the reliever take" is
  asked when the drawer is short, and an answer that drifts as sales are voided
  later settles nothing. Live while the cover is running, frozen once it ends —
  the same rule the day view already followed for open shifts.
- **The cashier's PIN ends the cover.** Unlocking with your own PIN is the
  gesture a counter will actually make; a reliever who has to remember to hand
  the till back sometimes won't, and the next sale would carry the wrong name.
- **Nobody holding their own drawer may cover another.** Two open drawers and
  one screen is how cash lands in the wrong box, and the person who really
  covers a break — the owner, a floor staffer — isn't holding a lane anyway.

The cover breakdown appears on the X-read, the Z-read and the printed slip, so a
cashier can say "that hour wasn't mine" from the same sheet that carries the
variance.

Backend **1258 → 1279** (21 new, 5395 assertions). Panel **102 → 109** (7 new).
All gates clean.

### 2026-08-07 — preservation

Audited what would actually survive a rebuild. Two things would not have:

- The **mobile app** had no git repository of its own. 134 tracked files, ~55%
  complete, sitting in a folder that `main`'s `.gitignore` excludes outright, so
  it was tracked nowhere. Now on the `mobile` branch (`0913477`).
- **31 files of decision history** lived only in `~/.claude/`. Now in
  `docs/decisions/`.

Also: committed the half-built relief-cover work to `wip/relief-cover` rather
than leaving it in a dirty tree; wrote this file; corrected README's shipped list
and test count. Flagged the public repo + exposed Geoapify key (§2).

Backend verified green at 1258 / 5288 with the WIP applied.

---

### 2026-08-26 — The Expense Manager, and a total that belonged to everyone

A UI pass over the four money screens — Cashbook, Ledger, Income, Expenses —
that found two real defects on the way.

**The total was the whole platform's.** `MoneyEntryFilters::totals()` cloned the
query and called `->getQuery()`, which hands back the underlying query builder
*before* Eloquent applies its global scopes — the tenant fence among them. The
rows underneath were always scoped, because the paginator goes through
`toBase()`; the figure above them was not. A shop with 178 bills read
"1,096 entries · Rs 4,678,156" over its own list: the headcount and the sum of
every business on the platform. Income read 555 / Rs 452,268 against 65 real
entries. `toBase()` is the fix and the two figures on the screen now describe
the same set of rows — which is also the assertion that catches it coming back.

**Today was the day it was in London.** `new Date().toISOString().slice(0, 10)`
was spelled by hand in eleven places across nine files. In Karachi (UTC+5) every
moment before 05:00 local is still yesterday in UTC, so between midnight and
five in the morning a new expense defaulted to yesterday, the `max` on the date
box refused today, and "this month" started on the last day of the month before.
`toIsoDate()` has existed in `dateRanges.ts` for exactly this reason.
`common/format/localDate.test.ts` is now a lint rule wearing a test's clothes, so
the twelfth cannot be — mutation-proven.

**An accessibility helper widened the page by 84px.** `sr-only` is
`position: absolute`, so a `<span className="sr-only">Actions</span>` in a `<th>`
with no positioned ancestor has the *page* as its containing block — which puts
it outside the scroll container's clipping chain. At 390px the table lays out
477px wide inside a 356px scroller, the span sits at x=474, and one invisible
pixel of helper text pushed the whole page sideways. `relative` on the `<th>`.
The existing e2e sideways-scroll rule catches it: proven by putting the bug back
and watching `[phone] expenses` fail, then pass.

The UI work itself: expenses and income were two hand-written tables with the
same eight columns and a different opinion about every one of them; they render
through one `MoneyEntryTable` now. Money is formatted once
(`Rs 2,350,196.50`, never `Rs 2,350,196.5`), dates are read by humans, the
filtered totals are a card of three figures rather than two lines of grey
caption, both lists sort by clicking Date or Amount, budgets say "Not watched"
rather than showing twelve empty boxes, and all three tabs fit a 390px phone
with **no sideways scroll at all** — where before Edit and Delete lived off the
right edge of the card.

Also fixed: the page carried one subtitle over all four tabs, and it described
the fourth. And on Budgets, "Budgeted Rs 100" sat beside "Spent Rs 960,318" —
the spend summed over twelve categories, the budget over the one that had a
ceiling.

Backend 2354 green on SQLite and MySQL. Panel 1250 unit, 0 lint errors, build
clean, 26 e2e across four device sizes.

---

### 2026-08-27 — A switch with nothing on the other end

Asked to check "all toggles are properly integrated on their places". The
Settings page writes **50** preferences; each was traced to a reader, because a
count of files MENTIONING a key is not a count of readers — the migration, the
validator and the allow-list all mention it.

**49 had one. `pos_require_shift` had none in the panel.** The server honours
it correctly (`cash_session_id` is nullable; SaleController refuses a shiftless
counter sale only when the shop asked). The till asked
`canRing = activeSessionId !== null` and nothing else, so shift discipline was
always on at the counter whatever the shop had chosen — and a one-person shop
that had never opened a drawer **could not ring a single sale**, which is
exactly what the backend test pinning the default says must never happen. Both
directions are now proven in a browser. It lives in `canRingASale()` beside
`whyCannotRing()`, so the gate and the sentence under the disabled button
cannot drift apart again.

**The receipt size was not broken.** Save → persist → a real sale renders
`@page { size: 80mm auto }`, verified end to end against the running API and
already covered by five tests. What was missing is that the till never SAID so,
and a lane's own printer legitimately overrides the shop default, so the
Settings screen could not answer it either. The server now returns
`X-Receipt-Paper` on the receipt itself and the sale-complete modal reads
"Receipt sent to the printer · 80mm roll". The Help Centre was also sending
readers to Point of Sale for a control that lives on the Receipt tab.

**The install prompt was sitting on the dine-in tab's Settle button.** It is
`fixed bottom-3` at `z-[99998]`; AppLayout pads by `--pinned-bottom` and
HelpCenterPage subtracts it. The four pages that run outside the shell — till,
floor, tab, kitchen — did neither, and a page that is exactly `h-dvh` has no
scroll room to recover with. `FULL_SCREEN_PAGE` is now the one spelling, and
its guard reads the ROUTER for the page list.

**Dine-in on a phone.** `restaurant` and `restaurant-tablet` existed, under a
comment saying the floor and tab are "held in a waiter's hands" — answered with
an iPad. A waiter holds a phone. The floor's header ran 15px off a 390px screen
with "+ Takeaway" as the half over the edge; the tab workspace was `w-3/5` /
`w-2/5` with no breakpoint at all, 234px of menu beside 156px of tab. Both
fixed, `restaurant-phone` added, and **the tab workspace is walked by a browser
for the first time**.

Two detectors were wrong before they were right, both failing in the direction
that looks like success: the full-screen guard found ZERO pages because
`App.tsx` mounts `AppLayout` twice and `indexOf` found the admin one; and
`everyScreenIsWalked` reported the floor and kitchen as unwalked when the tab's
`path` became a function, because its literal-only regex stopped matching the
whole array. Only denominators caught either.

Settings also rebalanced: typed values and switches are separate cards, the
switch grid is full-width (271–491px cards instead of ~110px — `xl:` is a
VIEWPORT query, and the column was 540px), and the expiry field is no longer a
bare input in a grid of switch-cards.

Backend 2356 green on SQLite and MySQL. Panel 1267 unit, 0 lint errors, build
clean. 20/20 restaurant e2e across desktop, tablet and phone; every Settings
tab 0-sideways at 1440/1024/820/390.

---

### 2026-08-27 — The till had no offline shell

First bug reports from the live shop (`panel.cartze.shop`). Three defects, all
verified in a browser.

**The till never registered a service worker.** `ServiceWorkerHost` was mounted
in `AppLayout`, and the till, floor, tab and kitchen board render outside it —
so opening `/tenant/pos` directly, which is how a till is opened, registered
nothing and precached nothing. `/tenant` → `regs: 1`; `/tenant/pos` → `regs: 0`,
and an offline reload died with `ERR_INTERNET_DISCONNECTED`. That is the whole
of "products show nahi hui". It is now mounted by `TenantThemed` and
`AdminShell` — one per console, because `useRegisterSW` registers again on a
second call.

**`offline-shift.spec.ts` had been failing on precisely this, and an earlier
session dismissed it as pre-existing and environmental.** It passes now. A
failing test that names the symptom exactly is not noise.

**"Sync now" reported success without looking at the queue.** Two faults at
once. The retry backoff caps at ten minutes and `dueRows` filtered on it, so a
press after a few failures found nothing DUE and sent nothing — while
reporting "Up to date". And the button read success off `pullNow` resolving,
which swallows flush failures on purpose, so the catalog coming *down* was
being reported as the sales having gone *up*. A press now forces the first
round, the flush result is returned rather than discarded, and the label says
`4 still to send` or `3 refused`. The old screen drew "Up to date" beside a
badge reading 4 — both from the same component, and the false one was the
reassuring one.

**A shop could not ask whether a device was ready.** The catalog has always
synced on its own and all of it is invisible, so the only way to find out was
to have an outage. `OfflineReadyPanel` (Settings → POS → Lanes & PINs) states
what THIS device holds — products, customers, and **codes separately**, because
a till with a full catalog and an empty barcode index can be searched by hand
and cannot be scanned.

Two plausible theories checked and found wrong before being acted on: HTTPS
(the server already redirects and serves 200 — the secure context was fine),
and the barcode index (`1` row against 31 products was correct; exactly one
product in that fixture carries a code).

Panel 1282 unit, 0 lint errors, build clean.

---

## 8. Rules that must not be broken

These are settled decisions, not preferences — most of them were paid for with a
bug.

- **Pricing is server-authoritative.** HTTP never supplies `unit_price`, `tax` or
  `line_total`. `trusted_prices` exists for internal paths only.
- **Run the browser suite awake:** `caffeinate -i npx playwright test`. A run is
  longer than the sixty-minute token TTL is forgiving, and a sleeping laptop
  turns that into eighteen failures that name features instead of naming the
  clock. `e2e/clockReporter.ts` says so now, but only after the fact.
- **PKR only.** Never render `$`.
- **No secrets in git**, and rotate anything exposed.
- **Demo seeders must never run against production.**
- **No service or appointment booking — ever.** A service business lists what it
  does and what it costs. Decided 2026-08-06; `reservations` defaults off for
  that type on purpose.
- **A type proposes modules; the admin assigns them.**
- **Snapshot, don't recompute**, for anything a customer was told: a warranty
  verdict is frozen at intake, a Z-read comes off the frozen row, a cover's
  figures freeze at hand-back. A number that quietly changes later settles no
  argument.
- **`resolution === null` is the open state** for warranty claims, and
  `ended_at === null` for covers — no status column that can disagree with the
  field beside it.
- **Reads take a permission set, writes take one permission.** A read is
  justified by any of the jobs that need to look; a write has one answer. The
  panel must say "you do not have access" rather than render an empty list —
  `deniedReason()` + `<NoAccess>`. `2026-08-08`.
- **A test may not encode a bug as an assertion.** `CatalogTest` asserted that a
  staff member holding `sales.manage` got a 403 from `GET /products`. That staff
  member is a cashier; the test guarded the bug for as long as it existed. When
  a test asserts a refusal, check whose job it refuses.
- **A write permission must never gate a read**, and **a setting that saves must
  be read by something.** Both are the same failure: a control that looks like it
  works. Settings was audited key by key on `2026-08-08` — 48 keys, all validated,
  three of them inert and now wired.
- **`items-center` + `overflow-y-auto` on one element hides the top of tall
  content.** Centre on an inner `min-h-full` wrapper instead. See
  `docs/decisions/shopos-panel-shared-shells.md`.
- **For any column a feature READS, find who writes it.** Three columns
  (`drug_schedule`, `tax_group_id`, `kitchen_station`) were validated, sent by
  the form and never written, because `CreateProductAction` names its insert
  columns one by one and `UpdateProductAction` fills wholesale — so they saved on
  the *second* press of Save. `2026-08-09`, see
  `docs/decisions/shopos-import-and-dropped-columns.md`.
- **Real money must never post to a practice till.** An expense is always real;
  a practice shift discards everything on it. Pair them and the real drawer
  closes short while the entry is frozen by the practice shift's close. Use
  `App\Support\BooksDrawer` — a practice shift is treated as no shift.
- **Filters: always-visible bar + right-side canvas + removable chips above the
  table.** The chips are not decoration; a canvas that hides what is applied is
  how a merchant concludes the numbers are wrong. Bottom sheet only below `sm`.
- **A money read that takes no branch is a bug, not a default.** The Cashbook was
  tenant-wide while the Ledger scoped by `BranchContext`, so the two screens
  reported different money for the same period. Anything summing money takes
  `?string $branchId` and the controller passes `BranchContext::scopeId()` — null
  means the owner's all-branches roll-up, and it must be *chosen*. Watch the
  **opening balance** hardest: money before the window is never drawn as a row,
  so an unscoped figure cannot be seen, it just shifts every balance down the
  page. `2026-08-09`, see
  `docs/decisions/shopos-branch-scope-and-the-unread-columns.md`.
- **`RefreshDatabase` cannot test a data backfill** — it migrates an empty
  database, so the `update()` runs over nothing and passes. Exercise the real
  statement against the MySQL dev DB inside a transaction and roll it back.
- **Prove a new test fails without its fix.** Revert the fix, watch the test go
  red, restore. Four of the six branch-scope tests written this session would
  have passed against the live bug; only reverting showed which two were load
  bearing.
- **A backend endpoint is not shipped until something calls it.** Finish the
  panel half in the same pass, or the fix for "built but unreachable" becomes
  five more of it. A CSV built in the browser must quote commas/quotes/newlines,
  lead with a BOM, and prefix `= + - @` — a spreadsheet runs those as formulas.
  Use `downloadCsv` in `src/common/api/download.ts`; server-streamed exports stay
  server-side, because an export of page one is not an export.
- **A change to a screen is a change to the Help Centre.** `src/modules/help/
  content.ts` is what a shopkeeper reads to work out how their shop runs, and
  help that describes last month's screen is worse than none — it reads as a
  fault in the software rather than a stale document. When you add, move,
  rename or gate a screen, update the article in the same pass, and give the
  article the same `modules` / `trades` / `permission` the screen itself
  carries so each tenant keeps seeing only what they actually have.
  `src/modules/help/content.test.ts` pins the per-trade filtering.
- Commit and push only when asked.

### Gates, run from each app's directory

```bash
# backend
php artisan test
./vendor/bin/pint app/Path/To/Changed.php     # specific paths, never repo-wide

# panel
npx tsc --noEmit -p tsconfig.app.json
npm run build
npx vitest run
npx eslint src/modules/changed/
```

Two things that will bite you in the backend tests: decimal columns serialise as
**strings**, so use `assertEquals`, not `assertSame`; and Eloquent's `create()`
does not hydrate columns the insert didn't name, so `->refresh()` before you read
them back.

---

### 2026-08-30 — a payment nobody had ever tested, and one shelf cached as two

Two reports in one sitting: *"suppliers ka payment process work nahi kar raha —
agar wo pay karta, kitna remaining"*, and *"inventory full module check karo,
connected hai jahan jahan use ho raha"*. Both turned out to be the same shape of
fault: **the thing worked through a door nobody uses.**

**The payment.** The Suppliers list has a Pay button. It sends an amount and a
method — there is no order picker on it and never has been. The server accepted
every one of those payments: filed the row, took the cash out of the drawer, and
applied it to **nothing**, because `outstanding` was
`sum(po.total) − sum(po.amount_paid)` and `amount_paid` only moves when a payment
*names* an order. The red figure did not change. The shopkeeper pays, sees the
same number, pays again.

2,373 green tests never saw it because **every payment test passed
`purchase_order_id`**. The API had a door the UI does not use, and that door was
the only one under test. `PaymentOnAccountTest` opens the real one; all seven of
its checks failed on the unfixed code.

Three readers also disagreed about what "owed" means — the supplier row counted
DRAFT orders as debt, the dashboard did not. So a supplier the shop owed nothing
to carried a red figure and a Pay button. `App\Support\Payable` draws that line
once: an order becomes a bill when it is **placed**.

The balance is now **signed**: placed order totals minus *all* payments, not
`amount_paid`. The difference is money that never landed on an order — the van
arrives, cash changes hands, no PO is raised. `CashMovementTest` has covered
exactly that since August. Negative is an **advance**, named as such on the row.
Refusing it would have been the easy consistency and the wrong one.

And the dialog now says, the moment an amount is typed, what will still be owed
after it. That was the actual request.

**The cache.** `["products"]` is the catalogue; `["inventory"]` is what the
stockroom screens read. Nine sites refreshed the first and left the second. The
worst was **receiving a purchase order** — the main way stock enters a shop:
a buyer who had just booked in a delivery still saw those items on Needs
reordering. The sharpest was the **branch switcher**, which named four keys and
not inventory: switch branch, open the reorder list, and it kept showing the
FIRST branch's list under the SECOND branch's name until you navigated away and
back. A mounted query does not refetch on staleness alone.

The rule is now *wherever products is invalidated, inventory is invalidated
beside it* — not a list of stock-moving endpoints, because a list needs
maintaining and this one was missing six. Guarded, with a denominator, and
mutation-proven.

**Two things I got wrong on the way.** A `status` column cast to an enum made
`in_array($po->status, [...strings...], true)` match nothing — the draft check
silently passed everything until a test caught it. And my first mutation of the
new phone test used a 3,000px-**wide** child and passed: `openThingsFit` measures
**height** and the modal clips horizontally. A tall child fails it properly. A
mutation that does not fail has not proved the test — it has proved the mutation
was aimed at the wrong rule.

**A third, found while checking the rest of the module.** A product sold in
sizes holds no stock of its own, and the parent's `stock_quantity` is an
orphaned leftover `effectiveStock()` never reads. Adjusting the parent wrote
twenty shirts into it, answered **201 "Stock updated"**, and moved the shelf by
nothing — measured: effectiveStock 12 before, 12 after. Same hole through the
batch dialog, which never sent a size, so a chemist could book in fifty strips
and leave the size at zero with a lot on the books saying otherwise.

`StartStockCountAction` already stated that rule in a comment. It was absent
from the path a shopkeeper presses. `InventoryService::adjust` now refuses
(`VARIANT_REQUIRED`) — in the service, so all 28 call sites are covered by one
check, and the suite stayed green, which says nothing legitimate relied on it.
A refusal is only honest if the job can still be done, so the parent's Adjust is
gone (each size row has its own), the batch dialog has a required size picker,
and every lot is labelled with its size.

**And the sharpest one, found last.** The Inventory page draws a sub-row per
size — `p.variants.map(...)`, unguarded — and the low-stock endpoint never sent
`variants`. **The reorder view would have gone blank** the moment the list had a
sized row to draw. It had only ever been seen empty, which is the only reason
nobody met it: the shop that reported "reordering shows empty" was saved by the
empty state. TypeScript could not catch it (the type says the field is not
optional; a relation nobody loaded is missing anyway), and `chrome.spec` walks
that screen with no filter against a shop whose reorder list is empty.

**A note on how I measured, because I got it wrong first.** I ran the full
backend suite, a full vitest run and four `npm run build`s while a Playwright
suite was running against the very `dist/` I kept rebuilding. It reported 16
failures with durations of 43 minutes, 1.3 hours and 4.1 hours, and an
accessibility ratchet saying `2/5 unnamed` on every admin screen. `e2e/api.ts`
already has that diagnosis written down in a comment — a starved suite crosses
the 60-minute token TTL and every spec after it is measuring the signed-out
shell. I threw the run away and re-ran on a quiet machine rather than report any
of it. **A suite competing with the thing it is testing is not a measurement.**

See `docs/decisions/shopos-supplier-payment-on-account.md`,
`docs/decisions/shopos-stock-and-inventory-one-cache.md` and
`docs/decisions/shopos-sizes-hold-the-stock.md`.

---

### 2026-08-30 — empty has two meanings, and silence has one

The reorder list came back **empty** on the live shop and was reported as a
breakage. It was not: it was correct for the first time. What was wrong is that
the screen said the same sentence for two unrelated situations — *nothing is
below its level* (good news) and *no item has a level set at all*, for which
this screen can never show a row and nobody was being told. `meta.watched` now
carries the count and the empty state names which one it is.

**And the arm nobody had tested.** An owner with no `X-Branch-Id` is `scopeAll`,
so every test written the day before took the shop-wide path. A staff member is
always pinned to a branch. The branch arm — what most of the shop actually sees
— had no test at all; it does now, and it was correct.

**Silence, measured.** 66 of 191 mutation call sites have no visible failure
path, and there is no global handler (`queryClient` declares no `MutationCache`).
Fixed where it was worst and where it was asked about: purchases' **Place
order** showed neither its refusal nor its success — `PO_NOT_DRAFT` is what a
second tab produces, and the button just un-disabled itself; a medicine's
**expiry date** wrote on change and said nothing either way; a **supplier
payment** closed its dialog without a word, which is how a shop pays twice. The
remaining 66 want one `MutationCache.onError`, not 66 edits — left for the
owner to decide, because it changes every screen at once.

**A correction of my own.** I reported the supplier payment as failing silently.
It was not: the modal renders `pay.error`, and the save path renders
`firstFieldError()`, which names the field — better than a toast. I had read the
`mutate()` call site and not the render, and briefly shipped duplicate
messaging on a page that was already right. Read the render, not the call.

**Responsiveness, with the work open.** `chrome.spec` walks every screen at four
widths and passes — *at rest*. It opens nothing, so `openThingsFit` had never
fired on a dialog. `e2e/modules-on-a-phone.spec.ts` opens the form on suppliers
and purchases and measures the labels sheet; all three fit at 390px, proven by
injecting a 3000px element and watching both fail.

---

### 2026-08-29 — the reorder list that listed everything

A shop said *"in inventory need reordering not working"* and it was one question
— **what is running low** — asked in five places and answered in two. The
catalogue summed a product's sizes; the reorder list, the dashboard count, the
purchase-order quantity and two table badges read `products.stock_quantity`,
which for a sized product is nought. `0 <= threshold` holds for every threshold
a shop can set, so **a rail of two hundred shirts was on the buying list every
day** and the order it raised asked for a full threshold of shirts already in
stock.

Now one `LowStock` rule on the server and the till's existing `catalogStock` on
the panel — the panel helper was already there, written after a T-shirt rendered
unpressable, and two screens had hand-rolled a wrong copy beside it. The failure
was an IGNORED helper, not a missing one.

`one-rule-many-paths.py` was blind to it: it tracks rules that raise an error
code, and this is a query predicate. `e2e/lowStockAsksOneRule.guard.ts` covers
that axis now, with a denominator and a proven mutation.

**And two browser failures that were not the product.** `selling.spec` filled
its cart from "any plain product", which by now meant twenty `E2E …` strays left
by sibling specs, all at zero stock. `E2E Family Deal` is not sized, so it looked
plain; the offline till sold it from the mirror it pulled at boot (correct), and
the server refused the sync (correct) because the pizza inside had none left.
The suite's result depended on which project ran first. `fillCart` now asks for
the shelf BY NAME. Full record: [docs/decisions/shopos-low-stock-one-rule.md](docs/decisions/shopos-low-stock-one-rule.md).

---

## The QA sweep — driving the product from outside

> **Testing the whole product, in order:** [`docs/qa/FULL-TEST-FLOW.md`](docs/qa/FULL-TEST-FLOW.md)
> — six layers, cheapest first, with what each one is structurally blind to.
> The sweep below is layer 3.

`docs/qa/sweep/` creates a tenant per business type through the admin console,
logs in as its owner, and sells things. Nothing is stubbed. It is the answer to
a question `php artisan test` structurally cannot ask: *does a pharmacy created
this morning have a shelf, a till, and a way to refund a customer* — because
every fixture in the suite was built by the same hands that built the feature.

```bash
cd shopos-backend && php artisan serve --port=8000
cd docs/qa/sweep
python3 run.py        # phases A–Q, in the order each one needs
python3 mutate.py     # break the sweep on purpose; every lie must be caught
```

**Twenty-one phases (A–U), 26 of 26 mutations caught.** (It read "seventeen"
until 2026-08-29 — R, S, T and U were added and the count was not. The
authority is `PHASES` in `run.py`, never this line.) It has found six real
defects, nearly all the same shape — *one question, two paths, two different answers*:

- [The forecourt nobody could start](docs/decisions/shopos-forecourt-branch.md) —
  every station that configured its pumps through the panel was permanently
  unable to open a forecourt shift, past a 25-test suite that never noticed
  because every fixture supplied the field the panel omits.
- [The stock correction that landed at the wrong shop](docs/decisions/shopos-adjust-wrong-branch.md) —
  a hand adjustment always wrote to Main whichever branch you were operating,
  past a test class named for exactly that question whose every test happened to
  be about the sale path instead.

- [A job offered must be a job that can be done](docs/decisions/shopos-job-offered-must-be-doable.md) —
  a restaurant was offered a Purchasing job whose every screen is switched off
  for it, because the preset was gated on `inventory` **or** `products` while
  every route it names rides `inventory` alone.

- [The shop that forgot to close last night](docs/decisions/shopos-which-day-is-open.md) —
  money banked today was recorded against yesterday, because "which day is this
  counter trading?" was asked in three places and answered three ways, and the
  deposit's version had no ordering at all. Two open days is not exotic; it is
  what every shop that shuts late looks like.

### The tests that need a browser

A shop reported seven defects by holding a tablet, and **not one was caught by
3,079 green tests.** Everything under `src/**.test.ts` runs in **jsdom, which
has no layout engine** — `getBoundingClientRect()` returns zeros, no stylesheet
is applied, no media query matches. A close button under a header, a 28px
target, a modal taller than the screen: none of those are wrong in the SOURCE.

```bash
cd shopos-backend && php artisan serve --port=8000
cd shopos-admin-and-user-panel && npm run test:e2e
```

Playwright, real Chromium and real **WebKit** — the engine an iPad runs, and the
one that taught this codebase `100dvh` never `100vh`. Five rules, each
generalised from a defect that actually happened: nothing pressable is covered ·
every tap target ≥32px · no sideways page scroll · what is open fits the screen ·
the page ends above what is pinned to it.

It found [the card that sits on the page](docs/decisions/shopos-screen-testing.md)
on its first real run — the PWA install prompt at `z-[999998]` over the "Finish
setup" button, which is the primary action of the first screen a new shop ever
sees — plus two till controls under the finger floor.

**And it fooled itself four times before that**, in exactly the ways the QA
sweep keeps finding. The worst: it asserted the URL matched `/tenant`, which
`/tenant/setup` also matches, so it tested the shop setup form fourteen times
while reporting it as the dashboard, the catalog, the reports and the till —
and everything passed, because an unchanging page has nothing covered and
nothing off its edge. Only the denominator caught it: 1 tap target where the
till has fifty.

- [Two things a forecourt loses money on quietly](docs/decisions/shopos-fuel-rate-and-receipt-tray.md) —
  a price notification entered at 8pm repriced the pumps at 8pm, so a station
  sold the whole night at a rate that did not start until midnight; and a
  reprinted receipt never left the till's tray, because the query compared a
  second-precision timestamp and a same-second reprint ties rather than exceeds.
  The test for the second one carried `$this->travel(1)->seconds()` — one line
  that was the whole difference between a passing test and a working feature.

Findings and the full argument live in
[`docs/qa/FINDINGS.md`](docs/qa/FINDINGS.md) and
[`docs/decisions/shopos-qa-sweep.md`](docs/decisions/shopos-qa-sweep.md).

Three things to know before you touch it:

- **It reports, it does not pass or fail.** `BUG`, `QUERY` and `HARNESS`, and
  the middle one is why it exists — about half of what surprises the sweep turns
  out to be correct behaviour nobody had written down. Running total so far:
  **55 harness findings, 6 product bugs**, and every one of the fifty-five
  looked like a defect on first read. Verify before believing; the base rate
  says it is the sweep. The worst of them was a permission probe that ran as
  the WRONG IDENTITY: a staff sign-in throttled to `None` fell back to the
  ambient token, got a 401, and the check read that as the 403 it wanted — a
  refusal that proves nothing, printed as a pass.
- **The rate limits are the product working.** `throttle:auth` is 5/min per IP
  and `throttle:api` 240/min per user. The sweep caches tokens between runs and
  waits out a 429 using the server's own `Retry-After`. Loosening either would
  be the wrong fix in a system whose worst failure is a till that cannot take
  money.
- **Some things cannot be run twice.** Closing a trading day is keyed on branch
  + date with no re-open path, so phase P's first version shut the real day on
  all eight shops and every phase from C onward went red for the rest of the
  afternoon. It now trades on a branch nobody else touches and takes the next
  one when today's is spent. And the destructive check must never gate the
  harmless one: banking was ordered after that branch, so when the plan's
  branch ceiling bit — correctly — the check that found the day bug was the one
  that silently stopped running.
- **A phase must not choose its own shops.** Three phases picked trades from a
  hardcoded list sitting beside a `features` check that already knew the answer,
  and the two copies drifted: five trades' loyalty had never been looked at,
  and phase M could not even build a sellable line for a salon — it posted
  `physical_product` at every trade alike, took the 422, gave up, and the run
  printed a clean green summary anyway. `Report.summary()` now prints which
  shops each phase actually spoke about, next to the shops whose modules say it
  should have. **Checks that did not happen do not appear in a list of checks
  that did.**
- **A green run means nothing without `mutate.py`.** It once printed *THE CHECK
  IS BLIND* about two checks that were fine — the phase had died on a 429, so
  they never ran. It now needs a `ran_marker` per mutation and has a third
  verdict, `UNCLEAR`: the check never ran, so fix the run, not the code. A
  detector with no denominator, inside the tool written to find detectors with
  no denominators.

It must stay **re-runnable**. The first version reported eight bugs on its second
run — "a business with this name already exists", the console refusing duplicates
correctly. A sweep that can only run once is a sweep nobody runs.
