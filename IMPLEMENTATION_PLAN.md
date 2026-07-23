# ShopOS — Implementation Plan (Step by Step)

> **STATUS (current): Steps 0–16 COMPLETE across backend + web + mobile — 201 backend
> feature tests green.** Auth · Tenants · Staff+Permissions · Business Types · Shop
> Setup · Dashboards · Catalog (products+services) · Inventory · Sales+Invoices ·
> Expenses+Reports · Subscriptions · Marketplace+Customers · Reservations · Reviews ·
> Notifications · Hardening (audit logs, code-splitting, rate limits).
> Future-phase (not built): online cart/checkout & delivery tracking, restaurant
> tables/kitchen, appointment booking, staff scheduling, server-side PDF/WhatsApp,
> real push/SMS/email providers (queued stubs in place).


Rule: we build **vertically** — each step lands backend → web → mobile with its edge cases
handled *inside* the step, not deferred. A step is "done" only when its edge cases pass.

Pattern (backend): thin Controllers → FormRequests → Actions (transactional) → Models
(UUID, SoftDeletes, BelongsToTenant) → API Resources → consistent `ApiResponse` envelope.
Pattern (web/mobile): `modules/*/{hooks,services,store,components,pages}` + `common/` +
React Query (server state) + Zustand (client state).

---

## ✅ STEP 0 — Scaffolding (DONE)
Laravel 13 backend · TailAdmin React web (trimmed, builds) · RN 0.86 mobile.

## STEP 1 — Backend Foundation
- Sanctum install + token auth config; MySQL connection; `/api/v1` route group
- `ApiResponse` envelope `{success,message,data,errors,meta}`; global exception handler → JSON
- `BaseModel` (UUID PK, audit fields), `BelongsToTenant` trait (global scope + auto-fill)
- Migrations: `tenants`, `users` (role enum), `cities`, `otp_codes`, `plans` (online_shop flag)
- Seeders: Super Admin, cities, plans
- Rate limiting, CORS for web/mobile
- **Edge cases:** missing tenant context → 403; cross-tenant access impossible by scope;
  suspended/deleted tenant blocked at middleware level

## STEP 2 — Auth Module (backend)
Login (email/phone + password), OTP request/verify, refresh, logout, logout-all,
change/forgot password, session/device listing.
- **Edge cases:** invalid OTP, expired OTP, OTP resend throttle (max N per window),
  brute-force lockout, multi-device tokens, suspended account login → 403 with reason,
  deleted account login → generic 401 (no user enumeration), expired-subscription login
  (allowed, read-only flag returned), password-reset token single-use

## ✅ STEP 2 done — Auth (25 tests). ✅ STEP 3 done — Tenants/Plans + **Staff & Permissions**
(both sides: platform staff `admin_staff` w/ tenants.* permissions; tenant staff `staff`
w/ module permissions; anti-escalation; suspend revokes sessions; 65 tests total).

## STEP 3 — Tenant Management + Plans (Super Admin, backend)
Tenant CRUD, suspend/activate, soft delete, assign plan (Expense Manager ± Online Shop),
module flags on tenant.
- **Edge cases:** duplicate business name/phone/email → 422; delete with existing data →
  soft delete only; suspend with active sessions → tokens revoked; plan downgraded while
  online orders exist → marketplace hidden, data preserved

## ✅ STEPS 4–9 done (backend + web + mobile, 131 backend tests):
Web/mobile foundations · Shop setup + dashboards · **Business-type engine**
(registry, feature matrix, templates) · Catalog (categories + products/services,
variants, SKU) · Inventory (locked movements, idempotency, low stock) ·
Sales + Invoices (gap-free numbering, idempotent checkout, cancel w/ restore,
printable invoice, real dashboard revenue/profit).

