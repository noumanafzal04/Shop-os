# Start here

**A new laptop, or picking this up cold.** Read this page top to bottom once. It
takes about ten minutes and it is the only page that assumes you know nothing.

Everything else in this repository is either **reference** (look it up when you
need it) or **history** (why something is the way it is). This page tells you
which is which and in what order to read them.

---

## 1. What ShopOS is, in one paragraph

A multi-tenant SaaS business platform for Pakistani shops. One installation
serves many shops — a grocery, a pharmacy, a restaurant, a workshop, a fuel
station — and each shop sees only the parts of the product it was given. It
covers the till (POS), stock, purchases, customers, staff, money and reports,
plus an optional customer marketplace and a mobile app. **PKR only. No payment
gateway anywhere** — cash, card and bank transfers are *recorded*, not
processed.

The hardest requirement, and the one that shapes the most code: **the till must
keep selling when the internet is down.**

## 2. The three applications

They live as **sibling folders** under one parent, each on its own branch.

```
shopos/                              ← the docs live here, branch `main`
├── shopos-backend/                  ← Laravel API          branch offline/v1/backend
├── shopos-admin-and-user-panel/     ← React panel + POS    branch offline/v1/admin-panel
└── shopos-mobile/                   ← React Native app     branch mobile
```

They must stay siblings: `shopos-backend/scripts/dead-endpoints.py` reads the
other two to check every API route has a caller and every client call has a
route.

| App | What it is | Who uses it |
|---|---|---|
| **backend** | REST API under `/api/v1`, multi-tenant, queues, scheduler | everything |
| **panel** | one SPA, two consoles: the platform's Super Admin, and each shop's own panel + the POS (a PWA that works offline) | you, and every shopkeeper and cashier |
| **mobile** | customer app — browse shops, order, track | shoppers |

---

## 3. Setting up a fresh machine

### 3.1 Install the toolchain

Exact versions, extensions and known-good numbers: **[SYSTEM-REQUIREMENTS.md](SYSTEM-REQUIREMENTS.md)**.
Short version: **PHP 8.4**, **Composer 2**, **Node 20–23**, **MySQL 8+**.

### 3.2 Clone all three, as siblings

```bash
mkdir shopos && cd shopos
git clone -b offline/v1/backend      https://github.com/noumanafzal04/Shop-os.git shopos-backend
git clone -b offline/v1/admin-panel  https://github.com/noumanafzal04/Shop-os.git shopos-admin-and-user-panel
git clone -b mobile                  https://github.com/noumanafzal04/Shop-os.git shopos-mobile
git clone -b main                    https://github.com/noumanafzal04/Shop-os.git shopos-docs
```

Then move the docs to the parent folder, or keep them beside the three — the
scripts only need the three apps to be siblings.

### 3.3 Backend

```bash
cd shopos-backend
composer install
cp .env.example .env
php artisan key:generate
# create an empty MySQL database called `shopos`, set DB_* in .env, then:
php artisan migrate --seed
php artisan storage:link          # product images 404 without this
php artisan serve --port=8000
```

Check it: `curl http://localhost:8000/api/v1/health` → 200.

### 3.4 Panel

```bash
cd ../shopos-admin-and-user-panel
npm install
npm run dev                       # http://localhost:5173
```

### 3.5 Log in

The seeder creates one super admin and ten demo shops.

| Who | Email | Password |
|---|---|---|
| Super admin | `admin@shopos.test` | `password` |
| A shop owner | `tenant1@app.com` … `tenant9@app.com` | `password` |
| Demo Mart owner | `owner@demomart.test` | `password` |

**Two of the demo shops already have offline selling granted** — Demo Mart and
FreshMart Grocery (`tenant2@app.com`). The rest do not, which is the correct
default: a shop earns it (see §5).

### 3.6 Give Claude its memory back

This is what makes the next session continue instead of starting over.

```bash
mkdir -p ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory
cp docs/memory/*.md ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory/
```

The folder name is the checkout path with `/` replaced by `-`. **Copy from
`docs/memory/`, never from `docs/decisions/`** — see
[docs/memory/README.md](docs/memory/README.md) for what went wrong when it was
the other way round.

Keep it current afterwards:

```bash
./scripts/sync-memory.sh          # memory dir → docs/memory/
./scripts/sync-memory.sh --check  # exits 1 if they have drifted
```

---

## 4. Running the gates

Nothing is finished until these pass. Run each from its own app folder.

```bash
# backend
php artisan test                              # 2070 green
./vendor/bin/pint app/Path/To/Changed.php     # specific paths, NEVER repo-wide

# panel
npx tsc --noEmit -p tsconfig.app.json
npx eslint src                                # baseline: 0 errors, 18 warnings
npx vitest run                                # 994 green
npm run build

# mobile
npx tsc --noEmit && npx jest                  # 31 green

# cross-repo — needs all three as siblings
python3 shopos-backend/scripts/dead-endpoints.py
```

---

## 5. How the product actually works — three ideas

Almost every bug in this codebase's history is one of these three being
confused with another. Learn them before reading code.

**MODULE** — `tenants.features`, a map like `{ pos: true, expenses: true }`.
Assigned per shop by the super admin. *"Does this shop have the feature?"*

**TRADE** — `business_type` (mart, pharmacy, restaurant, workshop, fuel…).
*"What kind of business is this?"* A trade **proposes** modules; the admin
**assigns** them. Anything reading the trade where it should read the module map
will lock a shop out of something it was granted.

