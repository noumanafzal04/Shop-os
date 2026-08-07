# ShopOS Mobile — approach, flow and task list

Written 2026-08-07 against `backend@d9360eb`, `admin-panel@839153e`,
`mobile@0913477`. Companion to [MOBILE-REQUIREMENTS.md](MOBILE-REQUIREMENTS.md)
— that file is the reference spec and its §R the reconciliation; this file is
how we actually build it.

--- 

## 1. What this is, in five lines

Two React Native apps. **Business App** for everyone who works in the shop —
one binary whose entire shape comes from the logged-in user's tenant, modules,
role and permissions. **Customer App** for shopping across every kind of
business ShopOS supports, not just food.

Web keeps the power. Mobile gives speed. Tablet gives a light POS. Nothing on
mobile tries to become the web panel.

**V1 is online-first. No offline POS.** A sale is not a sale until the server
says so.

## 2. The six things that actually decide this build

Most of the spec is uncontroversial. These are the load-bearing choices.

**① The backend already answers the hardest question.** `/auth/me` returns, in
one call: `user.role`, `user.permissions`, `user.branch_id`, and
`tenant.business_type_primary`, `tenant.features` (the module map),
`tenant.item_types`, `tenant.limits`, `tenant.subscription_state`. That is
exactly the payload the module-aware architecture needs, and it exists today.
**No backend work is required to bootstrap either app.**

**② The app is shaped by modules, not by role names.** A tenant with only
`expenses` becomes a finance app. A restaurant with `pos + restaurant + online`
gets floors and a kitchen. The navigation tree is *computed*, never hard-coded,
and the same computation already exists in the panel (`capabilities.ts`) — we
port it rather than reinvent it.

**③ Cashier / waiter / kitchen are not roles.** `UserRole` has five cases and
none of them is "waiter". They are permission sets on a `staff` user. Every
gate reads `hasPermission(...)` / `hasModule(...)`. If a screen ever asks
"is this user a waiter", it is wrong.

**④ Rider is a build, not a screen.** No rider user, no login, no self-serve
API, no location, no earnings. It is the one part of this plan that is mostly
backend, and it must be sequenced accordingly.

**⑤ Theme must be tokens from line one.** Not because of the colour, but
because the colour is undecided. With `theme.colors.*` everywhere, green→orange
is one file. With hex literals in components, it is a two-week rewrite. This is
the single cheapest insurance in the plan.

**⑥ RTL is designed in, never retrofitted.** Urdu is a V1 language. Adding RTL
to a laid-out app means auditing every margin, icon and list in the codebase.
Starting with logical properties (`start`/`end`, never `left`/`right`) costs
nothing.

## 3. Repo shape

The existing app is **already mixed** — it carries business screens (dashboard,
catalog, inventory, sales, expenses) and customer screens (marketplace, cart,
checkout, tracking) in one binary. Splitting it is the first structural move.

```
shopos-mobile/                    (branch: mobile)
├── apps/
│   ├── business/                 own native project, bundle id, icon
│   └── customer/                 own native project, bundle id, icon
└── packages/
    └── shared/
        ├── api/                  client, interceptors, services
        ├── auth/                 session store, secure storage, refresh
        ├── theme/                tokens, light + dark
        ├── i18n/                 en, ur, RTL helpers
        ├── ui/                   the design system
        ├── hooks/                capabilities, network, keyboard, safe area
        └── types/                shared API types
```

Two apps share auth, API client, theme, i18n and the whole design system —
roughly 40% of the code. Two separate repos means maintaining two copies of all
of it, and they drift within a month. npm workspaces, one repo, two native
projects.

**Inside an app, keep `modules/`, not the spec's `features/`.** Same idea, and
matching the web panel is worth more than matching the document, because the
same people read both codebases.

**The existing project becomes the Customer App** — it is already majority
customer-shaped (14 customer screens vs 9 business), and it keeps its configured
native project. The Business App is new, and the 9 business screens move across
as reference rather than as a foundation.

## 4. Bootstrap flow — the thing everything hangs off

