# ShopOS Mobile — product & technical requirements

> **Status: REFERENCE ONLY. The code is the authority.**
>
> Drafted with ChatGPT and handed over 2026-08-07 as a starting point. It
> describes a plausible mobile product in general terms; several of its
> assumptions are not true of ShopOS. Ruled 2026-08-07: **where this document
> and the codebase disagree, the codebase wins and the document is ignored.**
>
> Read §R before building anything from §1–19.

## How to read this document

Two kinds of mismatch live in here, and they need **opposite** treatment. Do
not confuse them.

**① The spec is wrong about us → IGNORE IT.** It describes something we already
do differently, and better. Changing our code to match would be damage.

| The spec says | We do | Ruling |
|---|---|---|
| Roles: owner, manager, cashier, waiter, kitchen, rider | `UserRole` has 5 cases; a shop has **2** (`shop_owner`, `staff`). Cashier/waiter/kitchen/rider are **permission sets** | **Ignore.** Permissions only. `if (role === "waiter")` compiles and is always false |
| Brand `#FF8002` orange | `#3BB77E` green + `#010F1C` ink, user-approved, shipped, and shared with the panel | **Ignored** — decided 2026-08-07 |
| `src/features/` | `src/modules/`, matching the web panel | **Ignore.** Same idea; matching the panel matters more |
| *(implied)* a mobile-specific API | `/marketplace/*` already exists and is mobile-first; the business API is shared | **Ignore.** See MOBILE-PLAN §8 |

**② The spec asks for something we genuinely lack → BUILD IT.** These are not
mismatches to wave away. They are real work, and skipping them means the
feature does not exist.

| Missing | Blocks | Size |
|---|---|---|
| Rider: user link, login, self-serve API, status transitions, location, earnings | The entire rider experience | Large |
| Waiter floor/table scoping | Restricting which tables a waiter may open | Small |
| Payment gateway | Online prepay only — COD ships without it | Large, deferrable |
| Per-event push coverage | Some notification types | Small |

Everything else in §1–19 — the two-app split, module-awareness, online-first,
lightweight POS, i18n/RTL, light+dark, the design system, POS safety rules — we
agree with and are building.

---

## 1. Two apps

**App 1 — ShopOS Business App.** One application for every operational user:
owner, admin/manager, cashier, staff, waiter, kitchen, rider. Role + permission
+ module aware. **Not** separate owner/staff/rider apps — one binary, and the
logged-in user's role and permissions decide what they see.

**App 2 — ShopOS Customer App.** Separate, customer-facing: discovery, browse,
search, cart, checkout, online payment, tracking, history, profile.

The Customer App must **not** be food-delivery-shaped. It has to serve grocery,
restaurant, retail, clothing, electronics, pharmacy, petroleum mart,
accessories — anything ShopOS supports. Business-specific behaviour is rendered
dynamically from business type and product configuration.

## 2. Stack

| Area | Decision |
|---|---|
| Framework | React Native CLI |
| Language | TypeScript, strict. No JS for business logic |
| Server state | TanStack Query — products, orders, customers, inventory, reports, rider data |
| Client/UI state | Zustand — auth/session, current user/tenant/branch, theme, language, cart, device |
| Tokens | Secure native storage (Keychain / Keystore) |
| Local persistence | Theme, language, preferences, read-cache |

Do not duplicate server data into Zustand.

## 3. Offline — final decision

**No offline-first mobile in V1.** Web remains the full POS/business system;
mobile is an **online-first operational companion**. No SQLite sync engine, no
conflict resolution, no offline transaction queue in the first release.

Offline behaviour in V1: show offline status, preserve safe local UI state, keep
the cart where sensible, cache recently read data, allow retry, show a clear
network error — and **never claim a financial transaction completed when the
server did not receive it.** POS money and stock stay server-authoritative.

Offline POS is a **future phase**, and if it comes it is scoped to tablet/mobile
POS specifically, not the whole platform:
`Mobile/Tablet → SQLite → offline queue → sync engine → API → MySQL`.

## 4. Division of responsibility

```
WEB          = business control centre
MOBILE       = daily operations companion
TABLET       = daily operations + lightweight POS
CUSTOMER APP = shopping & ordering
```

**Web keeps:** full setup, advanced POS, advanced inventory, warehouse,
purchasing, suppliers, advanced reports, tax config, employee management,
advanced permissions, branch management, hardware config, bulk import/export,
finance config, subscription and SaaS administration.

**Business App covers:** dashboard, sales, lightweight POS, orders, products,
quick inventory ops, customers, expenses, income, online orders, notifications,
restaurant, kitchen, rider, staff workflows, basic reports, settings.

## 5. Module-aware architecture

