---
name: shopos-three-months-of-paying
description: 2026-10-11 (NOT PUSHED) — billing walked over a quarter (server clock + real UI journey stage R); 6 real bugs fixed (blank amount booked as plan price, 3 plan fields never saved, grace days given free, 31st overflow, owner not shown add-ons); AssignPlanAction::window() is the one rule
metadata:
  type: project
---

**The user asked (2026-10-11, before sleeping ~3h):** "test everything with real data on UI and also on backend side — create plans, create tenant, uska plan 2,3 month chalao, update kro, check kro process sahi chal raha, or pricing — or sath business type jo abhi banai or baki b flow wise".

**How "months" were run without touching the DB:** server = `AShopPaysForThreeMonthsTest` with `travelTo`; UI = journey stage R (`JOURNEY_TRADE=billing … e2e/journey/29-three-months-of-paying.spec.ts`, 19 cases) — the shop is CREATED IN THE PAST through the billing window the admin can already type, then brought forward one payment at a time.

**Found and fixed:**
1. `AssignPlanAction` wrote a payment of the plan's FULL PRICE when none was sent — while both admin forms say "leave the amount blank if nothing was taken / for a free assignment". Now: a ledger row only when an amount is given.
2. Plans form sent `max_offline_selling`, `max_offline_days`, `grace_orders_month`; request rules dropped them and `PlanResource` never returned them → "Selling offline: No" on every plan card. Live plans edited through the panel never saved their offline switch — TELL THE USER.
3. Renewing in GRACE started the period today → late days free, renewal date creeping. Now carries on from the old end (grace = full use); read-only (grace spent) and plan switches still start today.
4. `addMonths` overflow: 31 Jan → 3 Mar. Now `addMonthsNoOverflow` (also `subMonthNoOverflow` on the platform dashboard's "a month ago").
5. Renewal dialog now SAYS the dates before saving: `GET /admin/tenants/{t}/plan-window` → `admin/planWindowWords.ts`.
6. Owner's Subscription showed the plan price only; now `bill` + "You pay every month" (`shop/whatYouPay.ts`); payments are two-line rows on a phone (amount was off-screen).

**`AssignPlanAction::window()` is the ONE place a period is worked out** — the save and the dialog both call it.

**Open, for the user to decide (I did NOT change these):** no pro-rating on a plan switch (dialog now says what is given up); "Bills a month" on a quarterly/yearly plan is counted over the whole period (deliberate + tested in `TheShopsOwnMonthTest`, but reads 12× too strict on a yearly plan); a free period reads "Paid" on the admin list.

**My interpretation, not the user's words:** the grace rule change (3) — I judged it a revenue leak and changed the default; it is one line in `window()` if they disagree.

**Lessons:** a partial `modules` map on `POST /admin/tenants` MERGES over the trade's defaults (the form always sends every key) — a test that sends only the true keys gets nine extra add-ons. A page has no `<main>`; use `body`. The Billing page has TWO date controls with the same label — the ledger's is `.last()` and is the only one offering "All time".

Related: [[shopos-plans-and-flow]], [[shopos-plan-packages]], [[shopos-billing-period]], [[shopos-the-journey]], [[shopos-promise-in-another-file]], [[shopos-saved-nothing]]
