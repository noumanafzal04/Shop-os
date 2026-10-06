---
name: shopos-withdrawn-module-no-rules
description: DECIDED 2026-10-06 — a switched-off module's rules do not act (server + offline); automatic rules skip silently, named requests are refused out loud
metadata:
  type: project
---

A module switched off by the admin leaves its data behind (a live promotion, a customer group, a coupon). That data is **not policy** while the module is off.

**Why:** journey stage F — Promotions off, till showed Rs 630, server applied the leftover promotion (Rs 504) and refused the sale as BILL_MISMATCH on every such sale. This closes the "open decision" noted on 2026-10-05.

**How to apply:**
- `CreateSaleAction`: `$hasOffers` (promotions) / `$hasCustomers` (customers); never on the trusted path.
- Automatic (promotion, group price level + discount, points earned) → not applied. Named in the request (coupon_code, khata tender, redeem_points) → refused (`MODULE_DISABLED` / `COUPONS_UNAVAILABLE` / `LOYALTY_DISABLED`), never silently dropped.
- Offline: `heldPromotions()` is the ONE reader of cached promotions; `shopHas()` = same answer as the till's `has()` (absent = off).
- A new rule tied to a module must ask the module in all three places (sale, online order, offline engine).

Related: [[shopos-till-offers-what-shop-has]], [[shopos-modules-on-off]]
