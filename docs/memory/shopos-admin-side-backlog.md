---
name: shopos-admin-side-backlog
description: "2026-08-11 admin scope (owner password reset, billing dates + payment-status filters, security pass) — ALL BUILT as of 2026-08-15"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-15T10:12:42.524Z
---

Requested 2026-08-11. **All of it is built as of 2026-08-15** — verified in the
code, not assumed. This file used to say "nothing below is built yet"; that was
true when written and stopped being true without anybody coming back to it.

- **Owner password reset** — `TenantController::resetOwnerPassword`, routed at
  `POST /admin/tenants/{tenant}/owner-password` behind
  `permission:tenants.reset_password` + `throttle:auth`.
- **Own password change** — `POST /auth/password/change`.
- **Billing state + filters** — `paid / grace / unpaid / suspended`, mutually
  exclusive by construction (`TenantController`, and `Tenant::graceDays()` /
  `graceEndsAt()` / the state machine on the model).
- **Security pass, both sides** — done 2026-08-15, see
  [[shopos-security-pass]] and `docs/decisions/security-pass.md`.

**Why this file still exists:** as the record that a memory can go stale
silently. The stale-note pattern bit twice in one session — this file, and the
"Still open in Phase 3" note in `offline-pos.md` that listed two items which had
already shipped. Verify against the code before trusting any status note here.

Still genuinely NOT built (both from the verified list, neither an admin item):
automotive job card, and `food`'s `inventory: false` default — that one is a
product decision, not a build.
