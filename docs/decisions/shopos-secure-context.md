# A helper written because of a bug does not prevent the bug

**2026-08-18.** `crypto.randomUUID` exists only in a **secure context** — HTTPS,
or `localhost`. Served over plain http, which is every staging droplet on a bare
IP and every shop that has not got a certificate yet, it is **undefined**, and
calling it throws.

It had crashed the POS once already. `common/uuid.ts` was written that day and
opens by saying so: prefer `randomUUID`, fall back to `getRandomValues` (which
**does** work over http), and finally to `Math.random` — these ids are
client-side idempotency keys, not secrets, so the last resort is acceptable.

## And four call sites went on calling the raw API

| Where | What breaks over http |
| --- | --- |
| `offlineCheckout.ts` — the sale's `op` id | **the offline sale itself** |
| `ParkAsDocumentModal.tsx` | parking a quote |
| `DocumentDetailPage.tsx` ×2 | settling a document |

The first is the one that matters. `op` is minted **before** the sale is queued,
so on a plain-http shop a cashier ringing an offline sale would throw with the
goods already on the counter and nothing recorded anywhere. The whole outbox —
durable, append-only, tested against every failure it could think of — sat
behind one call that could not run.

> A helper written because of a bug does not prevent the bug. Only a rule does.

## Why no test caught it

**jsdom runs in a secure context and defines `crypto.randomUUID`.** Every unit
test passed against code a shop on http cannot execute.

That is the same sentence as the react-query finding earlier the same day, where
jsdom reports `navigator.onLine` as `true` and so never paused anything. Twice in
one day, one shape:

> The test environment agreed with the code instead of with the world.

Which is why the rule is a **source scan** rather than a runtime guard: reading
the source is the only check that does not inherit the environment's opinion.

`secureContext.test.ts` fails when anything outside `common/uuid.ts` names the
raw API, carries its own denominator so a broken matcher fails instead of
reporting a clean sweep, and strips comments — the helper and the rule both have
to be able to NAME the API they guard.

## The list is deliberately open

One entry today. The point of the shape is the next one: `navigator.locks`,
`navigator.storage.persist`, service-worker registration and the Web Crypto
subtle API are all absent or refused over plain http, and each will want the
same treatment the day something reaches for it.
