# ShopOS — Business-Type Workflows, Visibility & Edge Cases

The operating contract for every business type: which modules it gets, what the
daily loop is, what the UI must show/hide, and the edge + test cases that prove it.

**Three independent axes** define a tenant. Never conflate them:

| Axis | Decides | Stored | Set by |
|---|---|---|---|
| ① Business Type | the *template* (food/mart/pharmacy/retail/services/petroleum) — seeds modules, catalog + expense categories, item types | `tenants.business_type` | Super-Admin at creation |
| ② Modules (features) | *what they can do* — the 10 capability flags. **This is what they bought.** | `tenants.features` (JSON) | plan bundle + Super-Admin toggle |
| ③ Plan / Limits / Subscription | *how much & how long* — quotas + billing window | `tenants.plan_id`, `limit_overrides`, `subscription_ends_at` | Super-Admin |

Module keys: `pos, products, services, inventory, marketplace, reservations, delivery, expenses, images, dine_in`.
Defaults force `expenses=true`, `pos=true`, `images=marketplace` for every type.

---

## Feature matrix (source of truth: `app/Support/BusinessTypes.php`)

| Type | products | services | inventory | marketplace | reservations | delivery | dine_in |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **food** | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| **mart** | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **pharmacy** | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **retail** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **services** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **petroleum** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

**Gating rule:** UI visibility and API authorization must derive from the *same*
`tenants.features` map. A hidden nav item whose endpoint still answers is a leak.

---

## FOOD — restaurant / café / bakery

**Modules:** pos, products, dine_in, marketplace, delivery, expenses
**Item types:** food_item, deal. **No inventory module** (ingredient stock is
recipe-driven, not counted per dish).

**Daily loop**
1. Build menu — food_item + **recipe/BOM** (ingredients), modifiers/add-ons, combos/deals
2. Open shift (float)
3. Sell — **dine-in**: table → open tab → add items → fire KOT → settle (full / split / by-qty)
   **or** takeaway at POS **or** online/delivery order
4. Ingredients deplete via recipe on sale (`allow_negative` — served food must never be blocked)
5. Close shift → variance → reports

**Must SHOW:** Dine-in (floor/tabs), menu + modifiers + recipe editor, KOT print, order-type toggle, Online orders, Riders
**Must HIDE:** Suppliers, Purchases, Stock/Batches, Transfers (inventory off), Warranty lookup, Reservations, Portfolio, Serial/IMEI fields, medicine fields

**Edge cases**
- Combo settle must not block payment for already-served food when a component is out of stock
- A deal containing a made-to-order dish must expand that dish's recipe
- Voided/comped fired items still consumed ingredients (wastage)
- Table occupied → second tab rejected; tab transfer/merge/reopen
- Split by quantity: partial line settlement, remainder stays open
- Modifier price deltas are server-resolved, never client-supplied

**Test cases:** dine-in lifecycle; split-by-qty caps at unpaid amount; recipe depletion on sale/cancel/return; combo component stock; KOT fire; food tenant gets 403 on inventory endpoints.

---

## MART — grocery / supermarket / general store

**Modules:** pos, products, inventory, marketplace, delivery, expenses

**Daily loop**
1. Catalog — barcodes (primary + alternates), **packs** (carton→pieces), **weight items** (`sold_by=weight`, PLU, scale barcodes), price tiers / wholesale
2. Receive stock — purchase order → GRN → stock in
3. Sell — scan-first POS, pack-breaking, weight entry
4. Returns / exchange
5. Low-stock reorder → close shift → reports

**Must SHOW:** full Stock/Suppliers/Purchases/Transfers, barcode + pack + weight fields, Online orders
**Must HIDE:** Dine-in, Warranty lookup, Reservations, Portfolio, Serial/IMEI, medicine fields

**Edge cases**
- Barcode/SKU must be unique across **all** namespaces: `products.barcode`, `product_barcodes`, `product_units.barcode`, `product_variants.sku`, `plu_code` — a collision makes POS scan nondeterministic
- PLU must be typeable/searchable even without scale barcodes
- Scale price-mode: back-solved weight vs printed label price (rounding)
- Pack sale decrements base units × factor; return restocks × factor
- Negative stock policy (mart = optional)

**Test cases:** pack sell/return factor math; weight fractional qty; barcode collision rejected; PLU lookup; low-stock rollup with variants; concurrent last-unit sale.

---

## PHARMACY — medical store / chemist

**Modules:** pos, products, inventory, delivery, expenses. **marketplace off.**
**Item type:** medicine.

**Daily loop**
1. Catalog — generic name, **strength**, **dosage form**, Rx-required flag
2. Receive with **batch + expiry (mandatory)**
3. Sell — **FEFO** (earliest expiry first), **expired-batch fence**, Rx capture
4. Near-expiry monitoring → return-to-supplier / recall
5. Close shift → reports

**Must SHOW:** Batches/expiry, medicine fields (generic/strength/dosage/Rx), near-expiry dashboard, Stock/Suppliers/Purchases
**Must HIDE:** Collections + Online orders + Riders (marketplace off), Dine-in, Warranty, Reservations, Portfolio, Serial/IMEI

**Edge cases**
- Expiry REQUIRED on every stock-in path — product create, PO receive, **and manual adjust/recount** (unbatched stock escapes FEFO *and* the fence)
- Cross-branch transfer must carry lot + expiry (else destination stock is undated)
- FEFO ties; zero-qty batches; variant medicines scoped per variant
- Rx enforcement: block or force-capture; controlled substances need a register
- Returned medicine must not inherit a better expiry than it had
- Batch recall across products/branches

