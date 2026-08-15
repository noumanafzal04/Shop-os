# Offline POS — the build plan

**Written:** 2026-08-14. Supersedes the 2026-07-21 sketch, which predates
loyalty, promotions, serials, tax groups, dine-in, branches, registers, till
PINs, training mode and business days — every one of which changes the surface.

**Status (2026-08-15):** Phases 0, 1, 2, 3 and 4 are **built and green**. Phase
5 is built bar the soak run, which is a run and not a build. Branches:
`offline/v1/backend`, `offline/v1/admin-panel`. **63 of 64 test IDs** — the one
outstanding is P5-4, the 72-hour soak.

Phase 2's remaining gate is **not a build task**: shadow mode must run over real
trading until the check count is large and the variance count is still nil.
Until that has happened, offline selling must not be turned on for a real shop.

**One item in the plan turned out not to be safely buildable as written.** P3-16
asks for the owner's PIN once the offline window has passed. Verifying a PIN
with no server means shipping its hash to the device, and a ShopOS till PIN is
four digits — ten thousand guesses on a stolen tablet, after which that PIN
opens every till in the shop for ever. The gate would create more risk than it
removes. What is built instead: selling continues (closing a shop is almost
always the more expensive failure), every sale past the window is stamped
`beyond_offline_window`, and they are listed for the owner. The real protection
is the one that already exists and needs no secret on the device — Settings →
Your tills → Sign out.

---

## 0. The one rule

> **Offline may do only what a single till can decide correctly, alone.**

Wherever two tills could reach different answers about the same thing — a khata
balance, a loyalty point, one specific IMEI, a coupon that may be used once, a
dining table — that thing stays online. Every scoping question below is settled
by applying this sentence and nothing else.

The second rule follows from it, and it is the one that keeps a shop trading:

> **A sale that has happened is never lost, never rejected, and never rewritten.
> If it arrives late, it arrives late.**

The server's job on sync is not to approve the sale. The money already crossed
the counter. Its job is to **record what happened and report what differs**.

---

## 1. What already exists — do not rebuild it

An audit of the current code found most of the hard parts already shipped for
other reasons. Building them again would be the expensive kind of mistake.

| Need | Already there |
|---|---|
| Replay safety | `sales.idempotency_key`, `unique(tenant_id, idempotency_key)`, plus a catch-`23000`-and-return-the-existing-sale path in `CreateSaleAction:962` |
| Terminal identity | `registers` table, branch-scoped; `X-Register-Id` validated server-side by `ResolveRegister` — never trusted raw |
| Branch identity | `branches` + `BranchContext` on every money and stock path |
| Cashier identity | till PINs (`users.pin_hash`) + `TillIdentityController`, with session handover |
| Shift | `cash_sessions`, denomination counts, blind close, X/Z |
| Trading day | `business_days`, frozen at close |
| Per-tenant admin limits | `PlanLimits::REGISTRY` + `tenants.limits` + the Extend Limits admin screen |
| Tenant-read-only config | `tenants.settings` is written through `$request->validated()`, an allow-list — a key absent from `ShopSettings::rules()` cannot be written by the shop |
| Cost-price protection | `HidesCostPrice` on `Product` and `ProductVariant` |

**Genuinely new:** a device identity, the local store, the pricing mirror, the
two sync endpoints, and the offline policy.

### Why `device_id` is not `register_id`

A register is a **place** (Lane 1). A device is a **thing** (that tablet). Two
tablets can serve one lane; a tablet can be moved between lanes. The outbox
lives on the **device**, so trust, expiry and "whose unsent sales are these"
are all per-device. Both IDs go on every offline operation.

---

## 2. The offline policy — how many days, and who decides

### Where it lives — with branches and staff, NOT on a plan

`PlanLimits::REGISTRY` is badly named: it holds two different kinds of limit,
and the `owner` key is the whole distinction.

- `owner => 'plan'` — billed usage (products, orders/month, storage). The plan
  sets the baseline.
- `owner => 'tenant'` — **the size of the organisation, assigned to each shop
  by the admin.** Branches, staff, registers. These used to be plan columns,
  which meant a two-branch shop needed its own plan; now the admin simply gives
  it two.

`offline_days` belongs in the **second** group, beside branches and staff — it
is not something anybody buys, it is something the admin decides about this
particular shop:

```php
// ── Assigned to the shop itself ─────────────────────────────────
'branches'     => ['owner' => 'tenant', 'default' => 1, 'label' => 'branches',     'enforced' => true],
'staff'        => ['owner' => 'tenant', 'default' => 5, 'label' => 'staff members','enforced' => true],
'registers'    => ['owner' => 'tenant', 'default' => 2, 'label' => 'registers',    'enforced' => true],
'offline_days' => ['owner' => 'tenant', 'default' => 3, 'label' => 'days offline', 'enforced' => true],  // ← new
```

That single line buys the whole feature:

- stored in `tenants.limits` — **no migration**
- set per tenant by the admin through the **existing** Extend Limits endpoint
  and screen — **no new admin UI, no new endpoint**
- the shop **cannot** change it: it is not in `ShopSettings::rules()`, and the
  settings update merges only `validated()` keys
- shows up in the admin's limits screen beside products, branches and staff,
  which is where an admin already looks

A second key, admin-only and off by default:

```php
'offline_hard_stop_days' => ['owner' => 'tenant', 'default' => null, ...]  // null = never brick the till
```

### The three states, and why the default never bricks a till

Let `d` = days since this device last reached the server.