The app must not assume every tenant has every feature. The backend supplies
`businessType`, `enabledModules`, `permissions`, `tenantLimits`, `branch`,
`role`. A restaurant tenant with POS/EXPENSE/RESTAURANT/ONLINE shows those; an
`expense_manager` tenant with only EXPENSE becomes a finance app — no POS, no
inventory, no restaurant, no dead screens.

Use capability checks, not role checks. Avoid `if user.role === "owner"`
scattered through the tree. Prefer `hasPermission("orders.view")`,
`hasModule("pos")`. **Mobile UI hiding is not security** — the backend is the
authority on every protected operation.

## 6. Business App flows

**Login:** splash → auth → select tenant if needed → select branch if needed →
dashboard.

**Owner home:** today's sales, orders, expenses, profit summary, pending online
orders, low-stock alerts, notifications, quick actions (new sale, add expense,
add product, orders, customers, reports). Widgets depend on enabled modules.

**Navigation:** `Home · Orders · POS · Finance · More`. Products, inventory,
customers, suppliers, reports, staff, settings live under More. Do not put 15–20
items in the bottom bar.

**Online business** is one of the most important mobile cases — a merchant
running mostly online should not need the web daily. Mobile supports add/edit/
archive product, image, price, sale price, stock, category, variants, SKU,
online visibility, featured, active state.

**Online order flow:** new → notification → open → accept/reject → preparing →
ready → assign rider/pickup → dispatched → delivered. Status vocabulary differs
by type (restaurant: New/Accepted/Preparing/Ready/Out for delivery/Completed;
retail: New/Confirmed/Processing/Ready/Dispatched/Delivered).

**Business notifications:** new order, payment received, order cancelled, order
updated, rider assigned, rider pickup, delivery completed, customer issue, low
stock.

## 7. Mobile POS — yes, but lightweight

Mobile/tablet POS is **not** a duplicate of web POS. It targets small shops,
cafés, home businesses, pop-ups, market stalls, small counters — anyone who
doesn't want a computer.

**Flow:** POS → search/scan → product list → add to cart → quantity → discount
if permitted → optional customer → payment → confirm → receipt. The server
validates final pricing, tax, discount and stock.

**Tablet layout:** two panels — products left, cart right, with subtotal/tax/
discount/total and a PAY button. Phones use a single-column flow.

**V1 features:** product search, camera barcode scan, cart, quantity, remove,
customer selection, discount where permitted, tax display, payment, sale
confirmation, receipt, recent sales, basic returns, basic history. Advanced POS
stays on web.

**Receipt:** only after server confirmation — sale completed → invoice number →
receipt screen → share / print / save / new sale. Never show "Payment
successful" as final before the server confirms.

## 8. Restaurant, kitchen, rider

**Waiter:** login → tables → floor → select table → take order → add items →
modifiers → send → kitchen → status. A waiter should only see the floors and
tables they are permitted to access.

**Kitchen:** New / Preparing / Ready / Completed, with accept → preparing →
ready. No financial or admin screens unless explicitly permitted.

**Rider** (inside the Business App): home → available/assigned deliveries →
detail → pickup → navigate → customer → delivery confirmation → completed.
Navigation: Home · Deliveries · Earnings · Notifications · Profile. A rider must
not see POS, inventory, expenses, business reports or admin settings unless
granted.

**Rider location:** permission request, current location, route/navigation,
status, updates while on an active delivery. Background location only when
necessary, following platform permission and battery rules. Do not track riders
who are not actively working without a clear requirement and consent.

## 9. Expense Manager on mobile

First-class. A tenant who buys only Expense Manager must still get a useful app.
Navigation: `Home · Expenses · Income · Reports · More`.

**Add expense** is the most important action and must be fast — amount →
category → payment account → date → description → attachment → save. Target: a
few seconds.

Categories are **per tenant**, never hard-coded to one business type. Defaults
may be seeded, but tenants can create, edit, archive, and add their own income
and expense categories (and subcategories where supported).

## 10. Customer App

**Flow:** splash → onboarding → login/register/guest → home → discover/search →
business → category → product → cart → checkout → payment → tracking → history.

**Navigation:** `Home · Discover · Orders · Wishlist · Profile`. Cart is global
(header or FAB), not a permanent tab.

**Home sections:** search, categories, featured businesses, featured products,
promotions, recently viewed, recommended, nearby (with location), popular.
Content configurable.

**Product:** images, name, price, variants, options/modifiers, quantity, add to
cart — dynamic by type (restaurant: size/add-ons/modifiers; retail: size/colour/
variant; pharmacy: prescription requirement).

**Checkout:** cart → address → delivery/pickup → fee → discount → payment →
confirmation. Status: placed → confirmed → processing → ready → dispatched →
delivered, customisable per business type.

