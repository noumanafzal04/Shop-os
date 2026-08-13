# Audit 2026-08-12 — MART & GROCERY (`mart`, legacy `grocery`)

Type: `mart` · categories: grocery, supermarket, general_store, mini_mart, convenience_store, dairy_shop
Default modules: products, inventory, marketplace, delivery (+ platform defaults expenses, images, pos)

---

## What exists today

Read before hunting gaps. Everything below was opened, not assumed.

**Loose weighing and scale labels are fully built.** `shopos-backend/app/Support/ScaleBarcode.php`
parses the EAN-13 "restricted circulation" labels a deli/grocery scale prints, prefix-length aware
(1- or 2-digit flag), in both weight mode (5 digits = grams, server re-prices) and price mode
(5 digits = paisa, weight back-solved from the shop's own rate).
`PosController::lookup()` → `scaleLookup()`
(`shopos-backend/app/Http/Controllers/Api/V1/Tenant/PosController.php:50-163`) resolves the label's
PLU against `products.plu_code`, tolerates the scale's zero-padding, and hands the POS a pre-filled
quantity. `products.plu_code` is a tenant-unique column
(`shopos-backend/database/migrations/2026_07_21_000003_add_plu_code_to_products.php`), settable on the
product form (`ProductFormPage.tsx:1257`), through CSV import
(`shopos-backend/app/Actions/Catalog/ImportProductsAction.php:124`), and searchable
(`GlobalSearchService.php:93`). The three `scale_barcode_*` settings have real UI in
`ShopSettingsPage.tsx:997-1008`.

**Per-kg selling works end to end.** `products.sold_by` (`unit|weight`,
`2026_07_11_000001_create_catalog_tables.php:89`) is enforced in every sale path — a non-weight item
rejects a fractional quantity in `CreateSaleAction.php:227`, `AddTicketItemsAction.php:83`,
`CreateSaleDocumentAction.php:154` and `OrderService.php:210`. The POS keypad switches to decimal for
weight lines (`PosPage.tsx:1785, 1836, 2842`), stock adjustment steps by 0.001
(`InventoryPage.tsx:408`), labels print "/kg" (`LabelsPage.tsx:536`), and returns accept 0.001
granularity (`StoreSaleReturnRequest.php:33`).

**Pack-breaking (carton → dozen → piece) is real.** `product_units` holds pack rows with a `factor`,
optional own price and own barcode (`2026_07_21_000004_create_product_units.php`); `sale_items`
carries `unit_name` + `unit_factor`; the POS keeps a pack per cart line
(`PosPage.tsx:65-70, 823-862`); scanning a pack barcode preselects that pack
(`PosController.php:86-95`); purchase order lines order in packs and stock in base units
(`ReceivePurchaseOrderAction.php:120-124`); returns restock `factor ×` the returned count
(`ProcessSaleReturnAction.php:190, 330`). The form edits packs at `ProductFormPage.tsx:1314-1337`.

**Multi-barcode per item exists** — `product_barcodes` (`2026_07_21_000002_add_rx_and_barcodes.php`),
synced from the form via `SyncProductBarcodesAction`, matched in `PosController::lookup()`, and
duplicate-guarded across primary/alternate/pack codes in
`ImportProductsAction::guardUniqueCodes()`.

**Shelf and price labels are a genuine screen.** `shopos-admin-and-user-panel/src/modules/catalog/pages/LabelsPage.tsx`
prints Code128 in four physical mm-sized stocks including a 100×50 "Shelf tag", with shop name,
product name, price (strike-through when a sale price is set), the per-unit rate for weight items,
the barcode digits, the largest pack size, cut lines, roll or sheet mode, and a minimum-x-dimension
warning so a label doesn't fail at the scanner.

**Batches, expiry and FEFO are available to a mart, not just a pharmacy.** `product_batches` with
`expiry_date`, per-branch, FEFO-ordered (`Product::batches()`); `InventoryService::adjust()` eats the
earliest-expiring non-expired lot on every OUT and fences expired quantity off from being sold
(`InventoryService.php:174-245`); `BatchController::expiring()` and the dashboard both surface
near-expiry; the POS warns the cashier on scan (`PosController::nearExpiry()`, 90-day window). The
mart trade profile puts `lowStock` first and `expiring` second
(`src/modules/dashboard/components/shop/trade.ts:68-71`).

**Reorder and stocktake exist and are reachable.** `InventoryController::lowStock()` is
branch-correct (a product with no row on this branch's shelf counts as urgent), the Inventory screen
has a "Needs reordering" view driven off the URL, and it hands the whole shortfall to a half-written
purchase order (`InventoryPage.tsx:32-118` → `PurchaseOrdersPage.tsx:110-141`). Full stocktake with
blind counting, snapshot-based variance and a valued shrinkage figure ships in
`2026_08_06_000008_stock_counts.php` + `StockCountSheetPage.tsx`.

**Promotions, groups and tax are built.** `promotions` supports percent / fixed / BOGO, order /
category / product scope, min spend, min qty, max discount, a date range, days-of-week and a
midnight-wrapping time window (`2026_07_30_000004_create_promotions.php`,
`2026_07_31_000001_add_bogo_to_promotions.php`, `PromotionService.php`) — a "bakery 50% off after
7pm" markdown is expressible today. `customer_groups` pins a price level and a members' discount;
`tax_groups` + inclusive tax ship in `2026_07_31_000002`.

**Khata, delivery and the rest of the daily loop.** Credit sales with a per-customer `credit_limit`
(`Customer::chargeCredit()`), `PaymentMethod::Credit`, a customer ledger and statement; counter-taken
phone/WhatsApp orders (`TakeOrderModal.tsx`, `POST /orders`); riders; derived POS quick-keys that put
barcode-less loose items first (`PosController::quickKeys()`); registers, shifts, blind close,
denomination counts, cash rounding, held tickets claimable from any lane; CSV round-trip import that
updates by SKU and covers price, cost, PLU, pack, low-stock and barcodes
(`ProductCsv.php`, `ImportProductsAction.php`).

---

## Findings

### 1. Receiving a delivery never updates what the product cost — every margin figure is the number typed once, at creation

- **Severity:** P1
- **Kind:** bug
- **Where:** `shopos-backend/app/Actions/Purchase/ReceivePurchaseOrderAction.php:141-175`,
  `shopos-backend/app/Actions/Sale/CreateSaleAction.php:349`,
  `shopos-backend/app/Services/ReportService.php:69, 221`,
  `shopos-backend/app/Services/StockReportService.php:214-231`,
  doc claim in `BUSINESS-FLOWS.md:130`

**Detail.** `ReceivePurchaseOrderAction` writes the real delivered rate into
`product_batches.cost` (`unit_cost / factor`, line 173) and leaves `products.cost` untouched.
Nothing else writes it either: outside `CreateProductAction`, `UpdateProductAction` and
`ImportProductsAction`, `products.cost` is never assigned anywhere in the backend. But COGS on a sale
line is snapshotted from the product/variant, not the batch —
`CreateSaleAction.php:349` `'unit_cost' => $source->cost !== null ? round((float) $source->cost * $factor, 2) : null` —
and `ReportService` computes gross profit, the Margins report and every margin percentage from
`SUM(sale_items.unit_cost * quantity)`. `StockReportService::valuation()` likewise values the shelves
off `COALESCE(product_variants.cost, products.cost)`. So the true cost is captured on the lot and
then ignored by every number the owner reads. `BUSINESS-FLOWS.md:130` states the opposite as the
mart's daily flow: *"Stock keeper receives against the PO — stock rises, and the cost on the row is
what the delivery actually cost."*

**Trade reason.** A Pakistani mart's buying rates move constantly — sugar, atta, ghee, cooking oil,
dalda, eggs and milk change within a month, several times in a bad one. A shop that entered
sugar at Rs 140/kg in July and is buying at Rs 168/kg in August still shows a July margin on every
kilo, and the Margins report will keep recommending the lines that are actually the thinnest. The
only fix today is to hand-edit the cost on every affected product after every rate change.

**Evidence.**
```
grep -rEn "'cost' =>" shopos-backend/app/Actions shopos-backend/app/Services
  → only CreateProductAction, ImportProductsAction, ReceivePurchaseOrderAction:173 (the BATCH row)
grep -rEn "->cost =|update\(\['cost'|cost_price|last_cost|last_purchase" shopos-backend/app  → 0 hits
grep -rn "unit_cost" shopos-backend/app/Actions/Sale/CreateSaleAction.php  → :349, :798 (from $source->cost)
grep -rn "unit_cost" shopos-backend/app/Services/ReportService.php  → :69 cogs, :221 margins
```

---

### 2. A product does not know who supplies it, so the reorder list cannot be ordered from anyone

- **Severity:** P1
- **Kind:** missing-field
- **Where:** `shopos-backend/database/migrations/2026_07_11_000001_create_catalog_tables.php:67-108`
  (no supplier column), `shopos-admin-and-user-panel/src/modules/inventory/pages/InventoryPage.tsx:106-120`,
  `shopos-admin-and-user-panel/src/modules/purchases/pages/PurchaseOrdersPage.tsx:110-141`

**Detail.** `supplier_id` exists on `purchase_orders`, `supplier_payments`, `expenses` and
`fuel_deliveries` — and on nothing in the catalog. `products` has no supplier column, there is no
`product_supplier` pivot, and no "preferred supplier" concept anywhere. The consequence is visible in
the one flow that was built to use it: the reorder view hands *every* low item to a single purchase
order for a single supplier, each at quantity 1 and at the (stale, see #1) product cost. The buyer
then has to delete most of the lines by hand, remember which distributor carries which brand, and
repeat the whole trip N times.

**Trade reason.** A general store buys from 15–40 different order-bookers: one for Unilever, one for
Nestlé, one for the biscuit company, a separate man for eggs, another for bread, a dairy van. The
buying question is never "what is low?" — it is "the Shan booker is standing here right now, what do
I need from *him*?" Without a product→supplier link, the reorder list cannot answer the only version
of the question anyone actually asks.

**Evidence.**
```
grep -rn "supplier_id" shopos-backend/database/migrations/*.php
  → purchase_orders, supplier_payments, expenses, fuel_deliveries ONLY; never products
grep -rn "supplier" shopos-backend/app/Models/Product.php  → 0 hits
grep -rn "supplier" shopos-admin-and-user-panel/src/modules/catalog/types.ts  → 0 hits
grep -rEin "preferred_supplier|default_supplier" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
```

---

### 3. Nothing can be returned to a supplier — no purchase return, no debit note, no way to reduce what you owe

- **Severity:** P1
- **Kind:** missing-screen
- **Where:** NOT PRESENT ANYWHERE. Nearest code: `shopos-backend/app/Models/Supplier.php:32-46`,
  `shopos-backend/database/migrations/2026_07_11_000013_create_purchasing_tables.php`,
  `shopos-backend/routes/api.php:352-359`

**Detail.** The purchasing module runs one direction only: PO → place → receive → pay. There is no
purchase-return, credit-note, debit-note or goods-return table, endpoint, action or screen.
`Supplier::scopeWithOutstanding()` computes what is owed as
`SUM(purchase_orders.total) − SUM(purchase_orders.amount_paid)` over non-cancelled orders, so there is
no term in which a credit could even be recorded. The only available workaround is a manual stock-out
adjustment with a free-text reason (which, per #7, is invisible to every report) plus either
overstating a supplier payment or leaving the payable permanently wrong.

**Trade reason.** Expiry-return and damage-return are a scheduled part of a Pakistani general store's
month. The biscuit and snacks companies take back short-dated stock; the dairy van takes back
unsold milk and yoghurt the next morning; a leaking oil bottle or a crushed carton goes back on the
next visit. The value is credited against the next invoice, and the shopkeeper's whole negotiating
position with the booker is the running balance. ShopOS can record the money going out and can never
record it coming back off the bill.

**Evidence.**
```
grep -rEin "purchase_return|PurchaseReturn|purchase return" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
grep -rEin "debit_note|debitNote|credit_note|supplier_credit" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
grep -rEin "supplier_return|return to supplier|grn|goods_received" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
grep -n "purchase-orders" shopos-backend/routes/api.php  → index, show, receive, store, place, cancel — no return
```

---

### 4. An item at zero stock does not appear on the reorder list unless somebody hand-set a threshold on it

- **Severity:** P1
- **Kind:** bug
- **Where:** `shopos-backend/app/Http/Controllers/Api/V1/Tenant/InventoryController.php:57-81`,
  `shopos-backend/app/Services/DashboardService.php:406-427`,
  `shopos-backend/app/Models/Product.php:279-284`,
  `shopos-admin-and-user-panel/src/modules/dashboard/components/shop/trade.ts:68-71`

**Detail.** Every low-stock path begins `whereNotNull('low_stock_threshold')`, and
`Product::isLowStock()` returns false when the threshold is null. `low_stock_threshold` has no
default at any layer: the column is nullable with no default, `CreateProductAction:95` writes
`$data['low_stock_threshold'] ?? null`, CSV import passes it straight through, and there is no
shop-level default setting (`ShopSettings::defaults()` has none). So a mart that imports 2,000 SKUs
without that optional column — or that adds products through the form without filling the optional
field — gets a permanently empty reorder list and a dashboard "Low stock" tile that reads 0 forever,
even for products sitting at zero. That tile is the *first* focus item for this trade by design
(`trade.ts` mart profile: `focus: ["lowStock", ...]`, commented "A mart lives on shelf availability").

**Trade reason.** This is the number one screen the trade is built around, and it silently reads zero
for the shop that most needs it. A kiryana with 2,000–5,000 lines will never hand-fill a threshold
per product, and the reorder view's own empty state actively misleads: *"Nothing is below its reorder
level. This branch is fully stocked."* — printed over a shop that has run out of sugar.

**Evidence.**
```
grep -rn "low_stock_threshold" shopos-backend/app | grep -v test
  → InventoryController:63 whereNotNull, ProductController:62/187 whereNotNull,
    DashboardService:412/420 whereNotNull, Product.php:282 !== null
grep -rEin "default_low_stock|low_stock_default" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
grep -n "low_stock" shopos-backend/app/Support/ShopSettings.php  → 0 hits
```

---

### 5. The till refuses to sell an out-of-stock item and there is no override — although the write path already supports one

- **Severity:** P1
- **Kind:** backend-only-no-ui
- **Where:** `shopos-backend/app/Services/InventoryService.php:145-152`,
  `shopos-backend/app/Actions/Sale/CreateSaleAction.php:858-870`,
  `shopos-admin-and-user-panel/src/modules/pos/pages/PosPage.tsx:902-915`,
  `shopos-backend/app/Support/ShopSettings.php` (no setting)

**Detail.** `InventoryService::adjust()` already takes an `allow_negative` flag and four internal
callers pass it (`ProcessSaleReturnAction:421`, `CancelSaleAction:131`, `ApplyStockCountAction:86`,
the recipe/deal paths in `CreateSaleAction:832, 854`). The plain product sale path
(`CreateSaleAction:858-870`) does not, so a POS line whose stock would go below zero throws
`INSUFFICIENT_STOCK` and rolls the whole sale back. The POS blocks it client-side first
(`PosPage.tsx:903`: `const out = p.type === "product" && p.track_inventory && Number(p.stock_quantity) <= 0`)
with a flat "X is out of stock" and no way past — no supervisor permission, no confirm, and no shop
setting exposes `allow_negative`. `track_inventory` is `prohibited` on update
(`UpdateProductRequest.php:32`), so the only escape hatch cannot even be turned on after the fact.

**Trade reason.** In a mart the shelf is right, the database is approximate: a delivery gets put out
before anyone books it in, opening stock was estimated, and a mis-scanned line at the last rush put
one SKU three units negative. The customer is standing at the counter holding the packet. Today the
cashier has to leave the till, find someone with `inventory.manage`, adjust the stock in, come back
and re-scan — and if nobody with that permission is in the shop at 9pm, the sale simply cannot be
rung. This is the single most common reason POS rollouts fail in kiryana stores.

**Evidence.**
```
grep -rn "allow_negative" shopos-backend/app
  → InventoryService:145; ProcessSaleReturnAction:421; CancelSaleAction:131;
    ApplyStockCountAction:86; CreateSaleAction:832,854  — never on the plain product line
grep -rEin "negative_stock|oversell|allow_negative" shopos-backend/app/Support/ShopSettings.php  → 0 hits
grep -rEin "allow_negative|oversell|sell anyway" shopos-admin-and-user-panel/src  → 0 hits
```

---

### 6. A home-delivery order cannot be amended — only advanced or cancelled

- **Severity:** P1
- **Kind:** missing-screen
- **Where:** `shopos-backend/routes/api.php:675-683`,
  `shopos-backend/app/Services/OrderService.php:403-474`,
  `shopos-admin-and-user-panel/src/modules/orders/pages/OwnerOrdersPage.tsx`

**Detail.** The owner-side order API is `index / store / show / advance / assign-rider / cancel`.
There is no endpoint to change a line's quantity, remove a line, add a substitute, or re-total an
order after placement, and `OwnerOrdersPage` renders items as static text with only status and rider
controls. `OrderService::complete()` then bills the order exactly as placed
(`amount_paid = subtotal − discount`, line 489). A short-picked order therefore either has to be
cancelled outright (losing the whole basket and the customer's slot) or delivered short, in which
case the rider collects money for goods that were never handed over and the sale, the stock movement
and the day's takings all record a fiction.

**Trade reason.** Every grocery delivery order needs amendment. The customer asks for 1 kg tomatoes
and the picker weighs 1.15 kg; the brand of atta they wanted is finished so you send the other one
and phone to ask; the last two eggs are cracked. `delivery` and `marketplace` are both ON by default
for this trade, so this is the shipped configuration, not an edge case.

**Evidence.**
```
sed -n '675,683p' shopos-backend/routes/api.php
  → GET /, POST /, GET /{id}, POST /{id}/advance, POST /{id}/assign-rider, POST /{id}/cancel
grep -rn "function " shopos-backend/app/Services/OrderService.php
  → place, advance, assignRider, cancel, complete, releaseStock, notifyCustomer — no amend/edit
grep -rEin "substitut|amend|edit.*order|order.*edit" shopos-backend/app/Services/OrderService.php
  shopos-admin-and-user-panel/src/modules/orders  → 0 hits
```

---

### 7. Exactly one promotion can fire on a basket — a shop running two offers can only honour the bigger one

- **Severity:** P1
- **Kind:** bug
- **Where:** `shopos-backend/app/Services/PromotionService.php:17-44, 185-218`,
  `shopos-backend/database/migrations/2026_07_30_000004_create_promotions.php:50-55`

**Detail.** `PromotionService::best()` loops every live promotion, keeps the one with the largest
discount (priority only breaks a tie) and returns a single `{promotion, discount}`. The sale carries
one `promotion_id`, one `promo_name` and one `promo_discount` column, so the schema cannot hold more
than one either. A basket that qualifies for a category promo on dairy *and* a BOGO on soap receives
whichever is worth more; the other silently does not apply, and neither the cashier nor the receipt
says why.

**Trade reason.** A supermarket or mini-mart runs several concurrent offers as a matter of course —
a weekly flyer, a Ramzan category discount, a supplier-funded buy-2-get-1 on one brand. A customer
whose basket contains both items is told at the counter that the advertised soap offer "didn't come",
and the cashier's only recourse is a hand-keyed discount, which is capped by
`max_discount_percent`/`max_discount_amount`, may need `discounts.override`, and is recorded as
cashier discretion rather than as the promotion it actually was — poisoning both the discount audit
and the promotion's own performance figures.

**Evidence.**
```
grep -n "single best\|best(" shopos-backend/app/Services/PromotionService.php
  → :18 "The single best live promotion for a cart, or null"; :25 best(); :36-40 keeps one winner
grep -n "promotion_id\|promo_discount" shopos-backend/database/migrations/2026_07_30_000004_create_promotions.php
  → one uuid column, one name column, one amount column on `sales`
grep -rEin "stack|combinable|multiple promotions" shopos-backend/app/Services/PromotionService.php  → 0 hits
```

---

### 8. A refund always puts the goods back on the shelf — there is no "damaged, do not restock"

- **Severity:** P2
- **Kind:** missing-field
- **Where:** `shopos-backend/app/Http/Requests/Sale/StoreSaleReturnRequest.php:17-47`,
  `shopos-backend/app/Actions/Sale/ProcessSaleReturnAction.php:23, 186-200`,
  `shopos-admin-and-user-panel/src/modules/sales/pages/SalesPage.tsx:471`

**Detail.** The return request accepts `sale_item_id`, `quantity`, `serials`, `reason`,
`refund_method`, `notes` and `cash_session_id` — no restock flag. `ProcessSaleReturnAction` is
documented as "validate quantities → restock (IN via InventoryService) → refund record" and always
moves stock back in, and for a batch-tracked line it reverses FEFO, putting the unit back into the
earliest-expiring lot. The button in the panel is literally labelled "Refund & restock". A refund of
something that went in the bin therefore inflates on-hand by one unit *and*, for dated stock,
re-credits a lot that may already be at its expiry.

**Trade reason.** In a grocery, the overwhelmingly common return is a spoiled or damaged good: sour
milk, a leaking oil bottle, a torn 5 kg atta bag, mouldy bread. None of it goes back on the shelf.
Every such refund quietly adds a phantom unit to stock, which then has to be found again by the next
stocktake and written off as shrinkage — the exact drift stocktake exists to remove.

**Evidence.**
```
cat shopos-backend/app/Http/Requests/Sale/StoreSaleReturnRequest.php  → no restock/condition field
grep -rEin "restock|return_to_stock|restore_stock|do_not_restock|no_restock|damaged"
  shopos-backend/app/Actions/Sale/ProcessSaleReturnAction.php
  shopos-backend/app/Http/Requests/Sale/StoreSaleReturnRequest.php
  → only unconditional restock prose; no flag
grep -rEin "do_not_restock|no_restock" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
```

---

### 9. Stock written off as spoiled, expired or damaged has no register, no report and never reaches the books

- **Severity:** P2
- **Kind:** backend-only-no-ui
- **Where:** `shopos-admin-and-user-panel/src/modules/inventory/pages/InventoryPage.tsx:62, 416-421, 200`,
  `shopos-backend/app/Http/Controllers/Api/V1/Tenant/InventoryController.php:33-43`,
  `shopos-admin-and-user-panel/src/modules/inventory/services/inventoryService.ts:59-62`,
  `shopos-admin-and-user-panel/src/modules/expenses/reportTabs.ts`,
  `shopos-backend/app/Support/BusinessTypes.php:138` (the seeded `Spoilage/Wastage` category)

**Detail.** Writing stock off is a free-text `reason` on an `out` adjustment (placeholder:
"e.g. Damaged") or a batch removal whose confirm text promises it will be "recorded as wastage"
(`InventoryPage.tsx:200`). Nothing then reads it. The reason is unstructured, so it cannot be grouped.
`GET /inventory/movements` *does* accept a `type` filter server-side
(`InventoryController.php:37`), but the panel's service only ever sends `product_id` and `page`, and
the only place movements are rendered is a small list inside the per-product adjust modal — there is
no shop-wide "what left the shelves without a sale" view. No report tab covers it: the tabs are
overview, margins, valuation, dead-stock, purchases, staff, tax, receipts. And because
`ReportService` derives COGS purely from `sale_items`, spoiled stock never enters cost of goods at
all, so gross profit is overstated by the full value of everything thrown away unless the owner
separately estimates it and types it into the `Spoilage/Wastage` expense category — a category this
platform seeds for `mart` by default, promising a workflow it does not connect.

**Trade reason.** A dairy shop, a bakery corner and any mart with a vegetable rack throws product
away every single day. "How much did I bin this month?" is a question the owner asks, and there is no
screen that can answer it — nor any figure that stops the profit report from reading better than the
shop actually did.

**Evidence.**
```
grep -rEin "wastage|spoilage|write_off|writeoff|shrinkage" shopos-backend/app shopos-admin-and-user-panel/src
  → BusinessTypes.php:138 (seeded expense category), InventoryPage.tsx:200 (confirm text),
    StartStockCountAction / stock_counts (counting only), help/content.ts prose — no report, no model
grep -n "movements" shopos-admin-and-user-panel/src/modules/inventory/services/inventoryService.ts
  → :59 movements({ product_id?, page? })  — the server's `type` filter is never sent
cat shopos-admin-and-user-panel/src/modules/expenses/reportTabs.ts
  → STOCK_TABS = valuation, dead-stock, purchases; SALES_TABS = margins, staff, tax, receipts
grep -rEin "wastage_report|write_off_report|stock_adjustment.*report" shopos-backend shopos-admin-and-user-panel/src  → 0 hits
```

---

### 10. Returnable containers (glass bottles, milk crates) have no representation

- **Severity:** P3
- **Kind:** missing-field
- **Where:** NOT PRESENT ANYWHERE. Greps below.

**Detail.** There is no deposit, returnable, empties or container concept in the catalog, the sale or
the POS. `deposit` in this codebase means only a bank deposit (`BankDeposit`, `BusinessDay`) or a
layaway advance (`SaleDocumentPayment`, `layaway_min_deposit_percent`). A shop that takes empty
bottles back has to either hand cash out of the drawer as a `no_sale`/`pay_out` movement, or key a
discretionary discount on the next sale — the first leaves a drawer variance with no goods trail, the
second is capped by `max_discount_*` and recorded as cashier discretion.

**Trade reason.** Glass-bottle soft drinks and returnable milk/curd crates are still ordinary stock in
a kiryana or general store, and the empties are money: the customer expects the bottle price back or
netted off, and the distributor counts crates on the next visit. Rated P3 rather than P2 because only
the subset of marts that carry glass returnables hit it, and both workarounds do let the day close.

**Evidence.**
```
grep -rEin "deposit" shopos-backend/app
  → BankDeposit, BusinessDay, CashMovement, SaleDocument(Payment), PaymentMethod, ShopSettings
    (layaway_min_deposit_percent) — banking and layaway only
grep -rEin "returnable|crate|empties|bottle_deposit|khali" shopos-backend shopos-admin-and-user-panel/src
  → `returnable` only in SaleStatus/ProcessSaleReturnAction prose about refundable sales; rest 0 hits
grep -rEin "container|deposit_amount|refundable_deposit" shopos-backend/database/migrations  → 0 hits
```

---

## Judged and NOT reported (verified present and working)

| Daily need | Verdict |
|---|---|
| Loose weighing + scale-label barcodes | Works — `ScaleBarcode`, `plu_code`, `scaleLookup`, settings UI, POS pre-fill |
| Pack-breaking carton→dozen→piece | Works — `product_units.factor`, POS pack picker, pack barcodes, PO packs, pack-aware returns |
| Per-kg vs per-piece pricing | Works — `sold_by` enforced in all four sale paths, decimal keypad, decimal returns |
| Multi-barcode same item | Works — `product_barcodes` + pack barcodes + duplicate guard across all three |
| Shelf / price label printing | Works — `LabelsPage`, four mm stocks incl. 100×50 shelf tag, price, per-unit rate, pack size |
| Near-expiry visibility | Works — batches, FEFO, expired-stock fence, `expiring` endpoint, POS scan warning, mart dashboard tile |
| Short-expiry markdown | Achievable — a time-windowed / day-of-week category promotion does this today |
| Khata for regulars | Works — `credit_limit`, `PaymentMethod::Credit`, customer ledger + statement |
| Customer groups / tax groups / BOGO | Work — see migrations `2026_07_31_000001/2/3` |
| Stock counting / shrinkage discovery | Works — blind counts, snapshot variance, valued shrinkage |
| Bulk price + threshold edit | Achievable — CSV export→edit→import updates existing rows by SKU |
| MRP vs selling price | Not reported — a shop sets `price` to the printed price; no distinct operational loop in PK marts |
