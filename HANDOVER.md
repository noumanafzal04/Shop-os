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
| `wip/relief-cover` | unfinished feature, see §5 | — | `21eeea2` |

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

**Backend 1258 tests / 5288 assertions green. Panel 102 tests green.** Gates all
clean: `tsc`, `npm run build`, `pint`, `eslint`.

Shipped and tested: catalog (variants, packs, combos, modifiers, batches/FEFO);
a single audited stock write-path; POS with server-authoritative pricing,
multi-tender + split, returns/exchange, held tickets, cash rounding, on-screen
numpad, derived quick-keys; shifts, drawers, X/Z-reads, business day + banking;
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

## 5. In flight — `wip/relief-cover`

Half-built and **not merged**. The suite is green with it because everything in
it is additive, but the endpoints are not routed and there is no UI.

Done: migration + `CashSessionCover`, `ReliefCoverAction` (start/end, figures
frozen at hand-back), `OwnOpenShift` accepting an active cover, controller
methods, close-ends-a-running-cover.

Left: routes for `POST /pos/session/cover` and `/cover/end`; restrict a
reliever's cash movements to `no_sale`; cover breakdown on the X-read and
Z-read; end the cover when the cashier unlocks the till again; tests; panel UI.

The rule the design protects: **a cover moves the queue, not the drawer.** The
reliever sells under their own name; the cashier who opened the shift still
counts the box and still wears the variance. Cover grants the right to sell,
never the right to reconcile.

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

Smaller loose ends: three dead endpoints (`GET /restaurant/reports/waiters`,
`POST /restaurant/tables/reorder`, `GET`/`DELETE /auth/sessions`);
`layaway_cancellation_fee_percent` is orphaned — not in the settings form, unread
by the backend, and it doesn't pre-fill the cancel dialog; `auto_workshop` exists
as a category under both `services` and `automotive`; `ShopSetupPage` calls a
Finance Manager tenant a "shop" four times, and city is required there.

---

## 7. Rules that must not be broken

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