```
launch
  ↓
read tokens from Keychain ──── none ──→ Login
  ↓ found
GET /auth/me
  ↓
  ├── 401 → refresh ── fails ──→ Login
  ↓
hydrate session store
  user{role, permissions, branch_id}
  tenant{business_type_primary, features, limits, subscription_state}
  ↓
setup_completed = false ──→ Setup
subscription expired   ──→ Billing wall
  ↓
COMPUTE THE APP
  modules  = tenant.features
  trade    = tenant.business_type_primary
  can      = user.permissions
  ↓
build navigation from (modules × trade × permissions)
  ↓
Home
```

Module gating, in one rule used everywhere:

```
show(screen) = hasModule(screen.module)
             && hasPermission(screen.permission)
             && (screen.trades is empty || trade ∈ screen.trades)
```

Backend authorisation is still the authority. Hiding a tab is courtesy, never
security.

## 5. Build order, and why

| Phase | What | Why here |
|---|---|---|
| **0** | Foundation | Nothing can be built twice. Theme, i18n, design system, API, session. |
| **1** | Business App — daily loop | Dashboard, online orders, products. Valuable to every existing tenant on day one. |
| **2** | Expense Manager | A whole tenant class whose app is *only* this. Small, self-contained, high value. |
| **3** | Lightweight POS | The reason a tablet replaces a computer. Needs Phase 0's scanner/printer abstractions. |
| **4** | Restaurant + Kitchen | Needs one backend piece (waiter scoping). |
| **5** | Rider | Mostly backend. Sequenced last of the business work because it is the biggest server build. |
| **6** | Customer App | A customer app with no merchants is worthless; merchants come first. COD-first, gateway later. |

**Business App before Customer App.** The customer app is closer to done, but it
cannot function until merchants are accepting orders on their phones — and the
business app is worth money to every tenant that already exists.

---

## 6. Task list

Legend: **[M]** mobile · **[B]** backend · **[D]** decision

### Phase 0 — Foundation

- [D] 0.1 Theme: keep green+ink, or adopt `#FF8002`. *(Cheap either way if 0.5 is done first.)*
- [D] 0.2 Confirm monorepo split (§3) and which app is which native project
- [M] 0.3 Restructure to `apps/*` + `packages/shared`, npm workspaces
- [M] 0.4 Strict TS config, path aliases, lint + format
- [M] 0.5 **Theme tokens** — palette, spacing, radius, typography; `LightTheme`/`DarkTheme`; lint rule banning hex literals in components
- [M] 0.6 **i18n** — `en`/`ur` namespaces, `t()` everywhere, RTL helpers, logical `start`/`end` only
- [M] 0.7 Design system: Button, Input, Select, SearchBar, DatePicker, Card, Badge, Avatar, ListItem, Modal, BottomSheet, Toast, Tabs, FilterBar, StatusBadge, EmptyState, LoadingState, ErrorState, Skeleton, ConfirmDialog
- [M] 0.8 API client — base URL, auth header, refresh-on-401 with single-flight, error envelope → typed `ApiError`, never surface raw server text
- [M] 0.9 Secure token storage (Keychain, already a dependency)
- [M] 0.10 Session store (zustand) + bootstrap from `/auth/me` per §4
- [M] 0.11 **Capability layer** — `useModules`, `usePermissions`, `useBusinessType`, `useBranch`; port `capabilities.ts` from the panel
- [M] 0.12 Navigation shells, centralised SafeArea, keyboard-aware form primitives
- [M] 0.13 TanStack Query defaults — retry policy, stale times, offline banner via NetInfo
- [M] 0.14 Crash + API-failure logging (no tokens, no passwords, no customer data)
- [M] 0.15 `ScannerService` / `PrinterService` interfaces with no implementation yet — so Phase 3 has somewhere to plug in

### Phase 1 — Business App: the daily loop

