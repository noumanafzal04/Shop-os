# The admin side grows up, and a receipt stops being public

`2026-08-11`

Six things were asked for in one message: password recovery for a locked-out
shop owner, a way for an admin to change their own password, real billing dates
at tenant creation, a paid/unpaid/grace/suspended filter, "good features" on the
admin side generally, and a security pass on both sides. What follows is what
each turned out to be, because four of the six were not what they looked like.

---

## 1. Nobody could change their own password

Not the shop owner. Not a cashier whose PIN had been watched. Not the super
admin, whose seeded `admin@shopos.test` / `password` is printed in a public
repository and is now a hard failure in `php artisan shopos:readiness`.

`POST /auth/password/change` has existed since the first week. The panel's
`authService.changePassword` has existed nearly as long. **No screen ever called
it.** The endpoint worked; the mutation worked; there was no button.

One screen — `modules/auth/pages/SecurityPage.tsx` — mounted on both consoles at
`/admin/security` and `/tenant/security`, reachable from the avatar menu, which
until now offered platform users nothing at all but Sign out. It is deliberately
ungated on the shop side: everyone signed in has a password, from the owner to
the newest cashier.

## 2. A locked-out owner had no way back in

The OTP reset needs the phone or the email on the account. An owner who has lost
both — a changed SIM, a dead business address — had exactly one recovery
procedure: someone opening a MySQL console against production. That is not a
procedure, it is an outage with a workaround.

`POST /admin/tenants/{tenant}/owner-password` now exists, and three things about
it are load-bearing:

**It is its own permission.** `tenants.reset_password`, not part of
`tenants.update`. Editing a shop's phone number and taking over its account are
not the same act, and bundling them would hand the second to every support
person trusted with the first. Whoever holds this can sign in as any business on
the platform and read every rupee it has ever taken.

**Every session the owner had is destroyed** — not "other sessions", every one.
The admin is not the owner, so there is no current device worth preserving, and
the likeliest reason for the call is that a session exists which should not.

**It writes its own audit row.** The `Auditable` trait would log an `updated`
event with no values (password is correctly excluded from audit payloads), which
is indistinguishable from any other edit. For the one action that can
impersonate a business, the trail has to say what happened.

The new password is never returned by the API. The admin typed it and hands it
over by whatever channel they already trust; echoing it back would put it in
browser history, proxy logs and the network tab for nothing.

A shop with two owners gets `MULTIPLE_OWNERS` rather than having "the first row"
silently picked — otherwise the admin hands the new password to the wrong
partner and both believe they are locked out.

## 3. "Default payment date or between"

The request read ambiguously and turned out to be two facts, not one:

- **The billing window** — `period.starts_at` / `period.ends_at`. Omitted, the
  subscription starts today and runs for the plan's billing period, which was
  the only option before and is right only for a shop signing up this minute.
  Every shop that joined mid-cycle, paid two months up front, or was given a
  free month was typed in as "starts now", and its renewal date was then wrong
  **forever**, because every later period stacks onto the one before.
- **When the money arrived** — `payment.paid_at`, backdatable, never
  forward-dated. A shop that paid on Thursday and was entered on Monday paid on
  Thursday. A shop that pays three days late has not bought three fewer days.

Creation is the only moment the renewal anchor can be set correctly. Both fields
are on the create form and on Assign/renew plan, and an explicit window
**overrides** the same-plan stacking rule — stacking exists to protect days a
shop already paid for, not to relocate a window somebody typed on purpose.

## 4. The filter that was never built

`subscription_ends_at`, `plans.grace_period_days` and `Tenant::subscriptionState()`
all existed. So did the seeder that fabricates active / expiring / expired
tenants. What did not exist was any way to **ask**: the state was computed in
PHP, one row at a time, after loading. An admin with four hundred shops could
see the state of any one of them and could not answer the only question they
actually ask, which is who to chase this morning.

`Tenant::scopePaymentStatus()` answers it in SQL. Two decisions inside it:

**Grace is per PLAN** — basic 7 days, premium 14, enterprise 30. A filter that
assumed one grace length would put enterprise shops in the wrong bucket for
three weeks. `test_grace_is_read_from_the_plan_not_a_fixed_number` exists purely
to fail if that ever regresses, and it does fail when the lookup is replaced
with the default.

**The date arithmetic happens in PHP, not SQL.** `ends_at + graceDays > now` is
written differently on every driver, and this codebase runs MySQL live and
SQLite in tests. Rearranged, the same inequality is `ends_at > now - graceDays`,
so nothing crosses into the query but a timestamp.

The four buckets are **mutually exclusive by construction**: suspension is a
platform decision that outranks the calendar, so a suspended shop is only ever
"suspended" whatever its dates say, and a deleted business belongs to no bucket
at all — it is listed so an admin can restore it, but it owes nothing and must
never appear on a chase list. `test_every_shop_lands_in_exactly_one_bucket`
pins that.

