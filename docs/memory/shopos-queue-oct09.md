---
name: shopos-queue-oct09
description: USER'S ORDER OF WORK given 2026-10-09 — product form tidy → demo seeder/shops/super admin → ADMIN SIDE A–Z test + UI/UX polish for a CEO presentation (known bug: customers created on the admin side do not show) → Finance → the rest of the saved points
metadata:
  type: project
---

**2026-10-09, the user's own words (Roman Urdu), in this order:**

1. **Product form UI** — go-ahead GIVEN ("Continue" on the row that said it was
   waiting). See [[shopos-product-and-labels-ui]].
2. **Demo seeder** + shareable demo shops + second super admin — see
   [[shopos-demo-shops-and-admin]].
3. **Admin side, A to Z**: "hr cheez proper chal rhi" — test EVERY admin page
   through the UI (Playwright), and where something is wrong, find it in the
   code. Known report to start from: **"admin side py customer create ho rhy
   lkn show ni hoty"** — customers get created but do not appear in the list.
4. **Admin side UI + UX, every page**: "mjhe ye CEO ko present krna hai… Admin
   side attractive honi chahye". This is a presentation to the CEO — it has to
   LOOK good, not only work. The user likes colourful-but-flat
   ([[shopos-ui-direction-oct06]]); check 1366×768.
5. Then **Finance** (the journey stage held back earlier), and "jo memory main
   save kiye hain wo points": [[shopos-do-vps-audit]], the packaging gap in
   [[shopos-packaging-units]].

**Added the same day, mid-work — what the ADMIN side must do (user's words):**

- **Tenant create / edit: modules restricted by business type.** "jo modules
  hain hr business type k lehaz sy restrict hony chahye" — show only the modules
  that trade can use; the rest are not offered at all.
- **A plan brings its own modules.** "jb plan select ho basic to basic level k
  modules create hon jo aam shop ki need ho" — choosing Basic switches on what an
  ordinary small shop needs ("bs product add kiye, label bnaye, POS ki").
  Everything beyond that is shown SEPARATELY as **Add-ons** ("Addons main extra
  modules ayen"), still limited to what that trade can use.
- The user ASKED: "plan k andr modules set kr skty? ya separate khud manual
  assign kryn?" — wants a recommendation AND it built. (Before this, plans were
  payment-only: [[shopos-plans-and-flow]].)
- "mjhe achy sy UI / user experience chahye… mjhe admin side achi chahye".
- **Admin theme: PRIMARY sidebar + colour theme by default, and the admin can
  change it themselves** ("admin side ko primary rkho… or khud b change kr
  sky"). See [[shopos-sidebar-default-primary]].

- **A demo shop from the landing page: the admin must be able to make it a
  real shop DIRECTLY.** User: "jo demo shop create hoti landing page py wo
  approve kaise hoti, jb tk tenant apni info ni add kr deta Keep-this-shop
  main… admin direct b kr skta hai, wo kahin nzr ni aya admin side py". Today
  approval only exists as an answer to the tenant's own "Keep this shop"
  request ([[shopos-the-front-door]]); the admin side needs a visible way to
  see demo shops and convert one without waiting for that request.

- **Plans dialog**: "Plans ka modal thora better kro or modules checkboxes" —
  DONE the same hour (three tabs; modules as grouped checkboxes).
- **Commission screen UI**, and **filters everywhere**: "isk bad Commission
  screen UI b… filters ko b dekha kro kaise better kr skty".
- **Dashboards take a date range — ADMIN AND TENANT**: "Dashboard screen main
  date ka input use krna: today, yesterday, last week, month, last month,
  quarterly, jo b achy option bny, ya custom range… already humne aisa filter
  bnaya huwa hai kahin (the shared `DateRangeFilter`)… UI acha hona chahye,
  achi jgah handle hona chahye, bura na lgy. Default today/current or current
  week."
- **Add-ons and billing (answered + being built)**: a shop that takes an add-on
  STAYS on its plan; no custom plan is made, by hand or automatically; the
  add-on's monthly price is on the shop's bill for as long as it is on.

**STATE 2026-10-10 morning (all pushed — the whole ADMIN list is done):**

| # | Item | State |
|---|---|---|
| 1 | Product form | DONE — panel `ac16e99` |
| 2 | Demo seeder + shops + super admin | DONE — `demo:shops`, on plans with payments, last step of db:seed |
| 3a | Admin: customers "created but not shown" | DONE — list, card, remove; `7b348b7` / `bfdaae3` |
| 3b | Admin: modules by trade + plan packages + add-ons billing + plans dialog | DONE — `237c410` / `4773628`; [[shopos-plan-packages]] |
| 3c | Admin: tenant edit screen | DONE with 3h — four answer tiles + a sticky way down the page (not tabs) |
| 3d | Admin: convert a DEMO shop to real directly | DONE — `65e3a1c` / `b265416`; [[shopos-admin-keeps-a-demo]] |
| 3e | Admin: Commission screen UI + filters everywhere | DONE — `f8ebc16` / `5dbff03`; [[shopos-who-owes-the-platform]] (filters elsewhere already on the kit) |
| 3f | Dashboards date range (admin AND tenant), default today/this week | DONE — `636cc53` / `5daf1e1`; [[shopos-dashboard-period]] |
| 3g | Admin appearance: primary default + changeable by the admin | DONE — `db0b0bb` / `0512221`; [[shopos-console-appearance]] |
| 3h | Admin A–Z walk + polish with `admin/components/kit.tsx` on every page | DONE — `2d603af` / `f0c8fcb`; [[shopos-console-a-to-z]] |
| 4a | Finance journey stage | DONE — `704d276` / `b1f2a87` / `0c37753`; [[shopos-books-only-business]] |
| 4b | Packaging gap (several barcodes per pack, a label per pack) | DONE — `307244a` / `ed36513` / `96ed217`; ONE migration; [[shopos-packaging-units]] |
| 5 | DO audit | NEEDS THE SERVER — cannot be done without the user |

**PUSH AS YOU GO (user, 2026-10-09):** "admin ka hr module complete k bad push
krna sath sath — session issue ajata, limit reach ho jati, ta k jitna huwa wo to
deploy ho". During the admin work, commit AND push each module as soon as it is
finished and its gates are green — do not hold a big batch. (My reading: this
covers the admin effort; outside it, push when asked as before.)

**2026-10-09 night — the user, twice:** "pehle ye [dashboard date range], then
baki" and then "i am going to travel so keep ur work and dont stop the work
until i say u — complete everything till am not giving u instruction to stop".
So after 3f the order is 3d → 3e → 3g → 3h → 4, each pushed when green, with no
check-ins. (My reading: "everything" = this queue. Live stays untouched; the DO
audit needs the server and cannot be done from here without the user.)

**How to apply:** work down the list without asking between items; nothing on
live — the user deploys.

**2026-10-10 night:** the four known items + add-on reach + price-list save PUSHED (`3b6db40` / `7ebc89c` / `41199aa`; [[shopos-where-a-price-is-charged]]). The user then asked "Billing and payment screen main date picker hona chahye?" — answered yes and BUILT + PUSHED it (`a67699e` / `99f8818` / `b7efd3e`; [[shopos-billing-period]]).

**2026-10-10 afternoon: the whole queue is done except the DO audit** (needs
the user's server). After it I went on to the four "known, not fixed" items
from the admin walk (payment buckets, renewal prefill, admin date filters in
UTC, 320px header) — my choice, under "complete everything"; not asked for by
name.