**Customer notifications:** confirmed, preparing, ready, rider assigned, out for
delivery, delivered, cancelled, promotional where enabled.

## 11. Design

**Brand primary `#FF8002`.**

```
Primary        #FF8002      Primary Dark   #E66F00
Background     #F8F9FB      Surface        #FFFFFF
Text primary   #1F2937      Secondary      #6B7280     Muted  #9CA3AF
Border         #E5E7EB
Success #22C55E   Warning #F59E0B   Error #EF4444   Info #3B82F6
```

Use orange **carefully** — primary CTA, active navigation, important actions,
brand highlights. Not every card, icon and button.

**Style:** modern SaaS, clean, minimal, professional, flat, no heavy shadows,
thin borders, white/surface cards, 12–16px radius, generous spacing, clear
hierarchy, simple icons, subtle motion. Avoid excessive gradients, huge shadows,
overly colourful dashboards, glassmorphism, decorative animation that slows the
workflow. It should feel like a business tool, not a social app.

**Light + dark from the start.** Centralised `LightTheme` / `DarkTheme`; never
hard-code a colour in a component — use `theme.colors.*`.

**Typography:** Inter (English), Noto Sans Arabic (Urdu/Arabic). Scale: Display,
H1, H2, H3, Body Large, Body, Body Small, Label, Caption. Few weights, prize
readability.

## 12. Language & RTL

V1 ships **English + Urdu**. Every visible string comes from translation files —
`t("orders.title")`, never a hard-coded literal. Structure: `i18n/en/common.json`,
`i18n/ur/common.json`.

Urdu needs **full RTL**: layout, text alignment, forms, lists, navigation,
mirrored directional icons, readable numbers/currency, and correct handling of
mixed English/Urdu text. Do not ship Urdu as translated strings inside an LTR
layout.

## 13. Platform behaviour

**Keyboard:** reusable form components handling keyboard avoidance, scroll to
focused input, next field, submit, and the right keyboard type (numeric,
decimal, phone, email, password). The keyboard must never cover the active field
or the primary submit button.

**Safe areas:** notch, Dynamic Island, Android status and navigation bars, small
phones, large phones, tablets — handled centrally, never by ad-hoc top padding.

**Responsive:** small/normal/large Android, iPhone, Pro/Pro Max, tablets. POS
adapts for tablets. No fixed heights or hard-coded screen dimensions.

## 14. Design system

`Button · Input · Select · SearchBar · DatePicker · Card · Badge · Avatar ·
ListItem · Modal · BottomSheet · Toast · Snackbar · Tabs · FilterBar ·
StatusBadge · EmptyState · LoadingState · ErrorState · Skeleton · ConfirmDialog`

Screens use the design system rather than inventing styles. Every data screen
handles **loading / success / empty / error**, with a retry affordance and no
raw backend errors surfaced. Pull-to-refresh on orders, products, customers,
notifications, dashboard, rider deliveries and finance lists.

## 15. Auth & security

Login, registration where applicable, logout, token refresh, session expiry,
forgot password, secure token storage, device/session management. Business users
may add PIN and biometric unlock.

The backend validates tenant, user, role, permission, module and branch on every
protected operation. Mobile only *displays* what is permitted.

## 16. Code architecture

Centralised API layer (`services/api/{client,auth,products,orders,customers,
finance,inventory,rider}.ts`) consumed by TanStack Query hooks. No ad-hoc API
calls from components.

Shared hooks: `useAuth · useCurrentUser · useTenant · useBranch · usePermissions
· useModules · useTheme · useLanguage · useNetworkStatus · useDebounce ·
useKeyboard · useSafeArea · useNotifications · useLocation`. Feature-specific
hooks stay in their feature folder.

Feature-based structure:

```
src/
├── app/          navigation · providers · config
├── features/     auth · dashboard · pos · products · inventory · orders ·
│                 customers · finance · restaurant · kitchen · rider ·
│                 notifications · settings
├── components/   ui · forms · cards · lists · feedback
├── services/     api · auth · notifications · location · scanner · printer
├── store/  hooks/  theme/  i18n/{en,ur}/  utils/  types/  constants/
```

**Hardware behind service interfaces** — `ScannerService` and `PrinterService`
with swappable providers, so camera scanner, external scanner, receipt printer,
label printer and Bluetooth devices can change vendor without touching the UI.

## 17. Monitoring

Centralised logging and crash reporting: app crash, API failure, network
failure, auth failure, slow API, payment failure, sync/retry issues. Never log
passwords, tokens, payment details, or customer data beyond need.

## 18. Test matrix

- **Auth:** login, logout, expired token, invalid credentials, session restore
- **Permissions:** owner, manager, cashier, waiter, kitchen, rider
- **Modules:** POS on/off, online, expense, restaurant
- **Language:** English, Urdu, RTL · **Theme:** light, dark
- **Devices:** small Android, large Android, iPhone, tablet
- **Network:** online, connection lost during load, lost during mutation, slow,
  timeout, retry
