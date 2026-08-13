# SERVICES — audit findings (2026-08-12)

Area key: `services`. Type `services` (legacy `salon`, `service` resolve into it).
Categories: salon_beauty, barber, spa, mobile_repair, computer_repair,
auto_workshop (labour only), tailor, laundry, printing, photography, clinic, other.

Shipped module map for this type (`BusinessTypes::defaultFeatures('services')`):
`services` ✓ · `pos` ✓ · `expenses` ✓ · everything else off
(`products` ✗, `inventory` ✗, `marketplace` ✗, `reservations` ✗, `delivery` ✗, `images` ✗).

---

## What exists today

**The catalog.** `BusinessTypes::itemTypesFor('services', map)` returns exactly
`[service]` when only the `services` module is on
(`shopos-backend/app/Support/BusinessTypes.php:515-561`). `ItemTypes::SERVICE`
declares `inventory => 'never'`, so the item can never hold stock
(`shopos-backend/app/Support/ItemTypes.php:77-86`), and
`StoreProductRequest` enforces it —
`'track_inventory' => [$isService ? 'prohibited' : 'sometimes', …]`,
same for `stock_quantity` and `tracks_serial`
(`shopos-backend/app/Http/Requests/Catalog/StoreProductRequest.php:87,141-143`).
`duration_minutes` is a real column (`shopos-backend/database/migrations/2026_07_11_000001_create_catalog_tables.php:93`),
validated `1..1440` on create and update, written by `CreateProductAction:97`,
edited on the product form (`shopos-admin-and-user-panel/src/modules/catalog/pages/ProductFormPage.tsx:825-836`),
and carried by the CSV importer/exporter (`ImportProductsAction.php:55,138,302`,
`ProductController.php:234`).

**Selling.** Selling a service skips inventory entirely: `CreateSaleAction`
only adjusts stock when `$product->type === ItemType::Product && track_inventory`
(`shopos-backend/app/Actions/Sale/CreateSaleAction.php:859`), and returns/cancels
gate on the same predicate (`:1106,:1156`). The POS, the day/banking screen,
cash sessions, registers, discounts, khata (`customers.credit_balance`),
loyalty and promotions all work for a services tenant because they ride the
`pos` module, not a trade.

**Estimates and advances.** `SaleDocument` covers both — `KIND_QUOTATION`
(a frozen written price, `quotation_valid_days` default 15) and `KIND_LAYAWAY`
(money down now, balance later, `layaway_min_deposit_percent` default 20).
Both ride `feature:pos` (`shopos-backend/routes/api.php:507`), so a services
tenant gets them, and `CreateSaleDocumentAction:359` explicitly skips the stock
pull for a service line. The sidebar offers them as "Quotes & Advances"
(`AppSidebar.tsx:143`).

**Portfolio.** `GalleryImage` + `/shop/gallery` GET/POST/DELETE
(`routes/api.php:167-169`), a `PortfolioPage` shown only to this trade
(`AppSidebar.tsx:248`: `has("services") && businessType === "services"`, resolved
through `usePrimaryBusinessType` so legacy `salon`/`service` tenants keep it),
plus a `service_area` free-text setting (`ShopSettings.php:47`) editable in
Settings → Tax & Delivery (`ShopSettingsPage.tsx:432`). Both are surfaced only on
the public storefront (`MarketplaceController.php:431`, `MarketShopPage.tsx:250`),
which this type ships without. `ServicePortfolioTest` covers the upload path.

**Staff.** `StaffPresets::for()` filters by module and trade, so a services
tenant is offered exactly four jobs — Cashier, Shift supervisor, Accounts,
Manager (`shopos-backend/app/Support/StaffPresets.php`), which is what
`MODULE-GUIDE.md:187-193` documents.

**Reports.** `reportTabs()` gives a services shop Overview, Margins, Staff, Tax,
Receipts and hides the three stock tabs
(`shopos-admin-and-user-panel/src/modules/expenses/reportTabs.ts`).

**Reservations.** `ReservationService` is a PRODUCT-stock hold: the
`reservations` table has `product_id`, `quantity`, `unit_price`, `expires_at` —
and no `starts_at`, no staff, no duration
(`shopos-backend/database/migrations/2026_07_11_000006_create_reservations_table.php`).
`Modules::all()['reservations']['depends'] = ['products']`, so `normalize()`
switches it off for a products-less services tenant even if an admin ticks it.
The help article says so plainly: *"This is holding STOCK, not booking an
appointment."* (`help/content.ts:747`).

