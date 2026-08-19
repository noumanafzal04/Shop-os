---
name: shopos-offline-in-a-browser
description: "FIXED — first real-browser offline selling run: 5 bugs incl. a dropped line signing the till out, a dead Complete button, a stale queue badge, a till that could lock itself out, and a phone that never said it was offline"
metadata:
  type: project
---

**2026-08-19.** `context.setOffline(true)` in Playwright is the ONLY thing in
this project that can put the app in the state the offline module exists for —
jsdom pins `navigator.onLine === true`. First run found three defects, all of
them in **what the cashier is told**.

1. **A dead Complete button.** The tender panel rendered an error only for
   `checkout.error instanceof ApiError`. `OfflineRefused extends Error`, so a
   refused offline sale showed *nothing* — no spinner, no message, no sale. The
   till had a good sentence ready that nobody could see. Now every failure
   shows, and a refusal is titled "Can't ring this offline" — telling a cashier
   to "try again" about a sale the till has decided it cannot ring is worse
   than silence.

2. **"1 still to send", for ever.** Row went `pending → acked` with an invoice
   in 8s; the pill still said 1 owed a minute later. `pendingCount()` was
   right — it was never called again. Deps were `[enabled, connected]`, and
   neither moves when a flush finishes (the till was already connected; that is
   why it flushed). Fixed by recounting on the `syncing` transition.

3. **A till that could lock itself out.** Unlock is HTTP and the PIN lives only
   on the server (correctly — a mirrored PIN is readable by anyone holding the
   tablet). A lock during an outage could not be opened. The escape hatch signed
   the till OUT, through the same server. **A lock nobody can open is not
   security, it is a shutter.** Idle lock now gated on `connected`, hand-over
   disabled offline with a reason, already-locked tills told which door is shut.

4. **A dropped line could sign the till out.** `refreshTokens()` was a bare
   `catch { clear(); }` with the comment "refresh token dead" — a cause it never
   checked. Network failure, timeout, 502, 429: all hard logout. On a till that
   is the worst outcome there is — the outbox can only be sent WITH a token, so
   the queue is stranded behind a login screen that also needs the server.
   **Only the server may end a session:** clear on 401/403 only.

5. **A phone never said it was offline.** The connection pill was
   `hidden … sm:flex`; a phone is below `sm`. It is the ONLY thing on the till
   reflecting the connection, so a phone selling through a power cut looked
   identical to one selling normally. Drawn at every width now.

**NOT fixed, needs a decision:** the offline slip is
`OFF-<register>-<4 chars of device id>-<counter>`, with the **device id in
localStorage and the counter in IndexedDB**. Evict IndexedDB and the counter
restarts under the same device segment → every later offline sale collides with
one already recorded and can NEVER be sent ("Duplicate entry … 
sales_tenant_offline_number_unique"), retried for ever behind a generic message.
`DEVICE_SEGMENT = 4` is also only 65,536 values, so two tills in one tenant can
collide. Left alone because the slip is printed, given to a customer and is the
refund handle. See docs/qa/FINDINGS.md.

**Harness lessons:**
- `expect(after.length).toBe(before.length + 1)` against **paged** `/sales` (50
  rows) can never fail once a shop has 50 sales. Compare the numbers, not the
  count.
- A leaf-only text scan (`if (el.children.length) continue`) cannot see
  `<button><span dot/>Offline</button>`. Ask each element for its **own** text
  nodes.
- `offline_selling` is a platform GRANT (plan limit on the tenant, published on
  the catalog envelope beside `offline_days`), **not** a shop setting.
- `useKeepInSync.test.tsx` mocked `pendingCount: async () => 0` — a constant, so
  **a stale count was unobservable by construction.**
- Playwright's `request` fixture is NOT taken offline with the page: use it to
  prove the server did not get the sale while the till was offline.
- `reuseExistingServer: true` serves a stale build. Rebuild first.

Related: [[shopos-offline-never-reachable]], [[shopos-sync-progress-pill]],
[[shopos-cart-hid-its-lines]], [[shopos-screen-testing]]
