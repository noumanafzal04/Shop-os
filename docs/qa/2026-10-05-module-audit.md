# Module-visibility audit — 2026-10-05

Read-only audit (a separate agent; it changed nothing). Rule: a module a shop
was never sold is INVISIBLE; a control that bounces with `MODULE_DISABLED`
reads as a broken product. Every finding below was read on both sides (the
panel that offers it, the route that refuses it). The top ones were
re-verified by hand before fixing.

## Fixed the same day

| # | Was | Fix |
|---|---|---|
| POS | Quote/Advance, coupon box, Khata, bank offers for every shop | gated on documents / promotions / customers / bank_offers |
| A1 | Dashboard "New sale" for an online shop → refused at Complete | `caps.pos`; `/tenant/sales/new` wrapped in `RequireFeature pos` |
| A2 | Sales → Exchange for an online shop → refused | `hasPos` |
| A3 | `GET /pos/sellers` refused on every Sales load | `enabled: hasPos`; `features.pos ?? true` → `?? false` (B12) |
| A4 | 3 refused `pos` requests on every screen for online/finance shops | `useOfflineBoot` / `useKeepInSync` only with `pos` |
| A5 | `GET /collections` refused on every product-editor open without marketplace | `useCollections(marketplaceEnabled)` |

## Still open — in priority order

| # | Sev | Where | What happens |
|---|---|---|---|
| A6 | major | `AppSidebar.tsx:99-104` | "Branches → Transfers" shown on plan alone; needs `inventory` |
| A7 | major | `help/content.ts` (work board, online shop, labels ×2, New sale) | "Open this screen" lands on a refused or redirected screen |
| A8 | major | `CommandPalette.tsx:182` | ⌘K offers Customers without `customers` |
| A9 | major | `ShopSettingsPage.tsx:620-712` | Order fulfillment shows Delivery for shops without `delivery`; Save refused `FULFILLMENT_REQUIRED` |
| A10 | minor | `settingsTabs.ts:83` | Quotes & advances switches without `documents` |
| A11–13 | minor | Inventory reorder / dispose / write-off | supplier calls need `purchasing` |
| A14–15 | minor | Orders page / Take order | riders + Delivery default need `delivery` |
| A16 | minor | `PosPage.tsx:1702` | pharmacy substitute sheet needs `inventory` |
| A17 | minor | `notifications/deepLink.ts:55-73` | expiry/low-stock links to screens the shop lacks |
| A18–22 | minor | Subscription, Settings, Reports, Income/Expenses, Product editor | visible, no bounce, wrong module |
| B4–6 | major/minor | `Permissions.php:377-392`, `StaffPresets.php` | Staff form offers permission boxes / jobs for modules the shop lacks |
| B7 | minor | `settingsTabs.ts:56` | "Scale barcodes" (a till setting) behind `labels` |
| B11 | major after a module change | `useMe()` only in `AppLayout` | POS/floor/kitchen opened full-screen never refresh the module map |
| B10 | minor | `TenantResource.php:69` | sends the raw map, not the dependency-walked one the server enforces |

**Guard blind spots:** `panel/src/test/tradeFeatures.ts` has no `online`
entry; `offeredIsReachable.test.ts` mounts only QuickActions + MoneyPanel and
its axes skip 10 modules; `shopNav.test.ts` lists 12 of 21 keys.

## Server applies a module's rules without checking it (decision needed)

`Tenant::applyModules` only writes the map, so data from a module switched off
later stays live: automatic promotions and customer-group pricing on every sale
(with `expected_payable` this now shows as a two-press `BILL_MISMATCH` instead
of a silent discount), loyalty earn, khata tender by API, coupons on online
orders, bank offers by API, stock still deducted for tracked items with
`inventory` off (and no screen to restock), disposals written by
`DELETE /inventory/batches`, expiry alerts, every phone becoming a Customer row.
Choice: either check the module in `CreateSaleAction`/`OrderService`, or have
switching a module off deactivate its rules. Not changed without a decision.