- [M] 1.1 Login, logout, token refresh, session expiry, forgot password
- [M] 1.2 PIN unlock + biometric (backend till-PIN endpoints already exist)
- [M] 1.3 Branch selection (owners: all; staff: pinned via `branch_id`)
- [M] 1.4 Module-aware bottom nav `Home · Orders · POS · Finance · More`
- [M] 1.5 Dashboard — sales, orders, expenses, profit, pending online orders, low stock; every widget module-gated
- [M] 1.6 Quick actions: new sale, add expense, add product, orders, customers
- [M] 1.7 Notifications — register device (`POST /devices`), in-app list, mark read, deep-link to the subject
- [M] 1.8 **Online orders** — list, detail, accept/reject, status transitions, assign rider; status vocabulary per business type
- [M] 1.9 Products — list, search, add, edit, archive, image, price, sale price, stock, category, variants, online visibility, featured, active
- [M] 1.10 Customers — list, detail, khata balance
- [M] 1.11 Pull-to-refresh + loading/empty/error on every list
- [B] 1.12 Audit push coverage against §6 of the spec; add missing event types to `NotificationService`

### Phase 2 — Expense Manager

- [M] 2.1 Nav variant `Home · Expenses · Income · Reports · More` when only `expenses` is granted
- [M] 2.2 **Fast add expense** — amount → category → account → date → note → attachment → save. Target: a few seconds, keypad-first
- [M] 2.3 Expenses list, filters, edit, delete
- [M] 2.4 Income list + add
- [M] 2.5 Category management — create, edit, archive; per tenant, never hard-coded
- [M] 2.6 Receipt attachment via camera
- [M] 2.7 Reports — money in / money out / net

### Phase 3 — Lightweight POS

- [M] 3.1 POS shell, phone single-column flow
- [M] 3.2 Tablet two-panel layout (products | cart)
- [M] 3.3 Product search + quick keys (`GET /pos/quick-keys` exists)
- [M] 3.4 Camera barcode scan behind `ScannerService`
- [M] 3.5 Cart — add, quantity, remove, line discount where permitted
- [M] 3.6 Attach customer, optional
- [M] 3.7 Payment — cash/card/split; **totals come from the server, never computed on device**
- [M] 3.8 **Idempotency key per sale + submit disabled while in flight** (spec §19; non-negotiable)
- [M] 3.9 Receipt screen — only after server confirmation; share, print via `PrinterService`, new sale
- [M] 3.10 Recent sales + basic returns
- [M] 3.11 Shift open/close and drawer count (backend complete, incl. relief cover)

### Phase 4 — Restaurant + Kitchen

- [B] 4.1 **Waiter floor/table scoping** — which tables a waiter may see and open. Does not exist; `area` is a label and `waiter_id` records who serves
- [M] 4.2 Floor view, tables, occupancy
- [M] 4.3 Take order, modifiers/add-ons, send
- [M] 4.4 Fire to kitchen (KOT)
- [M] 4.5 Kitchen board — new / preparing / ready / completed, bump
- [M] 4.6 Settle + split bill

### Phase 5 — Rider *(backend first)*

- [B] 5.1 Link `Rider` to a `User`; decide whether that is a `staff` user with a rider permission set (recommended) or a new role
- [B] 5.2 Self-serve API — my assigned deliveries, delivery detail
- [B] 5.3 Rider-driven status transitions (picked up, delivered) with proof of delivery
- [B] 5.4 Location capture, consent-gated, active-delivery only
- [B] 5.5 Earnings summary
- [M] 5.6 Rider nav `Home · Deliveries · Earnings · Notifications · Profile`, and nothing else visible
- [M] 5.7 Delivery detail, pickup, navigate, confirm
- [M] 5.8 Location permission flow + background rules per platform

### Phase 6 — Customer App

- [M] 6.1 Onboarding, login/register, guest where supported
- [M] 6.2 Home — search, categories, featured, promotions, recently viewed, nearby
- [M] 6.3 Discover / search / business page / category browse
- [M] 6.4 Product detail, dynamic by trade — restaurant modifiers, retail variants, pharmacy prescription
- [M] 6.5 Cart, global from header
- [M] 6.6 Checkout — address, delivery/pickup, fee, discount, **COD**
- [M] 6.7 Order tracking + history
- [M] 6.8 Wishlist, profile, addresses
- [M] 6.9 Push — order status through to delivered
- [D] 6.10 Online prepay: a payment gateway build. Separate decision, not required to ship

