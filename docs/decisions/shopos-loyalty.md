---
name: shopos-loyalty
description: Loyalty & rewards SHIPPED — points earn/redeem/reverse modelled on the khata ledger; POS redeem + settings + customer statement; product search now also matches description + category
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-30T07:26:40.807Z
---

**2026-07-29 — Loyalty & rewards SHIPPED (backend 650 tests green +10 LoyaltyTest; panel tsc+build clean; backend 5bb4ece, panel 3a4d24b).** Picked as the top "remaining doc gap" (broadest daily cross-vertical value; HRM explicitly NOT being added). Modelled EXACTLY on the khata credit ledger ([[shopos-payments-status]] context: still no gateway — loyalty is a discount, not money).

- Schema: `customers.loyalty_points` (int) + `sales.points_earned`/`points_redeemed` + `loyalty_entries` ledger (type earn|redeem|reverse_earn|reverse_redeem, points positive, balance_after, sale_id). Model `LoyaltyEntry`; Customer methods earnPoints/redeemPoints/reverseEarnedPoints/refundRedeemedPoints + loyaltyEarnedReversible/loyaltyRedeemedReversible (mirror outstandingCreditForSale). Balance clamped ≥0 (clawback can't take spent points).
- Earn: on completed sale, floor((subtotal−ALL discounts)/earn_per_amount) — net of redemption so you never earn for spending points. POS-only (`!trusted`), needs a linked customer (phone).
- Redeem: StoreSaleRequest `redeem_points` (a COUNT, never a price — server prices via redeem_value; same server-authoritative rule as unit_price). Folds into the bill discount BEFORE tax. Validated: LOYALTY_DISABLED / LOYALTY_REQUIRES_CUSTOMER / INSUFFICIENT_POINTS / POINTS_BELOW_MIN / POINTS_EXCEED_BILL. Re-checked under customer row-lock in CreateSaleAction to stop double-spend (stale race → whole sale rolls back).
- Reverse: CancelSaleAction wipes the sale's whole loyalty effect; ProcessSaleReturnAction claws back earned + refunds redeemed PROPORTIONAL to refundTotal/sale.total, capped per-sale via the reversible helpers (repeated partial returns can't over-reverse).
- Settings (ShopSettings + tabbed Settings "Loyalty" tab): loyalty_enabled, loyalty_earn_per_amount (Rs per point, default 100), loyalty_redeem_value (Rs per point, default 1), loyalty_min_redeem (default 100 in defaults, 0 in tests).
- POS: `GET /customers-lookup?phone=` (permission:sales.manage so cashiers can call it) → points+credit; PosPage fetches balance on phone entry, shows a redeem input (capped to min(balance, floor(billLeft/redeemValue))) that discounts the sale, + "earns ~N pts" estimate; sends redeem_points; resets on clearSale. CustomerController@show adds `loyalty_ledger`; CustomersPage shows a points card + statement.

**Also this turn — product search** (backend ce84e4e): ProductController@index search now also matches `description` + category name (`orWhereHas('category', name like)`), on top of name/brand/generic/SKU/barcode(+alternates)/variant-SKU. SUPPLIER search deferred — products have NO direct supplier link (suppliers relate only via purchase orders); would need a new relationship.

**Remaining "worth-building" doc gaps after this (HRM excluded):** Promotions engine (BOGO/happy-hour/scheduled flash — coupons+deals+flash-price primitives already exist), inclusive tax + tax groups (do before onboarding a GST-registered shop), SMS/email receipts (SMS gateway is a stub — wire a provider), customer groups. Plus in-flight: serial-on-receive, per-serial returns, multi-branch expense/register scoping. Deferred big rocks: offline PWA, mobile, online gateway. See [[shopos-retail-depth]], [[shopos-hardware]].