Counts ride along on every response, computed against the same search but
without the bucket filter, so the tabs read "Unpaid (3)" without a click — and
an admin who never opens the tab still sees that three shops are behind.
`all` is a separate count rather than the paginator's total, because once a
bucket is selected the paginator counts that bucket.

---

## The security pass

Five findings. Two were real exposure; the rest were gates that existed on the
endpoint and not on the screen.

### Receipts were on a public URL

The worst of them. Expense and income receipts were written to the `public`
disk, alongside product photos and shop logos. Those belong there — they are
meant to be seen by strangers. **A receipt is not**: it is a supplier's name, an
amount, an account number and a business's letterhead. `public` means the web
server hands the file to anyone who asks — no token, no tenant check, nothing in
the application ever seeing the request. The random filename was the entire
access-control model.

They now live on the private disk and are served by
`GET /expenses/{id}/attachment`, which runs the same tenant scope and the same
permission as the row they hang off. `attachment_url` is the API path, not a
followable link; the panel fetches it with its bearer token via
`openAuthedFile`. Files uploaded before the change are still read from `public`
so nothing breaks — only new writes move.

### Platform staff could all read the platform's revenue

Billing was gated on **role** alone, so every `admin_staff` — including someone
hired to schedule banner ads — could read the whole platform's takings. Now
`billing.view`.

The instructive part is what that alone would have missed: the admin dashboard
printed revenue on the landing page regardless, so gating the endpoint would
have moved the leak one screen sideways. `DashboardService::forPlatform()` now
takes `$withRevenue` and omits the KPI, the trend series and the recent-payments
list — **absent, not zeroed**, because a zero is an answer and it is the wrong
one. And the plans panel was carrying takings-per-plan underneath, which a test
caught: stripping the headline while a table below still adds up to it is the
appearance of a gate rather than a gate. The plan's *price* stays — that is the
product list, and it is on the public pricing page anyway.

### The admin rail had no permission filter at all

The shop rail has been filtered since a waiter was found looking at the takings.
The admin rail never was. A banner scheduler was offered Tenants, Plans,
Billing, Platform Staff and the Audit Log, and learned which were real by
clicking them and reading a 403.

The rule lives in `common/routing/adminScreenPermissions.ts` — one map, read by
the sidebar, the dashboard's Quick Actions **and** a new `RequireAdminScreen`
route guard. All three, because filtering the rail while the shortcut row below
it stayed open would have been the same defect one scroll further down the page,
and because hiding a link is a courtesy rather than a lock: typing
`/admin/payments` used to load the whole billing screen and watch it fill with
403s.

`/admin` itself is never gated. It is where the console lands, and a home page
that 403s is not a permission model, it is a locked front door — so its
*contents* are filtered instead.

### Two permissions with no labels, and three more found alongside

`tenants.reset_password` and `billing.view` rendered on the staff form as
"Tenants Reset Password" and "Billing View", because `labelFor` falls back to a
humanized slug. Nothing looked broken. The most dangerous checkbox on the
platform was being offered with no explanation of what it does.

Writing a test for it found three more that had never had labels either —
`banners.manage`, `announcements.manage`, `kitchen.manage`. `permissions.test.ts`
now asserts every key the server issues has a written label, that the five
consequential ones carry a hint, and that no label exists for a permission the
server no longer issues.

### CORS accepted every origin

`allowed_origins: ['*']` is right on a laptop, where the panel, the mobile
bundler and a phone on the LAN all call from different origins. It is wrong the
moment the box is public. Now `CORS_ALLOWED_ORIGINS`, defaulting to `*`, with
`shopos:readiness` failing on `*` in production and warning otherwise.

### What the pass cleared

Worth recording so it is not re-audited: rate limiting **is** applied globally
(`throttle:api` on the v1 group, 60/min per user, with tighter `auth` and `otp`
limiters on the credential routes) — I suspected it was defined-but-unapplied
and it is not. Raw SQL is either parameterised or built from values cast to
float. Login does not leak whether an account exists. Refresh tokens are
single-use, rotate, and re-check suspension. `User` carries `tenant_id` without
the `BelongsToTenant` scope, but every tenant-side query of it scopes explicitly
— correct today, and worth a glance whenever a new one is added.

---

## What is still open

- **The waiter and the sales ledger.** A waiter on a single-branch shop still
  sees that shop's sales history. Narrowing it needs a rule that survives relief
  cover, and none of the obvious ones do — see the 2026-08-07 entry.
- **Owner-only, unchanged by this session:** rotate the Geoapify key (still in
  git history, repo is public), change the seeded super-admin password (there is
  now a screen for it), fix `DEPLOY_SSH_KEY`, get a domain and a certificate.