---

## Findings

### 1. No job / repair ticket for work taken in — P0 · missing-screen

**Where:** NOT PRESENT ANYWHERE.

**Greps run (all empty for a job/repair entity):**
```
grep -rniE "appointment|booking|job_card|jobcard|repair_job|work_order|workorder" \
  --include="*.php" --include="*.ts" --include="*.tsx" .        → 0 hits (excl. mobile)
grep -rniE "job_card|\brepair\b|work_order|service_order|job_status|jobs_table" \
  shopos-backend/app shopos-backend/database shopos-backend/routes \
  shopos-admin-and-user-panel/src                               → only prose in
                                                                  Modules.php:38,
                                                                  BusinessTypes.php:188/205/206/361/371
                                                                  and a demo item name
grep -rniE "custody|customer_item|held_item|intake|drop_off|dropoff|receipt_token|claim_token" \
  … same four trees                                             → 0 hits
ls shopos-backend/app/Models                                    → no Job/Ticket model
                                                                  except KitchenTicket /
                                                                  RestaurantTicket (dine_in)
```

**Detail.** Seven of the twelve services categories — mobile_repair,
computer_repair, auto_workshop, tailor, laundry, printing, photography — run
their entire day on an object ShopOS has no row for: *a piece of the customer's
property, taken in on Monday, worked on, and handed back on Thursday against a
token.* There is no record of intake, no token number, no condition note, no
intake photo, no promised-ready date, no state (`received → diagnosed → quoted →
in progress → ready → delivered`), and no "what is in the shop right now" list.
The only lifecycle objects in the codebase are `RestaurantTicket` (a dine-in tab,
`feature:dine_in`, which `depends: ['products']`) and `Reservation` (a product
stock hold). Neither can hold a customer's device.

The shop's only tools today are a `Sale` (which is the moment money changes
hands, i.e. the END of the job) and the free-text `customers.notes` column.
`SaleDocument` KIND_LAYAWAY is the wrong direction — it records *the shop's*
goods held for a customer, not the customer's goods held by the shop, it forces
a ≥20% deposit by default, and it has no state beyond open/converted/cancelled.

**Trade reason.** A Hall Road mobile repair counter takes in 10–20 handsets a
day. Each one gets a paper token: "Samsung A12, cracked screen, no back cover,
ready Thursday, Rs 6,500". When the customer comes back and the phone is not
found, or a different phone is handed over, or the shop cannot prove the back
cover was already missing, that is the shop's entire liability exposure. A
dhobi (laundry) and a darzi (tailor) run the same book. Without it the merchant
keeps the paper register anyway and ShopOS only rings the final bill — which is
the one part they never needed software for.

