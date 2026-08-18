---
name: shopos-offline-never-reachable
description: CRITICAL — TanStack Query's default networkMode "online" PAUSES all queries/mutations when navigator.onLine is false; offline selling never ran in a real browser until networkMode "always"
metadata:
  type: project
---

**Found 2026-08-18 by the USER, not by a test.** Wifi off → press Complete →
button stuck on *"Processing…"* for ever. Wifi on → sale goes through.

```js
canFetch = (networkMode ?? "online") === "online" ? onlineManager.isOnline() : true
```

TanStack Query **pauses** — not fails, never calls — every query and mutation
while `navigator.onLine` is false. The sale mutation was never invoked, so the
outbox, the pricing mirror and `canSellOffline`'s refusals were all unreachable.

> Offline Phases 0–5 were built, tested, shadow-checked and shipped. In a real
> browser with a real dropped line, a cashier could not ring one sale.

Also killed the shift-mirror fix from the same morning: a paused query never
calls its `queryFn`, so [[shopos-offline-shift-gap]] was **green in the suite and
dead in the browser**.

**Fix:** `networkMode: "always"` on BOTH queries and mutations in
`common/api/queryClient.ts`, pinned by `queryClient.test.ts`. Correct because
this app has its own connection model (`connectionStore`, driven by real
traffic) — a till on a shop router with a dead uplink is "online" to the browser
and can reach nothing.

**Why nothing caught it:** jsdom sets `navigator.onLine = true`. 900+ green tests
were exercising code the browser would never call. **The test environment agreed
with the code instead of with the world** — [[shopos-detector-vs-rule]] one level
up.

**STANDING:** when a fix depends on browser state (onLine, visibility, storage
pressure, secure context), a green vitest run is not evidence. Check the real
browser.

Same pass: drawer-close settings (`pos_blind_close`, `pos_denomination_count`,
`pos_declare_tenders`) never travelled in `TILL_SETTINGS`, so a shop that must
declare card takings was **never asked** offline; and offline hold/recall now
parks locally and is deliberately never pushed (a ticket is intent, not money).