**Test cases:** FEFO order; expired batch refused; expiry required on adjust; transfer preserves lot; variant FEFO; Rx sale without prescription refused; near-expiry alert fires.

---

## RETAIL — electronics / garments / mobile

**Modules:** pos, products, inventory, marketplace, reservations, delivery, expenses
*(the only type with `reservations` on)*

**Daily loop**
1. Catalog — variants (size/colour), **serialized items** (`tracks_serial`, IMEI + warranty months)
2. Receive — register serials into stock
3. Sell — capture one serial per unit, warranty starts
4. Warranty desk lookup; per-serial returns / exchange
5. Reservations (reserve to collect)

**Must SHOW:** Serial & warranty fields, **Warranty lookup** (retail-only), Reservations, variants, Online orders
**Must HIDE:** Dine-in, medicine fields, Portfolio, recipe/BOM

**Edge cases**
- Duplicate serial prevention (in-cart, cross-sale, registry)
- Serial lifecycle `in_stock → sold → returned/in_stock`; a return **must free the serial** or it can never be resold
- Exchange must be able to pass serials
- Warranty desk must treat a returned unit as no-longer-covered
- Reservation expiry releases held stock

**Test cases:** serial required per unit; duplicate serial rejected; return frees serial + voids warranty; warranty lookup on returned unit; reservation hold/release.

---

## SERVICES — salon / repair / workshop / tailor

**Modules:** services, expenses (+ pos optional). **products/inventory/marketplace off.**
**Item type:** service (no stock, `duration_minutes`).

**Daily loop**
1. Define services (duration, price)
2. **Book appointment** *(engine missing — see gaps)*
3. Perform → charge at POS → receipt
4. Portfolio/gallery of work
5. Expenses → reports

**Must SHOW:** Services catalog, Portfolio/gallery, POS (if enabled), Expenses
**Must HIDE:** Stock/Suppliers/Purchases/Transfers, Collections/Online orders/Riders, Dine-in, Warranty, medicine + serial + recipe fields

**Edge cases**
- Selling a service must skip inventory entirely on sale/return/cancel
- Booking: slot conflict, double-booking, staff/resource assignment, no-show, cancellation
- Service + product mixed sale (if products ever enabled)

**Gap:** there is **no appointment engine** — "reservations" holds *product stock*, it cannot book time. Needs its own `bookings` table (start/end, staff/resource, conflict guard).

---

## PETROLEUM — fuel station

**Modules:** pos, products, services, inventory, expenses. **marketplace off.**
Branch = pump/site. Fuel modelled as volume product (litres).

**Daily loop (today)**
1. Catalog — fuel as litre-priced product, lubricants/tyres as products, car-wash/oil-change as services
2. Receive fuel delivery as stock
3. Sell at POS; forecourt mart sells normally
4. Expenses (pump maintenance, generator) → reports

**Must SHOW:** Stock/Suppliers/Purchases, services, Expenses
**Must HIDE:** Collections/Online orders/Riders, Dine-in, Warranty, Reservations, Portfolio, medicine/serial fields

**Gap — Fuel Management module (deferred, net-new):** pumps/nozzles registry, per-shift opening/closing meter readings, tank dip + wet-stock reconciliation (book vs physical variance), fuel price-change history, fuel POS mode (rupees→litres at the day's rate), tanker delivery into tanks, fleet credit accounts, department-wise reporting.

---

## FINANCE / EXPENSE-ONLY *(planned type)*

**Modules:** `expenses` only — everything else off. For offices, agencies, NGOs,
freelancers with no inventory and no till.

**Daily loop:** categories (expense + income) → record expenses/income against
accounts + vendors + projects → budgets → cashbook → reports.

**Must SHOW:** Dashboard (financial), Expenses, Income, Cashbook, Reports, Settings
**Must HIDE:** Catalog/Products, POS, Sales, Stock, Online, everything else

**Needed:** the type itself (stop force-enabling `pos`), nav gating for
Catalog/Sales/POS, then module depth — financial accounts with balances, expense
vendors, projects, budgets, recurring transactions, tags, attachments, approvals.

---

## Cross-cutting: multi-terminal / multi-cashier (large marts)

**Works today:** many cashiers concurrently (session is per user + branch); stock
row-locks serialize concurrent sales; invoice numbers come from a locked counter
(no duplicates across lanes); parked tickets scoped per cashier.

**Missing:** a register/terminal entity (a shift belongs to a person, not a lane);
**per-terminal hardware binding** (today `is_default` is one printer/drawer per
*tenant*, so every lane prints to the same device); same cashier blocked from
moving lanes (`SHIFT_ALREADY_OPEN`); terminal handover; consolidated all-lane
shift close; branch-wide parked tickets; cash-drawer ops (in/out/drop/no-sale).

---

## Universal test matrix

For **every** type assert:
1. Nav shows exactly its modules — no leaks, no gaps
2. A disabled module returns **403 `MODULE_DISABLED`** on its API even for the owner
3. A hidden page is unreachable by typing its URL
4. Item types offered match `itemTypesFor()`
5. Form sections match the type (medicine / serial / recipe / variants)
6. Toggling a module off hides UI *and* blocks the API, and turning it back on restores both with data intact