**Minimum version.** One `service_jobs` table: tenant/branch, gap-free
`job_number` (reuse `DocumentCounter`), `customer_id`, free-text
`item_description`, `condition_notes`, optional intake photos (reuse
`GalleryImage`'s storage path shape), `promised_at`, `status` enum, optional
`assigned_to` user, `estimate_total`, and a nullable `sale_id` set when it
converts. One list screen filtered by status, one intake form that prints a
token slip on the existing receipt printer, one "Ready" action, and a "Convert
to sale" that pushes the lines into the POS cart.

---

### 2. No appointment booking with a time slot and a staff member — P1 · missing-screen

**Where:** NOT PRESENT ANYWHERE.
`shopos-backend/database/migrations/2026_07_11_000006_create_reservations_table.php`
and `shopos-backend/app/Services/ReservationService.php` are the nearest thing
and cannot do it.

**Greps run:**
```
grep -rniE "appointment|\bbooking|time_slot|slot_start|start_time|\bcalendar\b" \
  shopos-backend/app shopos-backend/database shopos-backend/routes \
  shopos-admin-and-user-panel/src
  → start_time/end_time exist ONLY on `promotions` (a time-of-day window,
    StorePromotionRequest.php:62, 2026_07_30_000004_create_promotions.php:37)
  → "appointment" appears only as prose in BusinessTypes.php:194-196
grep -rniE "\bchair\b|\bbay\b|\bcapacity\b|resource_id|workstation|seat" …
  → `seats` on dining_tables, `capacity_litres` on fuel tanks. Nothing else.
grep -rn "reservations" shopos-backend/app/Support/Modules.php
  → 'depends' => ['products']
```

**Detail.** The `reservations` table has `product_id`, `quantity`, `unit_price`,
`status`, `expires_at`, `accepted_at`. There is no `starts_at`, no `ends_at`, no
staff/resource column and no conflict guard. `ReservationService::accept()`
calls `InventoryService::adjust(type:'out')` — it holds stock, which a haircut
does not have. And because `Modules::all()['reservations']['depends'] =
['products']`, `Modules::normalize()` turns the flag back off for a services
tenant, so it is not even a per-tenant workaround.

Chair/bay capacity is the same absence: nothing anywhere models a finite
resource a service occupies for a span of time.

**Trade reason.** A ladies' salon in Gulberg books bridal and party bookings by
phone all week — "Saturday 4pm, with Ayesha, colour + blow-dry, 2 hours". Two
bookings for the same stylist at the same hour is the failure the diary exists
to prevent, and on a wedding-season Saturday the shop is fully booked by
Wednesday. A spa and a photography studio have the identical need. A barber does
not — which is why this is P1 and not P0: roughly a third of the categories can
run walk-in.

**Minimum version.** A `bookings` table (tenant/branch, `customer_id`,
`product_id` for the service, `starts_at`, `ends_at` computed from
`duration_minutes`, `assigned_to` user, `status` = booked/arrived/done/no_show,
notes) with a DB-level overlap guard per `assigned_to`. One day/week grid, one
"book" form, one "arrived → send to POS" action. Deliberately NOT the
reservations engine, which must keep meaning "hold stock".

---

### 3. No record of WHO performed a service, and no commission — P1 · missing-data

**Where:**
`shopos-backend/database/migrations/2026_07_11_000003_create_sales_tables.php:56-81`
(`sale_items` has no staff column) ·
`shopos-backend/app/Services/ReportService.php:346-374` (staff report groups by
`sales.created_by`) · commission NOT PRESENT ANYWHERE.

**Greps run:**
```
grep -rniE "commission|payout|incentive|tip_share|service_charge" \
  shopos-backend/app shopos-backend/database shopos-backend/routes \
  shopos-admin-and-user-panel/src
  → BusinessTypes.php:358 'Staff Commission' (a seeded EXPENSE CATEGORY string)
    and a comment in Sale.php:22. No model, no column, no endpoint, no screen.
grep -rniE "technician|stylist|served_by|performed_by|attended_by|staff_id|barber_id" …
  → only ReportService.php:368 'staff_id' => $r->created_by (derived), and the
    panel row that renders it (ReportsPage.tsx:342)
grep -rn "sale_items" shopos-backend/database/migrations/*.php | grep "table("
  → three later ALTERs: product_units, components, directions. No staff column.
```

**Detail.** A sale records `created_by` — the person who rang the till. In a
salon that is the receptionist, not the stylist. `sale_items` carries no staff
reference at all, so on a bill with a haircut by A and a facial by B there is no
way to say so. `ReportService::staffPerformance()` therefore reports "revenue by
cashier", which for this trade is one row containing the whole shop. Nothing
computes a commission rate, a share, or a payout.

The only workaround is the free-text `sales.notes` field, which no report reads.

**Trade reason.** Pakistani salon and barber staff are paid on commission —
typically 30–50% of the service value, settled weekly or monthly, sometimes
daily. The owner cannot pay anyone without the per-line attribution, so a paper
register is kept in parallel *every single day* — and the two never agree,
which is the argument the software was bought to end. Same for a mobile-repair
shop that pays its technician per job.

**Minimum version.** `sale_items.performed_by` (nullable user FK) + a staff
picker on the POS line for service items only + a commission percent on the user
(or on the service item) + one report grouping `sale_items` by `performed_by`.

---

### 4. Service variants: the panel offers them, the server forbids them, and the rejection is invisible — P1 · bug

**Where:**
`shopos-backend/app/Support/ItemTypes.php:82` (`service` → `'variants' => 'optional'`) ·
`shopos-backend/app/Http/Controllers/Api/V1/BusinessTypeController.php:53` (sends it to the panel) ·
`shopos-admin-and-user-panel/src/modules/catalog/pages/ProductFormPage.tsx:207,1039,404` ·
`shopos-backend/app/Http/Requests/Catalog/StoreProductRequest.php:170`.

**Detail.** Three files disagree.

- `ItemTypes::SERVICE` declares `'variants' => 'optional'`.
- `BusinessTypes::VARIANT_ATTRIBUTES['services'] = ['Package', 'Duration']`
  (`BusinessTypes.php:67`) — the type actively *suggests* what a service variant
  should be called.
- The panel computes `showVariants = typeInfo ? typeInfo.variants !== false : !isService`
  (`ProductFormPage.tsx:207`). For `service` that is `'optional' !== false` → **true**,
  so the "Variants (optional)" section renders, and it prints the hint
  *"Common for your business: Package · Duration"* (`:1043-1047`).
- `StoreProductRequest` says
  `'variants' => [$isService || $isDeal ? 'prohibited' : 'sometimes', 'array', 'max:100']`.

So the payload is built (`:404` sends `variants` whenever `showVariants &&
variants.length`) and the server answers 422 with `errors: { variants: [...] }`.

The failure is then **silent**. `generalError` is only set when
`Object.keys(fieldErrors).length === 0` (`:301-305`), which is false here, and
the form only ever renders `err("variants.${i}.name")` / `err("variants.${i}.sku")`
(`:1106,:1109`) — never `err("variants")`. Nothing appears on screen. The
merchant presses Save and the page just sits there.

`deal` is unaffected (`ItemTypes::DEAL` has `variants => false`, so the section
is hidden). `service` is the only type that hits this.

**Trade reason.** "Haircut" with variants Men / Women / Child, or "Dry Clean"
with Shirt / Suit / Blanket at different prices, is the first thing a salon or a
laundry types when it sets up its catalog. It is the shape the type's own
variant hints (`Package`, `Duration`) invite. The item never saves and nothing
says why.

**Evidence:**
```
ItemTypes.php:82        'variants' => 'optional',
BusinessTypes.php:67    'services' => ['Package', 'Duration'],
ProductFormPage.tsx:207 const showVariants = typeInfo ? typeInfo.variants !== false : !isService;
ProductFormPage.tsx:404 ...(showVariants && variants.length ? { variants: … } : {})
StoreProductRequest.php:170  'variants' => [$isService || $isDeal ? 'prohibited' : …]
ProductFormPage.tsx:301 const generalError = … Object.keys(fieldErrors).length === 0 ? … : null;
grep -n 'err("variants")' ProductFormPage.tsx   → 0 hits
```

Fix is one line either way — but they must be made to agree, and the invisible
422 is worth fixing regardless (`generalError` should also fire when the error
keys name no rendered field).

---

### 5. Tips are wired end-to-end on the server and have no POS input — P1 · backend-only-no-ui

**Where:** backend present —
`shopos-backend/app/Http/Requests/Sale/StoreSaleRequest.php:121` (`tip_amount`),
`shopos-backend/app/Actions/Sale/CreateSaleAction.php:630,713`,
`shopos-backend/app/Support/DrawerMath.php:111` (tips excluded from sales, shown
separately on the drawer count), `shopos-backend/app/Support/ShopSettings.php:110`
(`tips_enabled`), `shopos-admin-and-user-panel/src/modules/shop/pages/ShopSettingsPage.tsx:717-724`
(the toggle, with a comment saying it was deliberately moved OUT of the Kitchen
card *"A salon, a workshop and a delivery service all take them"*).
UI absent — `shopos-admin-and-user-panel/src/modules/pos/**`.

**Greps run:**
```
grep -rni "tip_amount\|\btip\b" shopos-admin-and-user-panel/src/modules/pos \
  shopos-admin-and-user-panel/src/modules/sales                  → 0 hits
grep -rni "tip" shopos-admin-and-user-panel/src/modules/dinein   → TabPage.tsx:87,201,220,622-644
grep -n "tip" shopos-admin-and-user-panel/src/modules/pos/services/*.ts → 0 hits
```

**Detail.** The only place a tip can be entered in the whole panel is the
dine-in `TabPage`, which is behind `feature:dine_in` (depends on `products`) and
gated to food shops. A services tenant can switch `tips_enabled` on in Settings
— the card explicitly invites it — walk to the till, and find no box. The
column, the validation rule, the drawer arithmetic and the setting all exist;
only the input is missing. This is the same "capability fully built, one link of
the chain missing" pattern recorded in
`docs/decisions/shopos-import-and-dropped-columns.md`.

**Trade reason.** A barber's or beautician's tip is handed over at the counter
on top of the bill, in cash, several times a day. If it is not recorded it goes
into the drawer unaccounted and shows up at close as a cash *surplus* — which
poisons the one number the shop uses to detect theft, exactly the failure the
`cash_rounding` setting was added to prevent for a different cause.

---

### 6. No prepaid package / session pack — P2 · missing entirely

**Where:** NOT PRESENT ANYWHERE.

**Greps run:**
```
grep -rniE "prepaid|membership|package_credit|session_pack|punch_card|gift_card|giftcard" \
  shopos-backend/app shopos-backend/database shopos-backend/routes \
  shopos-admin-and-user-panel/src                                  → 0 hits
grep -rniE "prepaid|sessions_remaining|package_balance|punch|voucher|store_credit|credit_note" …
  → only 'bill / voucher no.' on the expense form and unrelated prose
grep -rn "credit_balance" shopos-backend/app
  → Customer::credit_balance is khata (positive = customer OWES the shop),
    drawn down by CustomerController::recordPayment. Not a service balance.
```

**Detail.** Nothing models "paid for 10, used 3, 7 left". The three adjacent
features do not substitute: loyalty (`ShopSettings.php:205-208`) is points
earned *after* spending; coupons and promotions
(`PromotionService`, `CouponService`) are discounts on a future sale, not a
drawn-down balance; `customers.credit_balance` is credit *extended*, the
opposite direction, and there is no per-service entitlement on it.

**Trade reason.** "Dus haircut ka package" and monthly spa/threading memberships
are standard in Pakistani salons — the customer pays Rs 5,000 for ten cuts up
front. Today the shop rings it as a single Rs 5,000 sale and then hands out
free haircuts with no record, so the revenue lands in one day and the nine
subsequent visits are invisible to every report.

---

### 7. `mobile_repair` / `computer_repair` ship with no way to record a part — P2 · wrong-gating

**Where:** `shopos-backend/app/Support/BusinessTypes.php:198` (features) and
`:201-221` (the category list) · `shopos-admin-and-user-panel/src/modules/admin/pages/AdminTenantCreatePage.tsx:125`.

**Detail.** The `services` type ships `products: false, inventory: false`.
`BusinessTypes` anticipated this for exactly one category and wrote the warning
into the label — `['value' => 'auto_workshop', 'label' => 'Auto Workshop (labour
only)']`, with a nine-line comment (`:207-213`) explaining that a workshop which
sells parts must be created under `automotive` instead, because *"picking this
one would leave it unable to stock a single tyre"*.

The identical trap applies unmarked to `mobile_repair`, `computer_repair` and
`printing`, and there is no `automotive`-style alternative type for them to be
sent to. A `category` carries only `value` and `label` — it changes no module
defaults (`categoriesFor()` returns exactly those two keys), and
`AdminTenantCreatePage` seeds its module checkboxes from
`selectedType.default_modules` (`:125`), which is per-TYPE. So the category the
admin picks has no effect on what the shop can do.

The capability itself is fine once the admin ticks the boxes:
`itemTypesFor('services', ['products' => true, 'services' => true])` returns
`[physical_product, service]`, and the header comment at `BusinessTypes.php:503-511`
records that this path was deliberately fixed. The gap is that nothing tells the
admin to tick them.

**Trade reason.** Every mobile repair shop in Pakistan sells screens, batteries,
back glasses and tempered glass — the part is usually 70–80% of the ticket. A
shop created as services/mobile_repair can bill "Screen Replacement — Rs 8,000"
as pure labour with no cost, so its margin report reads 100% profit on every job
and it can never count the twelve A12 screens in the drawer. The owner cannot
fix this themselves; modules are admin-controlled.

**Fix shape.** Either warn on the label the way `auto_workshop` does, or let a
`category` carry feature overrides so picking `mobile_repair` pre-ticks
`products` + `inventory` for the admin to confirm.

---

### 8. `duration_minutes` is write-only in the shipped services configuration — P2 · inconsistency

**Where:** written at
`shopos-admin-and-user-panel/src/modules/catalog/pages/ProductFormPage.tsx:825-836`
and `shopos-backend/app/Actions/Catalog/CreateProductAction.php:97`; read for
display at exactly one place —
`shopos-backend/app/Http/Controllers/Api/V1/Marketplace/MarketplaceController.php:470`
→ `shopos-admin-and-user-panel/src/modules/marketplace/pages/MarketShopPage.tsx:331`.

**Greps run:**
```
grep -rn "duration_minutes" shopos-backend/app/Http/Controllers shopos-backend/app/Services shopos-backend/app/Actions
  → ProductController.php:234 (CSV export column)
    MarketplaceController.php:470 (storefront payload)
    CreateProductAction.php:97, ImportProductsAction.php:55/138/302 (writers)
    …no report, no receipt, no POS, no dashboard reads it
grep -rn "duration" shopos-admin-and-user-panel/src/modules/catalog/pages/ProductsPage.tsx
  shopos-admin-and-user-panel/src/modules/pos shopos-admin-and-user-panel/src/modules/receipts
  → 0 hits (other than posSound.ts, an audio envelope)
```

**Detail.** `duration_minutes` is the single trade-specific field the services
type has (`BUSINESS-TYPE-WORKFLOWS.md:145`: *"Item type: service (no stock,
`duration_minutes`)"*). It is stored, validated, imported and exported
correctly. But the only screen that renders it is the public storefront, and
`marketplace` is OFF by default for this type. A services tenant on the shipped
configuration types a duration on every service and then never sees it again —
not on the catalog list, not at the till, not on a receipt, not in a report.

**Trade reason.** A duration is how a salon answers "kitna time lagega?" at the
counter and how the owner works out that one chair can take eight cuts a day.
Showing it on the products list and beside the line at the POS costs one column
each and turns a dead field into the trade's one useful number. (It is also the
input any future appointment engine needs, per finding 2.)

