# Security pass — 2026-08-15

**The standing item from the 2026-08-11 admin backlog, and item 4 of
`docs/audit-2026-08-12/VERIFIED.md`.** Neither side had ever had one.

Backend and admin/tenant panel. `shopos-mobile` out of scope, as always.

---

## What was looked at, and how much of it

A count of findings means nothing without a count of attempts, so both are here.

| Surface | Denominator | Method |
|---|---|---|
| Route authorization | 379 `api/v1` routes, 215 of them mutating | `route:list --json`, parsed by resolved middleware class |
| Tenant isolation | 13 models outside the tenant global scope; 20 deliberate `withoutTenancy()` calls in the HTTP layer | read every one |
| Raw SQL | every `DB::raw` / `whereRaw` / `orderByRaw` / `selectRaw` / `havingRaw` in `app/`; 8 carry an interpolated variable | traced each variable to its source |
| Mass assignment | every model's `$guarded` / `$fillable`; the privileged columns on `users` | read |
| Privilege escalation | staff create + update, both scopes | read + tested |
| Auth surface | every limiter, the lockout, token abilities, refresh rotation | read + tested |
| Uploads | 4 upload request classes, 8 write sites | read |
| Panel XSS | every `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` in `src/` — one hit | read the generator behind it |

**One parser bug nearly became a false report.** The first authorization sweep
said *zero* routes were behind `auth:sanctum` and therefore that all 215 writes
were public. `route:list --json` returns resolved middleware CLASS names, not
the aliases the routes are written with. The denominator caught it: a surface
where nothing at all is authenticated is not a finding, it is a broken measuring
stick. Rerun against the real class names, the picture inverted completely.

---

## Fixed

### 1. Anyone could lock a shop out of its own till — P1

`EnsureUserCanAuthenticate` checked the failed-attempt lock BEFORE the password
was checked, and that guard is shared by both login paths. So five wrong
passwords against a known email took the shop off its own POS for fifteen
minutes — password **and** one-time code — from anywhere, with no credential at
all, repeatable for as long as somebody cared to. A locked counter at Friday
rush hour is the whole loss.

**The lock now refuses a wrong password and never a right one.** An attacker
still gets five guesses per account per fifteen minutes; the owner who types
their own password gets in. Nothing was traded for it — a lock cannot stop
somebody who already has the password, so refusing them only ever cost the
person the lock was meant to protect.

Two things fell out of moving it:

- **Every failure now reads the same.** A distinct `ACCOUNT_LOCKED` reply was a
  free oracle for whether an address is real: try five passwords and watch
  whether the answer changes. Only a proven credential earns a specific answer,
  which is why the suspended/deleted cases now live past the password check.
- **Knocking again while locked does not extend the window.** Otherwise the lock
  is not a ceiling on guesses but a punishment that compounds, and the DoS comes
  straight back at one attempt a minute.

An unknown identifier is also compared against a real bcrypt digest now, so it
costs the same wall-clock as a known one. The body said nothing; the timing did.

`AuthTest`, 8 tests. Mutation-checked, including putting the original bug back —
it kills 5 of them.

### 2. Changing somebody's password bypassed the escalation guard — P2

`CreateStaffAction` and `UpdateStaffAction` both refuse to grant a permission
the actor does not hold themselves. Complete about permissions, blind about
identity: a manager holding `staff.manage` but not, say, report access could not
tick that box — and did not need to. Set the cashier's password, sign in as the
cashier, read what the cashier could.

Email and phone are the same door. Login is by either, so moving a colleague's
address to one you control hands you their next one-time code.

**One sentence closes all three: you may only take over an account you could
have created.** That is exactly the test the escalation guard already applies to
a requested permission list, pointed at the target's existing permissions
instead. Owners are exempt, as everywhere else — they hold everything
implicitly, so there is nothing to acquire.

Not reachable through any shipped job preset: `staff.manage` deliberately stays
with the owner, and the Manager preset says so in a comment. It becomes
reachable the moment an owner ticks that box, which the screen offers — and a
guard whose protection ends where the configuration begins is not a guard.

`StaffManagementTest`, 7 tests, both directions. Mutation-checked ×4.

### 3. A barcode's own characters reached the markup — P3, not reachable today

`code128Svg` interpolated its input straight into the `<text>` element under the
bars. Code 128-B covers every printable ASCII character, `<` and `>` and `"`
included, so a barcode reading `</text><script>…` survives encoding intact — and
these SVG strings are rendered through `dangerouslySetInnerHTML`.