**PERSON** — permissions. There are **no job roles**: "cashier", "waiter",
"kitchen" are permission *sets*, applied as presets on the staff form.

And one rule that cost a real cashier a working till:

> **A `*.manage` permission answers "may you CHANGE this?", which is the wrong
> question to ask about a READ.** Reads take a set (`Permissions::READS_*`,
> any-of); writes keep a single permission.

### Offline selling

The POS is a PWA that keeps trading through an outage: the catalog, prices and
promotions are mirrored to the device, sales queue in an append-only outbox, and
everything syncs when the line returns.

It is **off for a shop until an admin grants it** (Admin → Tenants → a shop →
Offline selling). A shop earns it by running **shadow mode**: every online sale
is priced twice, silently — once by the server and once by the till's own engine
— and the disagreements show in the shop's Reports → Offline. Grant it once that
comparison is clean *on that shop's own carts*.

**Testing offline needs the built app:**

```bash
npm run build && npm run preview   # http://localhost:4173
```

The service worker does not exist on the dev server (5173), so it can never test
offline. And go offline with **DevTools → Network → Offline**, *not* by turning
wifi off: the API is on `localhost`, which wifi does not interrupt — all that
changes is `navigator.onLine`, which is half the story.

---

## 6. Which document to read, in order

### Read now (about an hour)

| # | File | What you get |
|---|---|---|
| 1 | **this page** | the map |
| 2 | [SYSTEM-REQUIREMENTS.md](SYSTEM-REQUIREMENTS.md) | versions, extensions, setup commands |
| 3 | [HANDOVER.md](HANDOVER.md) §1–6 | current state, what is in flight, what is left, and the rules that must not be broken |
| 4 | [docs/memory/MEMORY.md](docs/memory/MEMORY.md) | one line per decision — **the fastest way to know what is already known** |

### Read when you touch that area

| File | When |
|---|---|
| [MODULE-GUIDE.md](MODULE-GUIDE.md) | how each screen works — POS and its hotkeys, adding a product, category vs collection vs brand, the Ledger |
| [BUSINESS-FLOWS.md](BUSINESS-FLOWS.md) | **who gets which screen**, per trade — the staffing answer, preset → permission → screen |
| [BUSINESS-TYPE-WORKFLOWS.md](BUSINESS-TYPE-WORKFLOWS.md) | how each trade operates through the system; the developer contract |
| [docs/qa/ShopOS-QA-Testing-Guide.md](docs/qa/ShopOS-QA-Testing-Guide.md) | testing a whole shop by hand |
| [docs/MOBILE-PLAN.md](docs/MOBILE-PLAN.md) | the customer app |
| [docs/decisions/offline-pos.md](docs/decisions/offline-pos.md) | the offline programme, phase by phase, with every test id |

### Read when you want to know *why*

[`docs/decisions/`](docs/decisions/) — 73 documents, one per decision or sprint.
Not derivable from the code or the git log. Start from
[docs/memory/MEMORY.md](docs/memory/MEMORY.md) and open the ones whose one-line
hook matches what you are about to touch.

The last section of **HANDOVER.md** is a **session log, newest first**. Reading
the top ten entries is the fastest way to understand what has been happening
recently and why.

### Reference, occasionally

`AUDIT-2026-08-06.md` · `POS-WORKFLOW-GAPS.md` · `IMPLEMENTATION_PLAN.md` ·
`ROADMAP.md` · `docs/audit-2026-08-12/`

---

## 7. Rules that are not negotiable

These are in HANDOVER.md too, and they are here because breaking one costs a
shop money.

- **Pricing is server-authoritative.** HTTP never supplies `unit_price`, `tax`
  or `line_total` — only `product_id` and `quantity`.
- **PKR only.** Never render `$`.
- **Demo seeders and `migrate:fresh` are staging-only.** Never production.
- **Never commit a secret.** Rotate anything that gets exposed.
- **Commit and push only when asked.**
- **`./vendor/bin/pint <specific paths>`** — never repo-wide.
- **A change to a screen is a change to the Help Centre**
  (`src/modules/help/content.ts`). Help that describes last month's screen reads
  as a fault in the software.
- **Update HANDOVER.md and `docs/decisions/` as work happens**, not at the end.
  This machine may be rebuilt at any time.
- **Delete a step from a workflow test and it must fail.** Never assert "not
  empty" on an envelope.
- **PCI DSS:** never store a full card number. Last four digits only.

---

## 8. Two lessons worth reading before you trust a green test suite

Both were paid for in real bugs, and both are the same shape.

**A capability is not shipped until something a person touches can reach it.**
Found by hand eleven times before it became a rule. The largest instance: the
entire offline module — barcode index, search, category index, stock deltas —
built, tested, and wired to no screen. Offline, a till could not put one item in
a cart. `src/common/reachable.test.ts` now fails when an export's only caller is
its own test.

**The test environment agrees with the code, not with the world.** jsdom reports
`navigator.onLine` as `true`, so 900 green tests never noticed that TanStack
Query **pauses every query and mutation while the browser is offline** — the
whole offline capability was unreachable in a real browser and nothing failed.
jsdom is also a secure context, so it defines `crypto.randomUUID`, which is
`undefined` over plain http — and four call sites used it directly, one of them
minting the offline sale's id *before the sale was queued*.

> Anything that depends on browser state — online, secure context, visibility,
> storage pressure — needs a **source rule** or a **real browser**. A green
> vitest run is not evidence.