---

### 9. The Portfolio screen has no reachable Help Centre article for the trade that owns it — P2 · wrong-gating

**Where:**
`shopos-admin-and-user-panel/src/modules/help/content.ts:750-772` (article
`online-shop`, `modules: ["marketplace"]`, `screen: "/tenant/portfolio"`) ·
`shopos-admin-and-user-panel/src/modules/help/content.ts:1222-1239` (`articlesFor`) ·
`shopos-admin-and-user-panel/src/layout/AppSidebar.tsx:248` ·
`shopos-admin-and-user-panel/src/modules/help/content.test.ts:173-186`.

**Detail.** Portfolio is offered to exactly one trade —
`has("services") && businessType === "services"` — and that trade ships with
`marketplace: false`. `articlesFor()` drops any article whose `modules` list has
no granted key (`:1233`). The only article naming `/tenant/portfolio` is
`online-shop`, gated on `marketplace`. So the shop that has the screen cannot
read its help, and the shops that can read the help do not have the screen.

The completeness test passes because it asks a different question — *does every
route have some article somewhere* (`content.test.ts:173-186`), not *can the
trade that has the screen see it*. And no article anywhere is gated
`trades: ["services"]`:
```
grep -n "trades:" shopos-admin-and-user-panel/src/modules/help/content.ts
  → pharmacy/mart, pharmacy, retail/automotive, petroleum, automotive,
    petroleum, petroleum.  services: none.
```