## STEP 4 — Web Foundation
React Query + Zustand providers; axios API client (auth header, refresh, error envelope
parsing); role-based routing (SuperAdmin / ShopOwner areas); wire SignIn to real API;
protected routes; skeleton loader components; module folder structure.
- **Edge cases:** 401 → silent refresh → retry once → logout; network error toasts;
  double-submit guarded buttons; deep-link to protected route preserves redirect

## STEP 5 — Mobile Foundation
React Navigation; axios client + React Query + Zustand; secure token storage (Keychain/
Keystore); auth screens; baseline UX kit: SafeArea top+bottom, keyboard-aware scroll,
tap-guard (no double fire), skeleton components, offline banner.
- **Edge cases:** keyboard covering inputs; notch/home-indicator devices; token expiry
  mid-session; airplane-mode requests queued/errored gracefully

## STEP 6 — Shop Setup + Dashboard
Onboarding (name, category, city required; logo/address/hours optional); dashboard
widgets API (today sales, revenue, expenses, profit, pending orders/reservations,
low stock).
- **Edge cases:** skipped setup → forced redirect until complete; invalid city; empty
  dashboard states (no sales/products); timezone-correct "today"

## STEP 7 — Categories + Products
Nested categories; product CRUD, variants, images, SKU, price/cost, active/inactive.
- **Edge cases:** duplicate SKU (per tenant) → 422; duplicate variant combo; circular
  category parent; delete category with products → block or reassign; price < cost →
  warning; huge/invalid image → validate + resize; product referenced by active sale/
  reservation → soft delete only

## STEP 8 — Inventory
Stock in/out, manual adjustment with reason, movement history, low-stock alerts.
- **Edge cases:** concurrent updates → `lockForUpdate` row locking; negative stock
  blocked (configurable); adjustment idempotency; rollback on failed sale

## STEP 9 — Sales + Invoices
Sale workflow (walk-in/online/phone/WhatsApp) → items → totals → payment → invoice →
stock decrement → report rollup. Invoice PDF/print/WhatsApp share.
- **Edge cases:** out-of-stock at checkout (locked read); double-click submit →
  idempotency key; payment recorded twice → unique constraint; sale cancel/edit →
  stock restore + invoice void; invoice number sequence per tenant, gap-free;
  crash between payment and invoice → recovery job

## STEP 10 — Expenses + Reports
Expense CRUD + categories; daily/weekly/monthly/yearly reports (sales, expenses, profit).
- **Edge cases:** future date blocked; negative amount blocked; duplicate detection;
  reports across midnight/timezones; large ranges paginated/queued

## STEP 11 — Subscription Enforcement
Plan periods, grace period, read-only mode, renewal/upgrade/downgrade.
- **Edge cases:** expires mid-session → read-only not hard logout; webhook retry-safe
  (idempotent); module removed → data kept, endpoints 403

## STEP 12 — Marketplace + Customers (Online Shop tenants only)
City-level shop discovery, product search, filters; customer registration, favorites.
- **Edge cases:** Expense-Manager-only tenants never listed; closed/hidden shop;
  duplicate customer phone/email; deleted account re-registration

## STEP 13 — Reservations
Reserve → owner accept (stock locked) → arrive → sale → complete; expiry job.
- **Edge cases:** expiry while paying; accept after expiry blocked; last-item race →
  first lock wins; owner reject → stock released; no-show auto-release

## STEP 14 — Delivery + Maps
Delivery radius, charges, address validation, basic tracking states.
- **Edge cases:** outside radius; invalid coordinates; COD failure; cancel mid-delivery

## STEP 15 — Notifications
Push (FCM) + SMS + email via queued jobs with retry/backoff.
- **Edge cases:** provider outage → retry + fallback channel; duplicate suppression
  (idempotency key per event); bounce handling

## STEP 16 — Reviews + Hardening
Shop reviews/ratings/replies; audit logs; rate limits tuned; indexes reviewed;
feature tests green; performance pass (<500ms avg).
- **Edge cases:** duplicate review per order; spam/offensive filter hook; deleted shop
  reviews retained but hidden
