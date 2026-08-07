---
name: shopos-session-refresh
description: Panel auth store is persisted to localStorage and only refreshed via useMe() — mount it in AppLayout or admin module-toggles/settings never surface
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-29T08:20:16.929Z
---

The React panel's `useAuthStore` (zustand) is `persist`ed to localStorage (`shopos-auth`) and holds `user.tenant.features`. The sidebar (`AppSidebar` via `shopNav`) reads capabilities straight from this store, NOT from `/shop/settings`.

**Gotcha (fixed 2026-07-29):** the store was only ever written at login. So when a Super-Admin toggled a tenant's modules (`PUT /admin/tenants/{id}/modules` — backend correct) or a tenant saved settings, the logged-in tenant kept seeing stale features across page refreshes until a full re-login. The `useMe()` hook (`GET /auth/me` → `setUser`) existed but was **never mounted** — dead code.

**Why:** backend was right the whole time (`TenantResource` includes `features`; login + `/auth/me` eager-load `tenant`). The bug was purely that the persisted session was never refreshed.

**How to apply:** `useMe()` is now called in `AppLayout` (the authenticated shell) so every load refreshes `user.tenant.features`; `useUpdateShopSettings` also invalidates `["auth","me"]` for instant same-session refresh. Any future data that the sidebar/shell reads from the auth store has the same staleness trap — refresh via `/auth/me`, don't assume login-time data is current. Admin-toggling ANOTHER user's live session still only propagates on that user's next load (no websockets). See [[shopos-multi-branch]], [[shopos-ui-conventions]].
