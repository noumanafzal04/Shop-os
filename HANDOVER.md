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

`docs/decisions/` (31 files, on `main`) is the accumulated reasoning behind the
build — why the POS works the way it does, what was ruled out and why, what each
sprint shipped. It is not derivable from the code, and it used to exist **only**
in `~/.claude/` on one laptop. Start with `docs/decisions/MEMORY.md`, which
indexes the rest.

To give Claude Code its memory back on a new machine:

```bash
mkdir -p ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory
cp docs/decisions/*.md ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory/
```

The directory name is the project path with `/` replaced by `-`. If your home
directory or checkout path differs, adjust it to match.

### The other docs on `main`

| File | What it is |
|---|---|
| `README.md` | product overview, architecture decisions, branch map |
| `AUDIT-2026-08-06.md` | the 4-way audit: proven P0s, P1/P2 lists, and a record of every fix |
| `BUSINESS-TYPE-WORKFLOWS.md` | how each trade actually operates through the system |
| `POS-WORKFLOW-GAPS.md` | POS gap analysis |
| `IMPLEMENTATION_PLAN.md` · `ROADMAP.md` | phased plan and sequence |

---

## 4. State at handover

**Backend 1356 tests / 5712 assertions green. Panel 122 tests green.** Gates all
clean: `tsc`, `npm run build`, `pint`, `eslint`.

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

Nothing. `wip/relief-cover` shipped on 2026-08-07 and is merged into `backend`.

---

## 6. What's left

**The web side is feature-complete as of 2026-08-07**, excluding offline. Every
known gap is closed: the settings sweep, waiter table scoping, and training
mode were the last three.

**Deployment / CI-CD is now the only thing standing between this and a live
shop.** It is ops rather than product, and it is parked by choice. Staging is a
$6 DigitalOcean droplet, `shopos-dev` at `159.223.78.102` — backend health at
`/api/v1/health`, panel on `:8080`. It reflects none of the last five sessions.

Two things worth knowing when a supermarket signs:

- Multi-lane is done — `registers` are owner-created, one per checkout, each
  with its own printer, drawer and shift. But the `registers` limit **defaults
  to 2** per tenant and an admin has to raise it, or their Lane 3 is refused at
  creation.
- Shift history now renders — `Day & banking → Shifts`, added 2026-08-07. It is
  organised by DRAWER rather than trading day, which is why it is also the only
  place a training shift is visible at all.

Parked deliberately, in order: the offline PWA POS (plan in
`docs/decisions/shopos-offline-plan.md`); the mobile apps, whose contracts have
moved under them (`item_types`, `other_income`, `logo_url` all changed shape) —
plan in `docs/MOBILE-PLAN.md`; the rider backend that the rider app needs; a
payment gateway (there is none anywhere, and COD launches without one).

The smaller loose ends from the 2026-08-06 audit are all cleared (see the
session log).

---

## 7. Session log

Newest first. Appended as work happens, not at the end of a sprint — this
machine may be rebuilt at any time, and anything not written down here and
pushed is gone. See `docs/decisions/shopos-docs-discipline.md`.

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

## 8. Rules that must not be broken

These are settled decisions, not preferences — most of them were paid for with a
bug.

- **Pricing is server-authoritative.** HTTP never supplies `unit_price`, `tax` or
  `line_total`. `trusted_prices` exists for internal paths only.
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