The same shape applies to the `service_area` setting
(`ShopSettings.php:47`, labelled *"Service area (service businesses)"* in
`ShopSettingsPage.tsx:432`): it is editable by a services tenant and rendered
only on the storefront that tenant does not have.

**Trade reason.** The Portfolio is the one screen this trade has that no other
trade does — before/after shots are how a salon or a tailor is chosen. It is
also the screen most in need of a "what do I put here" note, and it is the one
screen a services shop is guaranteed to find no help for.

---

### 10. The docs contradict each other on whether appointments will ever exist — P3 · inconsistency

**Where:** `BUSINESS-TYPE-WORKFLOWS.md:149,162` vs `BUSINESS-FLOWS.md:193` vs
`shopos-backend/app/Support/BusinessTypes.php:193-197` vs
`shopos-admin-and-user-panel/src/modules/help/content.ts:747`.

**Detail.** The developer contract lists it as work to be done:

> `BUSINESS-TYPE-WORKFLOWS.md:149` — "2. **Book appointment** *(engine missing — see gaps)*"
> `BUSINESS-TYPE-WORKFLOWS.md:162` — "**Gap:** there is **no appointment engine** … Needs its own `bookings` table (start/end, staff/resource, conflict guard)."

`BusinessTypes.php:196` agrees it is coming: *"Flips on when the appointments
add-on lands"*. The user-facing manual says the opposite, flatly:

> `BUSINESS-FLOWS.md:193` — "> There is no appointment booking, and there will not be."

and the in-app help repeats the refusal (`content.ts:747`: *"ShopOS does not do
appointment booking."*).

**Trade reason.** This is the single biggest decision outstanding for the trade,
and the four places that describe it do not agree. Whichever answer is right,
one of the two documents is currently telling a reader something false — and
`docs/decisions/shopos-docs-discipline.md` makes keeping these straight a
standing rule.