| State | When | The till does |
|---|---|---|
| 🟢 **Green** | `d < 0.75 × offline_days` | Nothing. Sells normally. |
| 🟡 **Amber** | `0.75 × offline_days ≤ d < offline_days` | A persistent banner: "Connect this till — N hours left." Every receipt keeps printing. |
| 🔴 **Red** | `d ≥ offline_days` | Selling continues, but **the owner's PIN is required once per day** to carry on, and every sale past this point is stamped `beyond_offline_window`. |
| ⛔ **Stopped** | `offline_hard_stop_days` set and passed | New sales refused. The cart in progress may still be completed. |

**The default is `offline_hard_stop_days = null` — the till is never bricked.**

That is deliberate, and it is the answer to "delay ho jaye, data loss na ho": a
village shop with a five-day outage keeps trading. What it loses is silence —
the owner has to consciously acknowledge it, and the variance report names every
sale rung past the window. An admin may set a hard stop for a tenant where the
risk is worse than the outage (a pharmacy, a high-value retailer).

### The line that matters most

> **`offline_days` limits SELLING. It never limits SYNCING.**
>
> The outbox has no expiry. A sale rung 40 days ago on a tablet that has been in
> a drawer syncs the moment that tablet sees the internet, and is accepted.

Getting this backwards — expiring the outbox along with the selling window — is
how offline systems lose money. The two clocks are unrelated.

---

## 3. What may and may not happen offline

### The axis is `item_type`, not `business_type`

A trade-by-trade matrix is the obvious design and it is wrong here. It would
put a whole pharmacy offline-forbidden — but a pharmacy sells shampoo, nappies
and baby food, and there is no reason those cannot be rung up offline. And
where a trade matrix agrees with the truth it is redundant, because
`BusinessTypes::itemTypesFor` already forbids a mart from ever holding a
medicine.

ShopOS models capability by item type and capability flags. The allow-list uses
the same axis it already has:

| Condition | Offline | Why |
|---|---|---|
| `item_type = medicine` | ❌ | Live batch quantities, FEFO order, expiry fence. Selling expired stock offline is a regulatory event, not a bug. |
| `tracks_serial = true` | ❌ | One specific IMEI. Two tills would sell the same handset. |
| `item_type = food` **and** the sale is a dine-in ticket | ❌ | A table is shared state by definition. |
| `item_type = food` on a counter/takeaway sale | ✅ | Channel `pos` / `walk_in`. Nothing shared. |
| `item_type = deal` (combo) | ✅ | Components resolve locally; stock deltas are local subtractions. |
| everything else | ✅ | |

### Tenders — from the actual `PaymentMethod` enum

| Tender | Offline | Why |
|---|---|---|
| `cash` | ✅ | |
| `card` | ✅ | **ShopOS holds no payment gateway.** Card is a *recorded tender*: the cashier swipes on the bank's own terminal and records the amount. Recording it offline is exactly as truthful as recording it online. |
| `bank_transfer`, `other` | ✅ | Same — a record, not an authorization. |
| `credit` (khata) | ❌ | Needs the live balance. Two tills would both extend past the ceiling. |
| `deposit` (layaway) | ❌ | Needs the document it is drawing down. |
| `trade_in` | ❌ | **The server derives the allowance from the trade-in lines.** A client that could name its own trade-in amount could settle any bill without anything crossing the counter. |
| `split` | ✅ | If every component tender is allowed. |

### Operations

| Operation | Offline |
|---|---|
| Ring a sale, print a receipt | ✅ |
| Barcode / scale barcode / PLU | ✅ |
| Variants, packs, modifiers, weight items | ✅ |
| Discount within the shop's ceiling | ✅ |
| Attach a customer for attribution | ✅ (from cache) |
| Open / close a shift, count the drawer | ✅ (Z is provisional) |
| Hold and recall a sale | ✅ (local only) |
| Return / refund | ❌ needs the original sale |
| Loyalty earn | ✅ (server awards on sync) · redeem ❌ |
| Coupon: unlimited-use rules | ✅ · single-use ❌ |
| Cashier handover | ❌ PIN is verified server-side |
| Dine-in, kitchen, forecourt, purchases, stocktake, transfers | ❌ |

Every refusal must say **why**, in the cashier's words: *"Medicines need the
internet — batch and expiry are checked live."* A silent grey button is a
support call.

---

## 4. The local store

IndexedDB. Not SQLite-WASM: the dataset is small, the payload would cost ~1 MB
of wasm, OPFS support is uneven, and a native SQL engine buys nothing that an
in-memory index does not already give at this size.

### Nine object stores

| Store | Holds | Sync |
|---|---|---|
| `catalog` | the POS projection — one row per item | pull, cursor |
| `barcodeIndex` | barcode → item (primary, extra, pack) | derived at boot |
| `taxConfig` | tax groups, inclusive flag, rounding | pull |
| `promotions` | only offline-safe rules | pull |
| `customers` | `id, name, phone, customer_group_id` — **nothing else** | pull |
| `outbox` | offline sales, append-only | **push** |
| `shift` | local shift + drawer movements | push |
| `device` | device token, register, branch, policy | server-issued |
| `syncMeta` | cursor, clock skew, schema version | local |

### The catalog projection — what is deliberately absent

**`cost` is never sent to a device.** `HidesCostPrice` exists precisely so a
cashier cannot read the buying price; caching it would hand the whole margin
sheet to anyone who opens DevTools, and the entire pricing book to anyone who
steals the tablet. DevTools is not a security boundary. Only selling prices
travel: `price`, `discount_price`, `wholesale_price`, `price_tiers`.

Also absent: descriptions (search uses name + SKU + barcode + category), other
branches' stock, customer balances, ledgers, notes, purchase history.

### Stock is a number, not a table

There is **no local `stock_movements`**. Local stock is one integer on the
catalog row — a display estimate, never authoritative.

