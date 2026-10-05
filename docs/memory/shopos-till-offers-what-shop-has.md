---
name: shopos-till-offers-what-shop-has
description: POS showed Quote/coupon/Khata/bank-offer to shops without the module (4–8 of 8 trades by default); gated + browser spec per trade; drawer drew stale X-read
metadata:
  type: project
---
2026-10-05. User report: "This module is not enabled for your shop — Quote and Advance, why showing?" The till's doors are buttons→sheets→API, so `offeredIsReachable.test.ts` (reads LINKS) never saw them. Defaults: documents OFF for mart/food/pharmacy/petroleum; promotions OFF for 5 trades; bank_offers OFF for all.

Fixed in PosPage: `sellsQuotes/hasOffers/hasKhata/hasBankOffers`. Guards: `tillOffersWhatTheShopHas.test.ts` + `e2e/tillOffers.ts` (run as mart, restaurant, 6 trades via `trade.*.spec.ts`; asserts ZERO `MODULE_DISABLED` responses during a sale). Still open: `CreateSaleAction` applies promos/coupons/group/khata with no feature check (leftover data after a module is withdrawn).

Same day, other real bugs found by living through a shift in a browser (`e2e/till-drawer.spec.ts`): Drawer + Close-shift sheets drew the X-read from BEFORE the last sales (sheets stay mounted, `staleTime:0` still draws old data) → `useSessionReport` withholds `data` while fetching. F9 gated on `open` shift while Pay button used `canRing`. Selected tile had no dark half (white on white). `buildRamp` used absolute lightness → 6 of 7 colour presets had 600 lighter than 500. Audit trail `LIKE %Customer%` returned CustomerGroup. Sweep harness: stale-token return in `Api.login`, hard-coded FEFO date.
