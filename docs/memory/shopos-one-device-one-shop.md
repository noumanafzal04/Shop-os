---
name: shopos-one-device-one-shop
description: FIXED (CRITICAL) — the offline catalog had no tenant fence, so a device signed into a second shop showed and SOLD the first shop's products; proven on production
metadata:
  type: project
---

**2026-08-29. The user suspected it; it was real.** "mujhe laga kisi aur tenant
ki products bhi show ho rahi POS screen mein."

**IndexedDB is scoped to the ORIGIN, not the tenant.** One browser used by two
shops has ONE database. The outbox always knew this (`belongsHere`). The
**catalog never did** — its rows carry no tenant at all.

`clearCaches()` existed, its docblock said "when a till is handed to a different
shop", and **nothing ever called it**. Logout clears the auth store + query
cache and does not touch IndexedDB. Classic [[shopos-promise-in-another-file]]
crossed with built-but-unreachable.

**Proven on panel.cartze.shop** with two demo shops, asserting which tenant the
page was signed in as first:
- pharmacy's own: Brufen, Cough Syrup, ORS, Panadol, Surgical Mask
- **the mart's, leaked**: Cooking Oil, Milk, Rice, Sugar, Tea

**Fix = a STAMP, not a wipe on logout.** `SyncMeta.tenantId` +
`ensureDatabaseBelongsTo()` in `offline/db/tillOwner.ts`, called from
`pullNow.run()` and from login success. Logout is not the only door (token
expiry, tab close, straight handover); a stamp is checked at the moment of USE
so no route bypasses it.

Two things it must NOT do, both mutation-proven:
- clear DURABLE stores (outbox/shift queue/receipt counter = money + slip numbers)
- treat an UNSTAMPED db as a stranger (every field till is unstamped on ship day)

**The missable half:** `SYNC_META` is NOT a cache store, so clearing the catalog
while leaving cursors → next pull asks for a DELTA against the other shop's
position → healthy-looking sync, empty shelf. Cursors must reset too.

**TWO of my own test bugs, in one session:**
1. `hasText` locators re-evaluate — a badge located by its text stops matching
   the instant its label changes, so it can never observe the states under test.
2. `addInitScript` re-runs on EVERY navigation — it kept restoring shop one's
   token, so the first leak "proof" could not have observed what it reported.
   **STANDING: assert which tenant the page is signed in as before believing
   anything a two-tenant test says.**

Related: [[shopos-half-the-sync]], [[shopos-measurement-that-lied]],
[[shopos-offline-plan]].