```
product.q = 42   →  sale of 1  →  q = 41
```

Movements are derived **server-side from the synced sales**. Keeping a local
movement log would create a second truth that has to be reconciled with the
first, which is a whole bug class bought for nothing.

> Offline stock is only ever **decremented**, never `set`. Deltas commute, so
> replay in any order lands on the same number.

### Images

The code has already decided this. `PosPage.tsx:232`:

```
posLayout = isRestaurant ? "grid" : "list"
  grid (food)                → renders <img>     (PosPage.tsx:1528)
  list (mart/pharmacy/retail) → no image at all   (PosPage.tsx:1554)
```

The trades that carry 20,000 SKUs use the list. The trade that renders images
has a menu of 100–400 items. So:

- **list mode → cache no images at all.** Zero bytes.
- **grid mode → cache thumbnails only**, capped (500 images / 20 MB, LRU).

**Built 2026-08-14.** `Thumbnail::make()` on upload, plain GD rather than an
image library (GD ships with the PHP the droplet runs; a library would be a
dependency, a version to track and a supply-chain surface, in exchange for
resizing one square). 200×200 WebP, **centre-cropped** rather than letterboxed —
a POS grid is squares, and padding every tile to fit a wide photo wastes a third
of a screen read at arm's length.

Failure is never fatal: a corrupt upload, a format GD cannot read, or a PHP
built without WebP each leave `thumb_path` null, and `thumb_url` falls back to
the original. The grid then behaves exactly as it did before. `images:thumbnails`
backfills what predates the change — resumable and safe to re-run, because a
shop's images can be thousands of files.

The projection carries the SMALL square only. Sending the full-size URL would
invite a client to cache 2–4 MB per item, and there is no shop where that ends
well.

### Measured sizes

Modelled on a realistic Pakistani mart projection (15% variants, 10% packs, 8%
extra barcodes), no cost, no descriptions, no images:

| Items | IndexedDB | First download | RAM index |
|---:|---:|---:|---:|
| 20,000 | 6.3 MB | 0.5 MB (br) | 3.9 MB |
| 50,000 | 15.8 MB | 1.2 MB (br) | 9.8 MB |
| 100,000 | 26.5 MB | 2.3 MB (gz) | 18.4 MB |

Outbox, per sale: 0.6 KB at one line, 1.1 KB at five, 3.4 KB at twenty-five.

| Offline sales | On device | Upload |
|---:|---:|---:|
| 500 | 0.6 MB | 40 KB |
| 1,500 | 1.8 MB | 100 KB |
| 5,000 | 6.0 MB | 300 KB |

**A busy mart at 400 sales/day, offline for three days, holds 1.4 MB.** The
whole footprint for a 50,000-SKU shop after three days offline is ~18 MB —
well under 1% of a typical browser quota.

**Disk is not the constraint and never becomes one.** The constraints are RAM
on a cheap tablet (fine to ~100k), boot time (~300–600 ms to read and index
50k), and scope discipline.

---

## 5. Server additions

### `GET /pos/bootstrap`

One call. Returns catalog projection, tax config, offline-safe promotions,
minimal customers, the shop's settings, the device's policy, the server clock,
and a cursor.

### `GET /pos/sync?cursor=…`

Delta pull. Rows changed since the cursor.

> **Tombstones are mandatory.** `products` uses `softDeletes()`, so a plain
> `updated_at > cursor` never carries a deletion and a deleted item stays
> sellable on the device forever. The response must carry explicit
> `{id, deleted: true}` rows.

### `POST /pos/sync`

Batch ingest. **Per-operation results, never a batch result** — 30 of 50
accepted must not fail the other 20.

```
SYNCED
SYNCED_WITH_VARIANCE      price / stock / late-day differences attached
DUPLICATE_ALREADY_APPLIED already ingested; returns the original sale
REQUIRES_REVIEW           accepted, but a human must look
REJECTED                  only ever for a malformed or forbidden operation
```

`REJECTED` must be reachable **only** for things that could not have happened at
a real counter — a forbidden tender, an unknown product, a device outside its
tenant. It is never reachable for "the price changed" or "stock went negative",
because the money already moved.

### `POST /pos/device` — registration

Issues a device id + device-bound token carrying tenant, branch, register and
policy. Revocable from the existing Signed-in devices panel.

### Auth

**The till PIN is not the offline credential.** A four-digit PIN's hash on a
device is ten thousand guesses — seconds. The device token is the credential;
the PIN gates the UI and says who is selling. Do not cache `pin_hash`.

---

## 5a. Prerequisite: HTTPS on a final domain

**A service worker only registers in a secure context.** That is a browser rule
with no setting and no bypass. The staging droplet answers on
`http://159.223.78.102:8080`, where a service worker will not register at all —
no app-shell cache, no install prompt, **no offline POS of any kind**.

`localhost` and `127.0.0.1` *are* secure contexts, so Phases 0–2 can be built and
tested entirely on a dev machine with no domain at all. The wall arrives at the
first real-tablet test — a LAN IP like `http://192.168.1.50` is not a secure
context either. `cloudflared tunnel --url http://localhost:5173` gives a free
HTTPS URL for that gap; it is fine for testing and not for production.

### Serve both halves from one origin

Not `api.shop.example.com` alongside `shop.example.com`. One origin removes CORS
entirely, keeps the whole app inside one service-worker scope, and avoids
SameSite handling:

```
https://shop.example.com/          → the panel (dist/)
https://shop.example.com/api/v1/   → Laravel
```

The `/api/` location must come **before** the SPA fallback, or `try_files …
/index.html` answers API calls with the app. `/sw.js` must be served
`Cache-Control: no-cache`, or the app can never update itself. And the panel's
`VITE_API_BASE_URL` becomes the relative `/api/v1`, not an absolute URL.

