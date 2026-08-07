# ShopOS — Multi-Tenant SaaS Platform

A cloud business-management platform for local businesses (retail, grocery,
pharmacy, restaurant, salon, workshop, and more), with an optional customer
marketplace and mobile apps.

> **Setting up a machine, or picking this up cold?** Read
> **[HANDOVER.md](HANDOVER.md)** first — restore steps, current state, what's in
> flight, and the rules that must not be broken. The reasoning behind the build
> is in **[docs/decisions/](docs/decisions/)**.

## Repository layout — one branch per app

This repo keeps each application on its **own branch** (each branch's root is
that app's project root). The `main` branch is this overview only.

| Branch | App | Stack |
|---|---|---|
| [`backend`](../../tree/backend) | REST API (`/api/v1`), multi-tenant core, queues, scheduler | Laravel · PHP 8.4 · MySQL 8+ · Redis · Sanctum |
| [`admin-panel`](../../tree/admin-panel) | Web SPA — Super Admin console + Shop Owner/Staff panel (role-based) | Vite · React 19 · TS · React Router 7 · Tailwind v4 · TailAdmin |
| [`mobile`](../../tree/mobile) | Customer app (~55%); Shop Owner + Rider apps to follow | React Native CLI · TS |

```bash
# Clone a specific app's branch
git clone -b backend      https://github.com/noumanafzal04/Shop-os.git shopos-backend
git clone -b admin-panel  https://github.com/noumanafzal04/Shop-os.git shopos-admin-and-user-panel
git clone -b mobile       https://github.com/noumanafzal04/Shop-os.git shopos-mobile
```

## Locked architectural decisions

- **Multi-tenancy:** single database, `tenant_id` on every business table, auto-scoped via a global Eloquent scope + resolving middleware. No cross-tenant leakage.
- **Auth:** Laravel Sanctum (token-based), OTP + refresh + session management layered on top.
- **API:** RESTful, versioned under `/api/v1`, JSON, consistent error envelope, pagination/filter/sort everywhere.
- **DB standards:** UUID PKs, soft deletes, FKs, timestamps, `created_by`/`updated_by`, indexes on hot columns, tenant isolation on every business table.
- **Pricing:** server-authoritative everywhere (the client never dictates unit price or tax).
- **Roles:** Super Admin · Admin Staff · Shop Owner · Staff · Customer.

## Plans / modules (core business rule)

A tenant runs in one of two modes, **assigned by the Super Admin** (not self-selected):

| Plan | What's included |
|---|---|
| **Expense Manager** (core, always on) | Products, Inventory, Sales, Invoices, Expenses, Reports, Dashboard — internal management only. Not visible in the marketplace. |
| **Expense Manager + Online Shop** (add-on) | All of the above **plus** marketplace listing, online orders, reservations, delivery, reviews, and the customer storefront. |

Implemented as an `online_shop_enabled` flag + a per-tenant `features` module map,
writable **only by Super Admin**.

## Business-type awareness (core architecture)

ShopOS is **never hardcoded to retail**. Each tenant's business type (assigned by
admin) drives, from one codebase: the feature/module matrix (`tenants.features`),
default product & expense categories, the item-type capability set
(physical / food / medicine / service / deal), and marketplace behavior.
Types: retail, grocery, pharmacy, clinic, salon, workshop, service, wholesale,
books, hardware, restaurant.

Registry: `app/Support/BusinessTypes.php` (on the `backend` branch) ·
Catalog endpoint: `GET /api/v1/business-types`.

## Highlights shipped

- Catalog (variants, packs/units, combos/deals, menu modifiers & add-ons, batches/FEFO + expiry).
- Inventory — single audited stock write-path (row-locked, negative + expiry guards, FEFO, idempotency).
- POS + Sales — server-authoritative pricing, multi-tender + split, returns/exchange, held tickets, invoice print.
- Pharmacy — prescription capture, variant-medicine FEFO/expiry.
- Sell-on-credit (khata) — customer ledger + repayments.
- Online orders + delivery/riders, reservations, coupons, suppliers + purchases + payables.
- **Restaurant dine-in** — floor tables, running tabs, kitchen tickets (KOT), settle + split-bill.
- Shifts + drawers — X/Z-reads, denomination counts, blind close, business day + banking.
- Serialized selling (IMEI/serial) with warranty lookup **and claim intake**; vehicles + trade-in as a tender.
- Fuel / forecourt, loyalty points, promotions, tax groups, customer groups, multi-branch.
- **1258 backend tests · 102 panel tests green.**

## Running each app (once configured)

```bash
# Backend (branch: backend)
composer install && php artisan migrate --seed && php artisan serve

# Web panel (branch: admin-panel)
npm install && npm run dev
```

## Dev credentials (seeded)

All passwords are `password`. Super Admin `admin@shopos.test`;
tenant owners `tenant1@app.com` … `tenant9@app.com` (one per business type);
customers `user1@app.com` … `user10@app.com`.