A barcode typed into a product form, or landed by a supplier's CSV import, would
have been script running inside the shop's own session on every label sheet
somebody printed. **It has no caller today**, which is the argument for escaping
it now rather than the day it gets one. Its sibling `code128BarsSvg` — the one
that IS rendered — never touches the input at all: only computed integers become
`<rect>`.

`code128.test.ts`, 8 tests.

### 4. `vehicle_id` was not scoped to the shop — P3, not an exposure

`StoreSaleRequest` scoped `product_id` to the tenant and did not scope
`vehicle_id` two lines below. **Not a leak, and it is worth being exact about
why:** every read of a vehicle's history goes through `Sale::query()`, which
carries the tenant global scope, so another shop's car could never surface
anyone else's work, and `CustomerVehicle::query()` is scoped too, so the
odometer write was already a no-op.

What it actually was: a sale could store a pointer that resolves to nothing for
ever — a blank where a car should be, debugged by somebody a year later. Fixed
because the rule two lines above already does it, and an inconsistency in a rule
set is how the next one gets written wrong.

---

## Looked at and found sound

Recorded so the next pass does not spend a second session on them.

| Area | Why it holds |
|---|---|
| **Route authorization** | 185 of 209 authenticated mutating routes carry `EnsurePermission`. The other 24 are all either `EnsureRole:super_admin` (plans), `EnsureRole:customer` (the storefront surface) or self-service auth. The 6 unauthenticated writes are 5 auth endpoints on `throttle:auth` / `throttle:otp` plus a banner click counter. |
| **The customer surface** | `CustomerOrderController`, `CustomerReservationController` and `ReviewController` all drop the tenant scope on purpose — a marketplace spans shops — and every one of them re-scopes by `customer_id` = the authenticated user, on index, show and cancel alike. |
| **Route-model binding** | No tenant route binds a model outside the tenant global scope. The unscoped models (`Banner`, `Plan`, `Tenant`, …) are bound only inside the `super_admin` group. |
| **Raw SQL** | The 8 interpolated sites are `dayExpression($column)` / `yearMonth($column)` — called only with literal column names — and `Geo::sqlDistanceKm`, whose parameters are typed `float` and cast again inside. No user string reaches a query. |
| **Privilege escalation** | Guarded on both create and update, both scopes. `role` is not in the rule set at all, so no staff member can promote themselves; `permissions.*` is `Rule::in()` against the scope's own list, so a tenant staff cannot reach a platform permission. |
| **Token handling** | Access and refresh are separate abilities. `/auth/refresh` is the one route without `abilities:access`, deliberately, and `RefreshTokenAction` checks `tokenCan('refresh')`, re-runs the account guards, and is single-use with rotation — a stolen refresh token dies the moment the real client rotates first. |
| **Uploads** | Every image upload validates `image` + `mimes:` + `max:`; receipts allow only `jpg,jpeg,png,webp,pdf` at 5 MB. All use `->store()`, so filenames are generated, never taken from `getClientOriginalName`. Paths interpolate server-side UUIDs only. |
| **Receipt privacy** | Already moved to the private disk with a tenant-scoped, permission-checked streaming endpoint, and legacy rows still read from `public` so nothing was orphaned. Someone had already done this thinking; it holds. |
| **Cost price** | Fenced out of the catalog projection, and now asserted on every trade through the sale endpoint by field VALUE rather than field name, so a cost leaked under a renamed key is caught too. |
| **Password hashes** | `$hidden` on `User` covers `password`, `remember_token` and `pin_hash`. |

---

## Known and accepted

**Tokens live in `localStorage`.** The panel persists its auth store there, so
any successful XSS is a session takeover rather than a nuisance. This is the
ordinary SPA trade-off and moving off it means httpOnly cookies plus CSRF
protection on every write — a real architectural change, not a patch. Recorded
here so the decision is a decision. It also raises the value of finding 3: the
XSS surface is small and should stay that way.

**`POST /marketplace/banners/{id}/click`** is an unauthenticated write on the
general limiter. It increments an ad's click counter, so it can be inflated. It
is analytics integrity, not access, and it stays until there is a paying
advertiser to care.

**The seeded super-admin password is still `password`** — item 1 of the verified
list, and the owner's chore. Nothing in this pass touches it, and it is a live
exposure for as long as the staging droplet answers.

---

## What this pass did not cover

- **Infrastructure.** TLS, headers, CORS in production, the droplet itself. The
  droplet has no domain and no certbot yet; there is nothing to audit.
- **Dependency CVEs.** No `composer audit` / `npm audit` run — worth a separate
  pass with its own remediation budget.
- **`shopos-mobile`**, which is out of scope by standing decision.