### Pick the production domain before any device is deployed

> Service-worker caches and IndexedDB are bound to the **origin**. Change the
> domain later and every tablet in every shop loses its cache and its outbox
> and must bootstrap again.

So the domain is cheap to buy and expensive to change once tablets are out.
Decide it before Phase 3 reaches a real shop.

---

## 6. The steps

Each phase ships on its own and is useful on its own. Nothing after Phase 0
starts until the phase before it is green in CI.

### Phase 0 — foundations, zero behaviour change

**Build:** PWA shell (`vite-plugin-pwa`, manifest, install prompt) · IndexedDB
schema + versioning · device registration + token · real
`navigator.onLine` + heartbeat (the current pill is hardcoded) · a sync-status
indicator that only ever says "online" · `offline_days` and
`offline_hard_stop_days` in `PlanLimits::REGISTRY` · cart persisted to
IndexedDB.

**Done when:** the POS installs to a home screen, survives a refresh mid-cart,
registers a device, and behaves identically in every other respect.

**Tests**

| ID | Test |
|---|---|
| P0-1 | Refresh mid-cart → the cart is exactly as it was |
| P0-2 | Kill the network → the pill turns offline within 5 s; restore → online |
| P0-3 | Register a device twice → one device row, same id |
| P0-4 | A revoked device token is refused |
| P0-5 | Admin sets `offline_days = 7` on one tenant → only that tenant reads 7 |
| P0-6 | A tenant tries to `PUT /shop/settings` with `offline_days` → ignored, value unchanged |
| P0-7 | `navigator.storage.persist()` refused → the shift-open screen warns before opening |

### Phase 1 — read-only offline ✅ DONE 2026-08-14

**Built:** `GET /pos/bootstrap` + `GET /pos/catalog?<projection>=<cursor>` ·
**six** projections, not one · applier with cursor discipline · derived barcode
index · local search · thumbnail pipeline. **Sales still go to the server.**

Two things turned out bigger than the plan said. The delta had to carry
categories, promotions, tax groups, customer groups and customers as well as
products — a till that only learns about products goes quietly wrong, and the
change WAS saved, it just never travelled. And each needs its OWN cursor, or a
category rename waits behind a 20,000-item catalog's twenty pages.

**Done when:** with the network cut, the catalog browses and scans instantly,
and Complete Sale is disabled with a clear reason.

**Tests**

| ID | Test |
|---|---|
| P1-1 | 20k catalog: barcode → item in **< 5 ms** |
| P1-2 | Extra barcode and pack barcode both resolve to the right item and unit |
| P1-3 | Scale barcode parses to the same weight/price the backend gives (port parity) |
| P1-4 | Product deleted server-side → after delta, gone from the device |
| P1-5 | Product renamed → after delta, renamed; cursor advanced |
| P1-6 | Second boot downloads only the delta, not the catalog |
| P1-7 | `cost` appears nowhere in IndexedDB — asserted by scanning every stored row |
| P1-8 | Offline, Complete Sale is disabled and names the reason |
| P1-9 | Grid trade: thumbnails cached, cap respected, LRU evicts oldest |

### Phase 2 — pricing parity, in shadow

**Build:** the TypeScript pricing engine — a mirror of `priceForQty`,
`priceForLevel`, `effectiveTaxRate`, tax groups, inclusive tax,
`PromotionService`, offline-safe coupon rules, `ModifierResolver`,
`CashRounding` (≈870 lines of PHP). **All money in integer paisa, never float.**

An artisan command generates golden fixtures — cart in, expected totals out — as
JSON. Vitest consumes them. Hand-written fixtures are forbidden: the two engines
would drift, quietly, in the direction nobody checks.

**Shadow mode:** the POS stays online and still uses the server price, but also
computes the local one and logs the difference. Two weeks of that produces real
fixtures from real carts.

**The denominator, and why it is half the feature.** P2-13 below reads "over
1,000 live carts", and the first build of shadow mode could not have told you
whether it had seen one. It counted findings only — and an empty findings list
is produced identically by two very different shops:

| what happened | what the screen showed |
|---|---|
| the engine agreed on 1,284 real carts | no disagreements |
| no till ever finished its catalog pull, so every check silently skipped | no disagreements |

Only the first makes shipping safe, and the second is the quieter of the two:
nothing to see is exactly what it looks like. So each till now counts what it
DID — checked, matched, skipped, differed — and reports it on the boot that was
happening anyway. `skipped` is counted separately and by reason, because a
fortnight where nine carts in ten were skipped for "an item is not in the local
catalog yet" is a finding about the PROJECTION, and it would otherwise read as a
clean sheet.

Three rules follow from that number's only job being to authorise a risky
change, so it must fail by under-claiming:

- **Totals are stored as sent, never accumulated.** A re-sent boot is then a
  no-op. A till whose storage is wiped drops back to zero and takes the shop's
  total with it — which is correct, because the evidence really did go with it.
- **The window is the NEWEST reset across the fleet**, not the oldest. A till
  wiped yesterday sits beside another's three weeks; printing "three weeks" over
  that is the over-claim the whole number exists to prevent.
- **Revoked tills don't vote.** Their checks happened, but the question is
  whether the WORKING fleet has been exercised.

**Also fixed here (a Phase 1 bug):** registration ran once per app start, so
`last_seen_at` — the clock the entire offline policy reads — was measuring time
since the browser was last reloaded. A counter tablet open all week, syncing
every fifteen minutes, sat on the owner's roster reading "last reached us 7 days
ago". The catalog pull now touches the device at most every five minutes.