- **POS:** add/remove item, quantity, discount, payment, invoice, failed
  request, duplicate tap

## 19. POS safety rules

Because POS moves real money and stock: prevent duplicate payment taps; disable
submit while processing; server-authoritative totals; **idempotency keys on
mutations**; never trust mobile-calculated totals or mobile permissions; never
mark a transaction successful without server confirmation; handle timeout and
retry safely; clearly distinguish pending from completed.

---

# §R — Reconciliation with what ShopOS actually has

Checked against `backend@d9360eb` on 2026-08-07. The spec is a general mobile
product description; these are the places it assumes something we do not have,
or names something differently. **This section is the authority, not §1–19.**

## R1. Roles — the spec's role list is not ours

The spec lists owner, manager, cashier, staff, waiter, kitchen, rider as if they
were roles. `App\Enums\UserRole` has exactly five: `super_admin`, `admin_staff`,
`shop_owner`, `staff`, `customer`.

"Cashier", "waiter" and "kitchen" are **not roles here — they are permission
sets on a `staff` user**, which is the better design and already works. The app
must branch on permissions (`sales.manage`, `orders.manage`, …) exactly as §5
says, and must never look for a role named "waiter".

## R2. Rider — no backend exists

The single largest gap. The `Rider` model's own docblock says it:

> *"A shop's own delivery rider (Model A). Tenant-scoped; assigned to delivery
> orders. **No rider app / GPS — the shop drives the order status by hand.**"*

A rider today is a name and phone number owned by the tenant, managed via CRUD
by someone holding `orders.manage`. There is **no rider user, no rider role, no
rider login, no "my deliveries", no pickup/deliver actions, no location, no
earnings.** Everything in §8's rider flow and §10's rider navigation has to be
built server-side first.

Scope of that build, roughly: link a rider to a `User`; a self-serve API for
assigned deliveries; status transitions the rider (not the shop) drives;
location capture with consent; an earnings view.

## R3. Waiter floor/table scoping — does not exist

§8 says a waiter should see only permitted floors and tables. `dining_tables`
has an `area` column, and `restaurant_tickets.waiter_id` records **who is
serving** — but nothing restricts which tables a waiter may *see or open*. This
is new backend work, not a mobile filter.

## R4. Online payments — no gateway anywhere

§10 lists online payment at checkout. ShopOS has **no payment gateway
integration at all**; every money path is manual/recorded (POS tenders, admin
billing, COD). A COD-first customer app is shippable today; online prepay is a
gateway build on an existing stub.

## R5. Push — mostly there

Better than the spec assumes. `DeviceToken` + `POST /devices` registration,
`FcmSender`, `SendChannelNotification` queued job, and `NotificationService`
already wired into `OrderService`, `InventoryService` and `ReservationService`,
plus admin announcements. New order, low stock and reservation pushes exist. The
remaining per-event types in §6 need adding case by case, not from scratch.

## R6. Theme — this is a change, not a starting point

The spec's `#FF8002` orange **replaces** the green+ink flat theme the existing
mobile app is already built in. Adopting it is a deliberate rebrand of work that
exists, and it should be a conscious decision rather than a side effect of
following this document. Whichever wins, the panel and the mobile app should
agree.

## R7. Structure — existing app is `modules/`, spec says `features/`

The current app uses `src/modules/<name>/{screens,hooks,services}`, matching the
web panel. The spec proposes `src/features/`. These are the same idea under
different names; **matching the panel is worth more than matching this
document**, because the two codebases are read by the same people.

## R8. What the existing app already has

`shopos-mobile@0913477` — React Native CLI 0.86, React 19, TS, TanStack Query,
Zustand, Keychain, React Navigation, NetInfo, geolocation, lucide icons. So the
whole §2 stack decision is **already true today**.

Screens built: auth (sign in/up), dashboard home, catalog (products, product
form), inventory (adjust stock), sales (sales list, new sale), expenses (list,
add), orders (cart, checkout, tracking, list), marketplace (customer home,
market, shop, search, favorites, location, reservations), account (account,
addresses, notifications), shop setup.

Note this is **already a mixed app** — it contains both business screens
(dashboard, catalog, inventory, sales, expenses) and customer screens
(marketplace, cart, checkout). Splitting it into the two apps of §1 is the first
structural decision to make.

## R9. Contracts that moved under it

The mobile app predates recent backend changes. At minimum `item_types`,
`other_income` and `logo_url` changed shape, and relief cover added a third
possible answer to the session endpoint. Anything mobile does against POS
shifts, dashboards or catalog item types needs re-checking against current
responses.
