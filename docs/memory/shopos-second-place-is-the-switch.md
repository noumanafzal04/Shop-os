---
name: shopos-second-place-is-the-switch
description: STANDING (2026-10-11, NOT PUSHED) — a warehouse is optional; anything about "which place" is drawn from the places a business HAS (`/shop/settings.places`, `hasSecondPlace/hasSecondShop`), never from what its plan allows
metadata:
  type: project
---

**The user asked (2026-10-11):** "warehouse compulsory hai? branch to compulsory hai — warehouse addon main aye ga? kaise manage kia hai — jaise bht sari shops, shops main e apna sb manage krti, branch main unka warehouse ni hota", then "is edge case ko dekho market k lehaz sy".

**Answers given:** only Main branch is compulsory. Warehouse = a plan ALLOWANCE (`max_warehouses`, 1/2/5/20), not a module/add-on; to charge for it: plan Warehouses = 0, or grant paid extra capacity (entitlement) from the shop's page. Both already exist.

**Market (searched):** Shopify + Square show transfers only with multiple locations; Zoho ("Enable Multiwarehouse") and Odoo ("Manage several locations") keep it OFF until switched on. We use the fact, not a setting: **a second open place existing is the switch.**

**Built:** `ShopController::places()` → `/shop/settings.places {shops, warehouses}` (open only); `branches/places.ts` `hasSecondPlace` / `hasSecondShop` (the `mayHaveMore…` pair now means only "may another be ADDED"); menu's Stock by place + Stock transfers, Sales Branch column, product-row buttons, and every `/branches` fetch follow it. `shopNav(..., mine, secondPlace)` 7th param (defaults to `multiBranch`). Place mutations invalidate `["shop-settings"]`.

**How to apply:** any new screen/column/button about places → ask what the business HAS, not what the plan allows. A shop downgraded below what it has keeps the screens for what it has.

**Why this bit me:** I had decided "may have a godown" was the right question in six files during the warehouse work; every plan allows one, so every one-shop business got the multi-place UI and an extra `/branches` request per page.

Related: [[shopos-warehouse-and-wholesale]], [[shopos-menu-in-shopkeepers-words]], [[shopos-books-only-business]], [[shopos-half-a-rule]]

**USER again, 2026-10-11 night (their words):** "lazmi ni branches warehouse main e
stock rkhain — kuch shops hoti jo rkhti — warehouse optional hai kuch bri shops k
liye — hr branch ka apna stock udhe b pra ho skta lazmi ni warehouse." They read my
sentence "warehouse ka maal transfer ke baad bikta hai" as "branches stock through a
warehouse". It was only ever about stock held IN a warehouse. When describing this to
them, lead with: each branch receives, holds and sells its OWN stock; a warehouse is
one more place for whoever wants one. Proven by `EachBranchKeepsItsOwnStockTest`
(two shops, no warehouse; 5/5 on first run, no code change).