**Done when:** every fixture matches exactly, CI fails on any mismatch, and
shadow-mode disagreement over a week of live use is zero **against a count of
checks that proves the week happened**.

**Tests**

| ID | Test |
|---|---|
| P2-1 | Every golden fixture: PHP total **===** TS total, to the paisa |
| P2-2 | Quantity tiers at and either side of each break |
| P2-3 | Inclusive tax — the extraction and its rounding mode |
| P2-4 | Tax group beats product rate beats shop default |
| P2-5 | Wholesale level + tier + customer group together |
| P2-6 | BOGO and percentage promotions, singly and combined |
| P2-7 | Modifiers with positive and negative deltas |
| P2-8 | Cash rounding at 1 / 5 / 10 |
| P2-9 | Weight item, 3 decimal places |
| P2-10 | Combo/deal line pricing |
| P2-11 | **Float trap:** a cart whose naive float sum ends `.30000000000000004` |
| P2-12 | Discount ceiling enforced locally the same way the server does |
| P2-13 | Shadow mode over 1,000 live carts: zero disagreements |
| P2-14 | A skip is counted as a CHECK, never as a match |
| P2-15 | A shop that checked nothing is told so, and never shown a clean sheet |
| P2-16 | A re-sent boot does not inflate the tally; a wiped till may count down |
| P2-17 | The reported window is the newest reset, not the luckiest till's |
| P2-18 | A revoked till's checks do not vouch for the working fleet |
| P2-19 | A till open a week does not read as a week out of contact |

> **Gate: no offline sale ships until P2-1 through P2-19 are green in CI.**
>
> P2-14 and P2-15 are the gate on the gate: without them "zero disagreements"
> is not a result, it is a silence.

### Phase 3 — offline selling

**Build:** the outbox · the allow-list (item type, tender, operation) ·
provisional receipt numbering · `POST /pos/sync` with per-operation results ·
the flusher with a Web Locks leader · retry with backoff · local stock deltas.

**Provisional numbering:** `OFF-{register}-{device}-{seq}`. Offline never mints
a number in the server's sequence. On sync the server assigns the real invoice
number and **both are stored**, so a customer's printed slip can always be found.

**Done when:** a till sells for three days with no network and every sale lands
exactly once, correctly, on reconnect.

**Built (2026-08-16).** `POST /pos/sync` · the outbox and its status machine ·
the Web Locks flusher · `OFF-{lane}-{device}-{seq}` · the allow-list on both
sides · local stock · the POS wiring. Four decisions worth keeping:

- **A refusal is never a correction.** A sale that broke the offline rules is
  recorded exactly as it happened and FLAGGED (`sales.offline_violations`).
  Rewriting a credit sale into a cash one would leave a shop believing it had
  been paid, which is worse than any refusal.
- **`SENDING` is not a state a row may rest in.** Every one goes back to
  PENDING on boot. The tab was closed mid-request and nobody knows whether the
  server got it; sending twice costs a lookup, not sending costs the sale.
- **Local stock is DERIVED from the outbox, never stored beside it.** Two
  records of one fact drift, and the day they disagree the cashier reads the
  wrong one silently. Summing the queue cannot drift, because it *is* the queue.
- **Two separate trusts.** `trusted_offline` lets the sync path set `sold_at`
  and the device; `trusted_prices` stays off, so the server re-prices every
  cart. Folding them would grant price authority to the one caller that must
  not have it.

**Extended 2026-08-17 — P3-15, and a hole it uncovered.**

Training was going to be free: `is_training` is inherited from the shift, the
offline payload already carries `cash_session_id`, so a practice sale rung
offline should just stay practice. Writing the test found the other half.

Online, a training sale is **loud** — a banner across the POS, TRAINING on the
slip, a `TRN-` number. A synced sale has none of that, and `SyncRequest`
deliberately dropped the `OwnOpenShift` rule so a Tuesday sale could still land
on Friday. Between those two facts: naming a practice shift on a synced
operation would turn a real sale into one that takes no stock, earns no
revenue and appears in no report — **silently**. That is a way to walk goods out
of a shop, and it exists only on the offline path.

So practice now needs **two** opinions: the drawer *and* the till that was
standing at it (`operations.*.training`). The till's word can only ever
withhold training, never grant it — the "a client-supplied practice flag is a
switch for making stock disappear" rule still holds. Silence counts as real: a
practice sale recorded as real is visible and voidable; a real sale recorded as
practice is invisible, which is the whole point of the attack. A disagreement
is flagged either way, because a silent correction teaches nobody.

The same flag keeps the till's own shelf honest — `unsyncedDeltas()` skips
practice rows, so a trainee's afternoon no longer walks the local stock figure
down through goods that never moved.

**Still open in Phase 3:** P3-10 (offline returns refused — the returns path is
untouched), P3-16/17 (the `offline_days` PIN gate and the hard stop; P3-16 was
found unbuildable safely — see Phase 5).

**Tests**

| ID | Test |
|---|---|
| P3-1 | Offline sale → receipt prints with a provisional number |
| P3-2 | Reconnect → sale syncs, real number assigned, both stored |
| P3-3 | The same operation sent three times → one sale |
| P3-4 | Ack lost mid-flight, client retries → `DUPLICATE_ALREADY_APPLIED`, one sale |
| P3-5 | 50 queued, 30 accepted, 20 fail → only the 20 retry |
| P3-6 | Medicine offline → refused, with the reason |
| P3-7 | Serialised item offline → refused |
| P3-8 | `credit` / `deposit` / `trade_in` offline → refused |
| P3-9 | Dine-in offline → refused; takeaway on the same tenant → allowed |
| P3-10 | Return offline → refused |
| P3-11 | Loyalty redeem offline → refused; earn accrues on sync |
| P3-12 | Two tabs flushing → exactly one sends |
| P3-13 | 1,500 queued sales flush over a slow link without duplication |
| P3-14 | Local stock decrements; never `set` |
| P3-15 | Training-mode sale offline stays training on sync — and a real sale cannot be MADE training by naming a practice shift ✅ |
| P3-16 | Device offline past `offline_days` → owner PIN demanded, sale stamped |
| P3-17 | `offline_hard_stop_days` passed → new sale refused, cart in hand completes ✅ |
| P3-18 | Outbox from 40 days ago still syncs and is accepted; lateness is measured from the till's last contact, not from today ✅ |