### Continuous — every phase

- Test matrix from spec §18: auth, permissions, modules, language, theme, devices, network, POS
- Every new screen: light **and** dark, English **and** Urdu RTL
- POS screens: phone **and** tablet
- Contract check against the live API — mobile predates recent changes (`item_types`, `other_income`, `logo_url`, and the session endpoint now has a third answer)

---

## 7. Backend workstream, isolated

Everything mobile needs from the server that does not exist yet:

| ID | Work | Blocks | Size |
|---|---|---|---|
| B1 | Rider: user link, self-serve API, status transitions, location, earnings | Phase 5 entirely | Large |
| B2 | Waiter floor/table scoping | Phase 4 partially | Small |
| B3 | Push event coverage audit + missing types | Phase 1 polish | Small |
| B4 | Payment gateway | Online prepay only | Large, deferrable |

Nothing blocks Phases 0–3. That is the argument for the ordering in §5: the
first three phases are pure mobile against an API that is already complete.

## 8. Should mobile get its own endpoints? — decided: no

Asked 2026-08-07: *"should we build separate mobile endpoints? we don't need to
show all the data to customers or shop owners on mobile."*

The instinct about over-sending is correct. The conclusion — a `/mobile/*`
mirror — is not.

**The customer split already exists.** `/api/v1/marketplace/*` is public,
customer-facing and was built mobile-first: `GET /marketplace/home` is a
one-round-trip home screen, `/locate` exists so mobile needs no city picker.
That is the separate customer API. The Customer App lives there and extends it,
and never touches a tenant route.

**A mobile mirror of the business API buys zero security.** The same shop-owner
token authenticates both. If a slim mobile response were the protection, the
same user could call the web endpoint and get everything. Authorisation lives in
the tenant scope, module gate and permission check that already run on every
route. **Trimming a payload is a performance decision and never a safety one** —
believing otherwise is how a team ships a hole.

**And it duplicates the part we least want duplicated.** 361 routes today; a
mirror is ~150 more, each re-implementing tenant scoping and permission checks.
Two copies of that logic means one gets fixed and the other does not.

### What to do instead

1. **Shape responses, don't fork routes.** A slim variant on the few fat
   resources — `TenantResource` first, at ~30 fields with `limits_usage`
   loading related users. Same controller, same gate, same tests; only the
   serialisation differs.
2. **Add aggregates only where a screen genuinely needs 3+ calls** —
   `GET /dashboard/summary`, `GET /pos/bootstrap`. Additive, and they *compose*
   existing services rather than re-implementing them. `/marketplace/home` is
   this pattern already working.
3. **Existing responses become additive-only, permanently.** This is what
   actually protects mobile: an app sits on a phone for months, and a removed or
   renamed field breaks a version nobody can update. Add fields, never remove or
   rename. That discipline — not a namespace — keeps old builds alive.

Backend cost: ~4 small tasks (B5–B8 below) instead of a parallel API.

| ID | Work | Size |
|---|---|---|
| B5 | Slim `TenantResource` variant for the mobile bootstrap | Small |
| B6 | `GET /dashboard/summary` aggregate | Small |
| B7 | `GET /pos/bootstrap` aggregate (terminal + shift + quick keys) | Small |
| B8 | Write the additive-only contract rule into the backend README | Tiny |

## 9. What this plan deliberately does not do

- **No offline POS.** Spec §3. A queued sale that looks completed is worse than
  a refused one.
- **No mobile re-implementation of web features** — warehouse, purchasing,
  suppliers, tax config, bulk import, advanced reports, SaaS admin.
- **No role-name branching.** Permissions only.
- **No service/appointment booking**, consistent with the standing product
  decision.
