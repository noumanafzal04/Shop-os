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

## Fixed in the second round (same day)

| # | Was | Fix |
|---|---|---|
| A6 | Sidebar "Transfers" on plan alone | also needs `inventory` |
| A7 | Help "Open this screen" to a refused/redirected screen (5 articles) | article gates corrected; `screenNeeds` + `canOpenScreen` |
| A8 | ⌘K offered Customers / Suppliers / Products without the module | `GlobalSearchService` asks the module too |
| A9 | Settings showed Delivery without the module; Save refused for the whole form | switch not drawn; Pickup cannot be turned off |
| A10 | "Quotes & advances" settings without `documents` | sub-tab needs `documents` |
| A11–13 | Reorder → PO, "Sent back to supplier" (2 sheets) without `purchasing` | gated |
| A14–15 | Orders asked `/riders`; Take order defaulted to Delivery | gated on `delivery` |
| A16 | Pharmacy substitute sheet without `inventory` | gated |
| B3 | Expenses asked `/suppliers` on `inventory` | `purchasing` |
| B4–6 | Staff form offered permission boxes / jobs for modules the shop lacks | `Permissions::NEEDS_MODULE`, `StaffPresets` re-keyed |
| B7 | "Scale barcodes" (a till setting) behind `labels` | tab opens on `labels` OR `pos` |
| B11 | Full-screen till / floor / kitchen never refreshed the module map | `useMe()` in `TenantThemed` |

## Still open

| # | Sev | Where | What happens |
|---|---|---|---|
| A17 | minor | `notifications/deepLink.ts:55-73` | expiry/low-stock links to screens the shop lacks |
| A18–22 | minor | Subscription, Settings, Reports, Income/Expenses, Product editor | visible, no bounce, wrong module |
| B2 | minor | Workshop route | gated on `pos` + trade; its API needs `documents` |
| B9 | minor | dashboard / search | a delivery-only shop has Orders but no dashboard link |
| B10 | minor | `TenantResource.php:69` | sends the raw map, not the dependency-walked one |
| B13–14 | minor | stocktake hook, `DashboardService` | looser key than the route; harmless today |

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