### The shadow check earned its keep — 2026-08-15

Phase 2's whole argument was that a mirror cannot be trusted until it has been
measured against real carts. On the first day a real shop ran it, it produced
nine disagreements, all the same shape:

```
discount: server Rs 106.00, till Rs 0.00
total:    server Rs 954.00, till Rs 1,060.00
```

Exactly ten per cent, on every cart. The shop had an active **"Weekend 10% Off"**
promotion; the server applied it and the offline engine did not, because
`priceCart` had said so in a comment since the day it was written — *"promotions
are absent for now"*. Nobody was mis-billed, because the customer pays the
server's price. A till allowed to sell offline would have printed a receipt ten
per cent high on every sale of that day.

**Promotions are now mirrored** (`bestPromotion.ts`), and they were the
exception all along: an automatic promotion is a rule the shop wrote down in
advance, the same for every till, with nothing to reserve and nothing to race
over. A single till CAN decide it alone, which is the only test the offline rule
applies. Coupons, loyalty and group discounts stay out for the reason they
always did — each is shared state.

Four decisions inside it:

- **The clock is the SHOP's.** A promotion that runs on Fridays, or between 6pm
  and 9pm, is a statement about local time. The till judges it against server
  time with its own measured drift applied, in the shop's timezone — never
  `new Date()`, which would run a flash sale that ended on Tuesday.
- **A promotion the engine cannot evaluate stops the SHOP selling offline**, not
  the cart. No cart can be rearranged to fix it, so telling a cashier to remove
  an item would send them doing something that changes nothing.
- **Switching a promotion off travels as a tombstone**, not as a flag — the till
  drops the row entirely. The delta only carries what changed, so a promotion
  that merely stopped appearing would sit on every tablet for ever.
- **The fixtures are the proof.** Fourteen new carts rung through the real
  endpoint, including the clamp case, BOGO-cheapest-free and a weighed line that
  cannot complete a group. Two bugs surfaced writing them: promotions leaked
  between fixture cases (every cart after the fourth was priced against
  promotions it never asked for), and the first version embedded database UUIDs,
  which would have made the gate go red on every run instead of when pricing
  changed.

The disagreement list is also grouped by shape now. Nine rows saying one thing
were one finding; a shop trading all day would have produced nine hundred, and
the pattern would have been invisible under its own evidence.

### Phase 4 — reconciliation and the owner's view

**Build:** the variance report (price, stock, late-arrival) · oversell review
queue · sync error surface · device list with last-seen and offline state ·
audit entries for every offline sale · `beyond_offline_window` reporting.

**Done when:** an owner can answer "what happened while we were offline?" from
one screen, without asking anyone.

**Built (2026-08-16).** `GET /reports/offline` + Reports → Offline. Two
decisions:

- **Oversell is a SHELF query, not a sales query.** Two tills offline can each
  sell the last carton and both are telling the truth — no sale is wrong, so no
  sale can be found by looking for the mistake. The shelf is what is wrong, and
  a negative `branch_stock` quantity says so plainly. The screen calls it "count
  these again", not an error: naming it a mistake sends an owner looking for
  somebody to blame instead of for a clipboard.
- **"Nothing happened" is a real answer and is written as one.** Most mornings
  this screen is empty, and an empty table would read as a report that failed to
  load. It says the tills were in touch the whole time. A load FAILURE says
  something different, and a test pins that the two can never be confused.

**Extended 2026-08-17 — P4-3, the day that was already signed off.**

The spec line below said such a sale should "post to the open day". It does
not, and should not: `sold_at` decides the trading day, so Tuesday's sale lands
on Tuesday. Posting it to Wednesday would move money between two days' figures
and make both wrong. The code is right and the spec row has been corrected.

What was missing was the consequence. Tuesday's drawers were counted, the day
was closed, the cash was banked — and a business day's totals are summed once
from the shifts' frozen close figures and never recomputed, because "a day
signed off in March has to read the same in September". So Tuesday's *recorded*
takings are now short of Tuesday's *sales*, and nothing said so.

`sales.after_day_close` is stamped at sync and the report names the **amount in
rupees**, not the count — an adjustment is written from a figure. Three
decisions inside it:

- **Stamped on arrival, never derived at report time.** "Was the day closed
  when this landed" is a fact about a moment. Derived later, a sale that arrived
  while the day was still open would start being flagged the evening somebody
  closed that day — and that sale was in the totals.
- **Not a violation.** `offline_violations` is for things the till was not
  allowed to do. This is nobody's fault and needs a different action, so mixing
  them would bury one in the other.
- **The shop's calendar and the shop's branch.** The trading date is read in the
  tenant's timezone (the same calendar `trading_date` is written from), and
  matched per branch — Gulberg signing off says nothing about Saddar, still
  trading. Both were mutations that survived the first version of the tests.

### The three fields a synced sale could not be trusted about — 2026-08-15

Phase 4 closed on three questions that all have the same shape: *the sync
request carries something, and until now the server simply believed it.*

