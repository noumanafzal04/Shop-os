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
| `main` | this overview + all docs | — | `f49b141` |
| `backend` | REST API `/api/v1` | Laravel 12 · PHP 8.4 · MySQL 8 · Redis · Sanctum | `b5b5b8b` |
| `admin-panel` | Web SPA (super-admin + shop panel) | Vite · React 19 · TS · Tailwind v4 · TailAdmin · TanStack Query · zustand | `98dd9e3` |
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

**Backend 1279 tests / 5395 assertions green. Panel 109 tests green.** Gates all
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

---

## 5. In flight

Nothing. `wip/relief-cover` shipped on 2026-08-07 and is merged into `backend`.

---

## 6. What's left

**Deployment / CI-CD is the only hard launch blocker.** Staging is a $6 DigitalOcean
droplet, `shopos-dev` at `159.223.78.102` — backend health at `/api/v1/health`,
panel on `:8080`. It reflects none of the last three sessions of work.

Then, roughly in order: the offline PWA POS (parked for last — the plan is in
`docs/decisions/shopos-offline-plan.md`); finishing the mobile app, whose
contracts have moved under it (`item_types`, `other_income`, `logo_url` all
changed shape); training mode (ranked last — it earns its keep at a six-lane
supermarket, not a three-person shop).

The smaller loose ends from the 2026-08-06 audit are all cleared (see the
session log). Nothing known is outstanding below the two items above.

---

## 7. Session log

Newest first. Appended as work happens, not at the end of a sprint — this
machine may be rebuilt at any time, and anything not written down here and
pushed is gone. See `docs/decisions/shopos-docs-discipline.md`.

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
