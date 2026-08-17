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
| `BUSINESS-TYPE-WORKFLOWS.md` | how each trade actually operates through the system — the developer contract: modules, gating, edge cases, tests |
| **`BUSINESS-FLOWS.md`** | **who gets which screen**, per trade — the staffing answer ("kitchen ki screen kisko deni?"), the preset→permission→screen chain, and the daily loop with the person named at each step |
| **`MODULE-GUIDE.md`** | **how every module works**, screen by screen — POS and its hotkeys, adding a product, category vs collection vs brand, Expense Manager, what the Ledger is, and where each trade differs |
| `POS-WORKFLOW-GAPS.md` | POS gap analysis |
| `IMPLEMENTATION_PLAN.md` · `ROADMAP.md` | phased plan and sequence |

---

## 4. State at handover

**Backend 1898 tests / 8237 assertions green. Panel 813 tests green.** Gates all
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

**The rewritten workflows have not run yet.** The originals did — that is how
both gotchas above were found — but recent pushes carry `[skip ci]` to keep the
old frontend deploy away from the droplet. Dropping `[skip ci]` is what proves
these, and the frontend is the one to watch: the gate is verified locally, the
SSH half has only ever been run by hand.

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

### 2026-08-17 (latest) — the loss that makes no noise

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