**WHEN (P4-4).** `sold_at` decides the trading day, the shift, whose figures the
sale lands in, and whether that day had already been counted and banked — and it
arrived from a tablet. A cheap Android that has been flat for a week comes back
believing it is the day it shipped, and a whole outage would file into days that
were closed before the cut began. Two layers now:

- **The till corrects itself.** `clock.ts` is the one place that turns the drift
  measured on every catalog pull back into a moment. The sale's stamp, the
  promotion windows, the pricing clock and — critically — the till's own record
  of its last contact all move by the same offset. Correcting the sale and not
  the floor would hand the server two numbers that no longer describe one day.
- **The server bounds what it cannot know.** It cannot know when the sale
  happened; it knows two moments it cannot have happened outside of. Not in the
  future (`now()`). Not before the till last reached us (`offline_since` — a
  sale rung while still in contact would have gone online). The claim is moved
  the smallest distance that makes it possible, so P3-18's forty-day outbox is
  left exactly where it says it happened.

The tablet's wrong reading is **kept** (`client_sold_at`, `clock_skew_seconds`)
and rolled up per device on the offline report. A correction nobody can see is a
tablet that goes on being three days out every morning for ever.

**WHO (P4-6).** `created_by` defaults to the authenticated user. Online that is
the cashier; here it is whoever reconnected — the evening shift, a manager, an
owner opening up after a week. One person's entire outage was landing in
another's staff report. The till now names who was standing at it, checked to be
a live user of this shop. Deliberately the till's word and not the shift's: under
relief cover the reliever rings and the drawer stays the cashier's, so the shift
names the person who was on their break.

**WHERE (P5-5).** A tablet is a thing that can be carried. Registered at Gulberg
and walked to Saddar, the moment it reconnects the branch header says Saddar —
and a week of Gulberg's unsent sales would land in Saddar's books and come off
Saddar's shelf. On the sync path the branch now comes from the device row, which
is server-written at registration and cannot be changed by moving the hardware.
Resolved beside the header it replaces rather than beside the sale row: branch
prices are read from it, and a cart priced at one branch's list and filed
against another's is a harder error to find than the one it prevents.

**And the hard stop (P3-17).** `offline_days` marks; this refuses. Opt-in, 0 =
never — in most of Pakistan a fourth day without internet is not worse than a
closed counter, so a ceiling nobody chose would be this software deciding
otherwise on their behalf. Judged from when the CART WAS STARTED, so a ceiling
reached mid-transaction never strands a cashier with the goods already bagged.
It is the one guard on the offline path whose every doubt falls towards SELLING.

**P4-5** pins the relationship between two screens rather than adding a third:
every rupee the offline report claims came in late is a rupee the cashbook also
has, on the day it happened — and after a day close, `after_close_total` is
exactly the amount by which the cashbook now stands ahead of a drawer that
cannot move.

**Tests**

| ID | Test |
|---|---|
| P4-1 | Price changed while offline → sale recorded at the price taken, variance listed |
| P4-2 | Two tills sold the last unit → both accepted, stock −1, oversell listed |
| P4-3 | Sale from a closed business day → filed on the day it HAPPENED, the signed-off figures do not move, and the shortfall is named in rupees ✅ |
| P4-4 | Sale timestamped by a clock 3 days slow → server assigns the correct day ✅ |
| P4-5 | Variance report totals reconcile against the cashbook ✅ |
| P4-6 | Offline sales appear in the staff report against the right cashier ✅ |

### Phase 5 — hardening

Storage-pressure handling · schema migration with a pending outbox · service
worker update policy · long-soak and chaos tests.

| ID | Test |
|---|---|
| P5-1 | Quota exceeded → the till warns and refuses to open a shift, losing nothing |
| P5-2 | App upgraded with 200 sales pending → all 200 still sync |
| P5-3 | Service worker update is deferred while a shift is open |
| P5-4 | 72-hour soak, 5,000 sales, random disconnects → zero loss, zero duplicates |
| P5-5 | Device moved to another branch offline → branch cannot change ✅ |

---

### Phase 5 — what is built

**Schema upgrade with a pending outbox (P5-2)** — `upgrade.test.ts` seeds a
till at an OLD version from a hand-written fixture, writes two hundred queued
sales, then runs the REAL `upgrade()` and asserts every one survives with its
cart intact. The fixture has to be hand-written: calling today's `upgrade()`
with a low version runs every block and builds today's schema under an old
version number, which is a database no till has ever had. The first attempt did
exactly that, failed with a ConstraintError, and looked like a schema bug for a
minute.

Mutations confirm it bites: a future release that recreates the outbox, demotes
the receipt counter to a cache, or drops a store from the upgrade path is
caught.

**The update strip (P5-3)** now says the queued sales survive the reload. The
fear is unfounded — the outbox is in IndexedDB and every step is additive — but
an unanswered fear postpones the update for a week.

**Out of room blocks a shift; low on room does not (P5-1).** The two were one
condition and they are not the same risk. `not-persisted` says the browser MAY
evict, some day, under pressure that might never come — refusing a till today,
for certain, to avoid that is the worse trade, and it stays the warning it
already was. Being out of room is not a probability: the next write fails, and
the write that fails is a sale. Refusing before the shift costs nothing, because
nobody has paid yet. `shiftBlocker` blocks only at `FULL` (0.98), and its message
names the fix — a blocked till with no way forward is just a broken one.

**Still open in Phase 5:** P5-4 alone — the 72-hour soak, which is a run rather
than a build.

---

## 7. Edge case register

Each has an ID, a resolution, and the test that proves it.

### 🔴 The sale could be lost

