---
name: shopos-e2e-owner-shop-lapsed
description: DEV DB — all nine e2e "Sweep …" shops are active to 2026-11-10 (extended with no payment row); they lapse again then; how to extend
metadata:
  type: project
---

**State 2026-10-11 ~05:30:** ALL NINE Sweep shops (Mart, Food Restaurant, Food, Petroleum, Pharmacy, Automotive, Retail, Services, Finance) are active to **2026-11-10**: `POST /admin/tenants/{id}/assign-plan {plan_id, period:{starts_at,ends_at}, payment:{amount:0}}` as the e2e admin (`scratchpad/adm.sh`; re-mint with `--project=admin-setup`). Platform revenue checked unchanged (this_month 255,984 / all_time 504,984). Told the user about Mart + Food; the other seven were extended for the 6-trade QA — TELL THEM in the final list. They lapse again 2026-11-10 + grace.

(earlier) **State 2026-10-10 ~23:00:** *Sweep Mart* and *Sweep Food Restaurant* are writable again — extended to 2026-11-10 through the admin API `assign-plan` with `payment: {amount: 0}`, which records NO payment row (ledger checked unchanged: 73 payments / 504,984). Petroleum, Pharmacy, Automotive, Retail, Services and Finance are STILL lapsed: their write specs get 403. Extend them the same way only when a write spec for that trade must run, and tell the user. They lapse again on 2026-11-10 + grace.

**Found 2026-10-10 evening:** `shelf.setup.ts` failed "only 0 of 27 plain products could be stocked". The trace: 30 × `POST /inventory/adjust` → 403. `GET /auth/me` as the e2e owner: shop **Sweep Mart**, `subscription_ends_at` 2026-10-03, `payment_status: unpaid`, `subscription_expired: true`. Reads still work ("Your data is safe — renew to continue making changes").

**ALL EIGHT "Sweep …" e2e shops lapsed the same day** (Mart, Food Restaurant, Petroleum, Pharmacy, Automotive, Retail, Services, Finance — all `subscription_ends_at` 2026-10-03). Checked by `/auth/me` with each `e2e/.auth/*.json`.

**Effect:** the `desktop` / `phone` / tablet projects depend on `shelf` setup, so they fail before any test runs. Read-only specs run with `--no-deps` (the stored owner session is refreshed by `setup`, which passes). Specs that write (till, sales, stock, journey shop stages on that owner) cannot run.

**Not fixed, on purpose:** renewing = recording a subscription payment for Sweep Mart through the admin API/UI, which puts a payment on the Billing screen the user was reading that evening ([[shopos-somebody-is-working]]). TOLD THE USER; waiting for them to renew it (Tenants → Sweep Mart → Renew) or to say I may.

**How to apply:** before a shop-side e2e run, check `/auth/me` → `tenant.subscription_expired`. If true, do not read a wall of failures as regressions.

**2026-10-11:** Sweep Mart extended to 2026-11-10 by me — `POST /admin/tenants/{id}/assign-plan {plan_id: <same>, payment: {amount: 0}}`. Amount 0 = NO payment row (AssignPlanAction only records when amount > 0; omitting `payment` records the plan price!). Ledger totals verified unchanged. That is the way to revive a lapsed fixture shop without touching revenue.

