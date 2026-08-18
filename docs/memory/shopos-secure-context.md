---
name: shopos-secure-context
description: crypto.randomUUID is UNDEFINED over plain http; 4 call sites bypassed common/uuid.ts including the offline sale's op id; jsdom hid it because it IS a secure context
metadata:
  type: project
---

**Fixed 2026-08-18.** `crypto.randomUUID` exists only in a **secure context**
(HTTPS or localhost). Over plain http — the staging droplet on a bare IP, any
shop without a certificate — it is **undefined and throws**.

`common/uuid.ts` was written the day this first crashed the POS: prefer
`randomUUID`, fall back to `getRandomValues` (works over http), then
`Math.random` (these ids are idempotency keys, not secrets).

**Four call sites called the raw API anyway.** Worst: `offlineCheckout.ts`'s
`op` id, minted BEFORE the sale is queued — on a plain-http shop, ringing an
offline sale throws with the goods on the counter and nothing recorded.

> **A helper written because of a bug does not prevent the bug. Only a rule
> does.** — `common/secureContext.test.ts`, a source scan with its own
> denominator, comments stripped.

**Why no test caught it: jsdom IS a secure context** and defines
`crypto.randomUUID`. Same day, same shape as
[[shopos-offline-never-reachable]] (jsdom reports `navigator.onLine = true`).

> **STANDING: the test environment agrees with the code, not with the world.**
> Anything depending on browser state — secure context, onLine, visibility,
> storage pressure, `navigator.locks` — needs a SOURCE rule or a real browser,
> never a green vitest run. See [[shopos-detector-vs-rule]].

Still unguarded over http and worth the same treatment when reached for:
`navigator.locks`, `navigator.storage.persist`, service-worker registration,
`crypto.subtle`.