| ID | Case | Resolution | Test |
|---|---|---|---|
| E1 | Browser evicts IndexedDB under storage pressure — **outbox gone, sales gone** | `navigator.storage.persist()` at boot; `estimate()` checked; if not granted, warn **before** a shift opens; flush aggressively so the outbox stays small | P0-7, P5-1 |
| E2 | Cashier clears browsing data, or runs in a private window | Persistent storage + installed PWA (home screen, not a tab); the shift-open screen refuses a private context | P0-7 |
| E3 | Two tabs both flushing → the same sale sent twice | Web Locks leader election, single flusher; `idempotency_key` as the second line | P3-12 |
| E4 | App update changes the local schema while sales are pending | Outbox row format is versioned and **never** changed destructively; SW update deferred while a shift is open | P5-2, P5-3 |

### 🔴 The money could be wrong

| ID | Case | Resolution | Test |
|---|---|---|---|
| E5 | JS float vs PHP decimal — `0.1 + 0.2 !== 0.3` | **All money in integer paisa.** Divide only to display | P2-11 |
| E6 | Inclusive-tax extraction rounds differently in the two engines | Rounding mode pinned explicitly; inclusive cases mandatory in the fixtures | P2-3 |
| E7 | Two offline tills both print `INV-1001` | Provisional numbers namespaced by register + device; the server assigns the real one; both stored | P3-1, P3-2 |
| E8 | Price changed while the till was offline | Record what was taken (the drawer must match); report the difference. **Never reject** | P4-1 |

### 🟠 Right sale, wrong place

| ID | Case | Resolution | Test |
|---|---|---|---|
| E9 | The sale's business day is already closed and frozen — *"a day signed off in March must read the same in September"* | **Never reopen a closed day, and never re-file the sale either.** It is recorded on the day it HAPPENED (posting it to the open day would move money between two days and make both wrong), the frozen figures do not budge, and `sales.after_day_close` lets the report name the resulting shortfall in rupees | P4-3 |
| E10 | The tablet's clock is days out | The till corrects by its measured drift (sale, floor and promotion windows together); the server then bounds it — never in the future, never before the till's last contact. `client_sold_at` + `clock_skew_seconds` keep the wrong reading so somebody sets the clock | P4-4 |
| E11 | A product was deleted while the device was offline — `softDeletes()` means `updated_at > cursor` never carries it | Explicit tombstones in the delta | P1-4 |
| E12 | A training-mode sale syncs as real — or worse, a REAL sale syncs as training | Practice needs two opinions: the drawer's `is_training` **and** the till's `operations.*.training`. The till's word can only withhold, never grant; silence means real | P3-15 |
| E13 | The device is carried to another branch | On the sync path the branch comes from the DEVICE ROW, written at registration — never the request's branch header. Resolved before pricing, so branch prices and branch books cannot disagree | P5-5 |

### 🟠 Stock

| ID | Case | Resolution | Test |
|---|---|---|---|
| E14 | Two tills sell the last unit | **Do not block.** Both accepted, stock goes negative, oversell queue reports it. Negative stock is information, not corruption | P4-2 |
| E15 | Medicine batch / FEFO offline | Out of scope by the allow-list | P3-6 |

### 🟡 Working life

| ID | Case | Resolution | Test |
|---|---|---|---|
| E16 | Refresh mid-cart | Cart persisted on every change | P0-1 |
| E17 | Cashier handover offline — the PIN is verified server-side | Handover refused offline; the shift cannot change hands | — |
| E18 | Offline Z read double-counts sales that already synced | The offline Z is **provisional**; the real Z comes from the server after the flush | — |
| E19 | Half a batch syncs | Per-operation status, not per batch | P3-5 |
| E20 | Tablet stolen | Server-controlled `offline_days`; the device token is revocable from the existing Signed-in devices panel | P0-4 |

---

## 8. Rollout

1. Phases 0–2 ship to everyone. Nothing sells offline; the POS just gets faster
   and the pricing mirror earns its trust in shadow.
2. Phase 3 ships behind an admin per-tenant flag, **off by default**.
3. Two friendly tenants first — one mart, one retail. Not a pharmacy.
4. Watch the variance report for two weeks before widening.

**Kill switch:** the flag is server-side. Turning it off stops new offline
sales; **it never touches the outbox**, so anything already rung still syncs.

---

## 9. Decisions taken, so they are not relitigated

| Question | Answer |
|---|---|
| SQLite in the browser? | **No.** IndexedDB. Revisit only past ~100k SKUs. |
| Local stock movement log? | **No.** A number on the catalog row; movements derive server-side. |
| Delete an outbox row after sync? | **No.** `PENDING → SENDING → ACKED`, pruned after 30 days. |
| Cache `cost`? | **Never.** |
| Cache images? | Only in grid (food) mode, thumbnails only, capped. |
| Cache customer balances? | **Never.** `id, name, phone, customer_group_id` only. |
| Gate the allow-list by trade? | **No — by `item_type` and capability flags.** |
| Is card offline safe? | Yes here — ShopOS holds no gateway; card is a recorded tender. |
| Who sets the offline window? | The **admin**, per tenant, exactly like branches and staff — a `owner => 'tenant'` limit in `tenants.limits`. **Not a plan column**, and never the shop's to change. |
| Does the window expire the outbox? | **No.** It limits selling, never syncing. |
| Does the till stop dead at the limit? | Not by default. Owner PIN + a stamp on every sale. A hard stop is opt-in per tenant. |
| Do we need the domain before starting? | **No** — Phases 0–2 build on `localhost`, which is a secure context. **Yes** before the first real-tablet test, and absolutely before Phase 3. Buy it early anyway: the cache is origin-bound, so changing it later wipes every deployed device. |
| Panel and API on separate subdomains? | **No.** One origin, path-split at nginx. |
