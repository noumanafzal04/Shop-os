---
name: shopos-admin-keeps-a-demo
description: BUILT + PUSHED 2026-10-09 — /admin/shop-requests is "Demo shops" (Asked to stay · Trying it now); admin keeps a demo directly with the owner's sign-in; ONE rule Tenant::becomeABusiness(); a demo is on NO plan
metadata:
  type: project
---

**User asked (2026-10-09):** a landing-page demo could only become real after
the tenant filled "Keep this shop"; "admin direct b kr skta hai — wo kahin nzr ni
aya admin side py".

**Shipped** — backend `65e3a1c`, panel `b265416`, docs `82b9c2a`. Decision:
`docs/decisions/shopos-the-admin-keeps-a-demo.md`.

- `GET /admin/demo-shops`, `POST /admin/demo-shops/{tenant}/keep` (gate
  `tenants.create`). Screen keeps its ADDRESS (`/admin/shop-requests`), rail
  label is now **Demo shops**; `?show=trying` is the second list.
- The keep asks for the OWNER'S SIGN-IN (a demo is entered by a token only —
  nobody knows its password). Password shown as text + `suggestPassword()`.
  Name optional. NOT the plan — after keeping, the admin lands on the shop page.
- `Tenant::becomeABusiness()` is the one rule; approval and keep both call it.
- A demo with a pending request is offered **Approve**, not the form (they
  already chose a password). `keep_request` is on a demo's own page only.
- **A demo is on NO plan** (was `where('name','Premium')` → null since the plan
  was renamed Standard). Kept shop = no plan, no subscription, nothing paid.

**Things that bit (mine):**
- `->stably()->paginate(` must be on ONE line — `PagesHoldStillTest` reads text.
- `e2e/savesSayWhenTheyFail.guard.ts` cannot see an `onError` declared in a hook
  in ANOTHER file: the call site passes `failed(toast, "…")`. So a shared
  mutation hook carries onSuccess only.
- `POST /demo` is throttled 5/min, 20/hour — a browser-mutation runner that
  opens a demo per run needs ~14 s between runs and must treat a 429 as
  "proves nothing". Demos my runs left were removed via `DELETE /admin/tenants/{id}`.

Related: [[shopos-the-front-door]], [[shopos-queue-oct09]], [[shopos-plan-packages]]
