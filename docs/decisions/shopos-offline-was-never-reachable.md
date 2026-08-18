# The offline till was never reachable in a browser

**2026-08-18.** Found by the user, not by a test: wifi off, press Complete, and
the button said **"Processing…" for ever**. Turn the wifi back on and the sale
goes through — which reads like a slow server and was something else entirely.

## TanStack Query pauses offline work by default

```js
canFetch = (networkMode ?? "online") === "online" ? onlineManager.isOnline() : true
```

Anything that cannot fetch is **paused** — not failed, not run, *paused*, until
the browser reports a connection again. The default `networkMode` is `"online"`,
and this app had never set it.

So the sale mutation was **never called**. Not the outbox, not the pricing
mirror, not `canSellOffline` with its refusals worded for the counter. Every one
of them lives inside a mutation or a query, and with the line down none of them
was reached.

Quieter on the read side, and it had already bitten this same day: a paused
query never calls its `queryFn`, so `useCurrentSession` could not fall back to
the shift the device remembers. That fix was written, tested, and green —
**and in a browser it did not run.**

> Phases 0–5 of the offline programme were built, tested, shadow-checked and
> shipped. In a real browser, with a real dropped line, a cashier could not ring
> a single sale.

## The fix, and why `"always"` is right rather than convenient

`networkMode: "always"` on both queries and mutations, globally.

This app already has a connection model, and a better one than the browser's:
`connectionStore` is driven by **real traffic**, because a till on a shop router
with a dead uplink is "online" by `navigator.onLine` and can reach nothing. A
request that fails is *useful* — it marks the server unreachable and the offline
path takes over with a reason a person can act on. A request that never happens
teaches nobody anything.

The cost is real and much smaller: offline, requests are attempted and fail
rather than waiting. For a till that is the correct trade.

Pinned in `queryClient.test.ts`, because it is one line no screen would show as
missing.

## Why nothing caught it

Every test in this repo runs in jsdom, where `navigator.onLine` is **true**.
Vitest never paused anything, so 900-odd green tests were all exercising code
that a browser would not call. The offline tests were honest about their
subject and blind to the layer above it.

That is the same shape as the guard tests found earlier this month, one level
up: **the test environment agreed with the code instead of with the world.**

## Two smaller things found in the same pass

**A shop's drawer-close settings never reached the till.**
`pos_blind_close`, `pos_denomination_count` and `pos_declare_tenders` drive the
close screen and were not in `TILL_SETTINGS`, so with no server the screen fell
back to hardcoded defaults. A shop that counts by total got the note-by-note
grid; worse, a shop that must declare its card and bank takings **was never
asked**, and that shift's declaration was lost. They ride down with the catalog
now — server first, device second, defaults last.

**Held tickets offline.** `/pos/held` was server-only and the plan claimed
"local only" support. An offline hold now parks on the device and is never
pushed afterwards: a held ticket is an intent, not money, and a queue could only
flush once the line returned — by which time the basket has usually been rung,
so the shop would find its lanes offering baskets that were already sold.
