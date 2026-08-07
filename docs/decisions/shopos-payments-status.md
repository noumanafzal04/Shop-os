---
name: shopos-payments-status
description: Payment status RESOLVED — NO gateway anywhere; deliberate manual/recorded model across POS/subscription/online. COD-first launch = no blocker; online prepayment = needs 1 gateway build
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-29T09:56:27.833Z
---

Verified 2026-07-29 (grep across both repos, no SDK in composer.json/package.json). The "payment gateway = unknown launch dependency" I kept flagging is RESOLVED: there is NO gateway integration anywhere (no Stripe/Cashier, no JazzCash/Easypaisa/PayFast, no webhook/charge/payment-intent). Payments are a deliberate manual/recorded model on all three surfaces.

**1. In-person POS tenders** — `PaymentMethod` enum: cash · card · bank_transfer · other · credit(khata) · split. Labels the cashier picks; money taken in person (merchant's own card terminal). `sale_payments` holds the split. COMPLETE — a POS needs no gateway.

**2. SaaS subscription billing** (platform→tenant) — `SubscriptionPayment` rows are ADMIN-RECORDED (Admin BillingController reads; AssignPlanAction writes; method/reference free text). No card-on-file, no auto-renew. Fine for hands-on/invoice model; no self-serve recurring.

**3. Marketplace online checkout** (customer→shop) — CustomerOrderController@store accepts `payment_method ∈ {cod,paid}`; OrderService ALWAYS creates order `payment_status:'unpaid'`. `'paid'` is a FLAG ONLY — nothing collects money online; on completion maps `'paid'→card` tender on the Sale. Effectively COD-only.

**Launch verdict:** POS not a blocker. Subscription not a blocker (manual works at low tenant count). Online PREPAYMENT only matters if in scope — for a PK COD-first launch (the norm) NOT a blocker. The `payment_status` field + `'paid'` path are already stubbed as the seam: adding one provider = hosted-checkout redirect + webhook to flip `payment_status` + reconcile to Sale. Additive, ~1 focused build, not a refactor. So the ~80% web-SaaS-ex-offline estimate holds and is now confident, ASSUMING COD-first. See [[shopos-plans-and-flow]] (billing = manual limit-based plans by design).
