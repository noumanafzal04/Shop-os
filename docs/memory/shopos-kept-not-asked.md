---
name: shopos-kept-not-asked
description: STANDING (USER 2026-10-13) — a figure the shell shows on every screen is KEPT on the device (persisted zustand store) and asked for again only on NEWS (own mutation, the bell, a screen that already has it), never on every load or a short poll. First case: the Orders count. Next, same pattern: the other shell requests a reload makes
metadata:
  type: feedback
---

**The rule.** Anything the menu/header shows on every screen is kept in a persisted store and re-asked only when something says it changed. Not on each page load, and not on a 30-second poll.

**Why:** the user's words, 2026-10-13, when told my sidebar Orders count added one request to every load: *"isko achay se handle karo — tab update ho jab order create ho; invalidate tab, jab order on/off ho; aise to theek nahi, har baar load ho"* and *"jab hum store use kar rahe hain to aisi cheezain kyun nahi use kar rahe, ke rate limit theek rahe, request time na ho"*. The measured cost: a browser walk of 35 screens was refused by the API limit (240/min per person) — 301 requests in 56 s, 32 of them my count.

**How to apply** (the pattern that was built — `panel/src/modules/orders/waitingCount.ts`, `waitingStore.ts`, `hooks/useOrders.ts` `useOrdersWaiting`):
- react-query with `initialData` + `initialDataUpdatedAt` from a persisted zustand store, `staleTime` = how long a kept answer is trusted. A reload inside that asks nothing.
- The record in the store is fenced by `shop:user` ([[shopos-one-device-one-shop]]); a new `shopos-*` key goes in `brandName.test.ts`.
- News from THIS device: put the query under the key the mutations already invalidate.
- News from ANOTHER device: the bell (`/notifications`, already polled every 30 s). Compare WHICH notification is newest (its id), never a time — two clocks. The first hearing is not news.
- A screen that already has the figure tells the shell (`setQueryData`) instead of the shell asking.
- What no event can tell you (another device changed something silently) gets ONE slow asking (2 min here), said out loud in the comment as the exception.
- Test by COUNTING REQUESTS, in vitest and in the browser. In the browser, match the API's whole address — the dev server serves source files whose paths contain the same words (my first count was of `orders/waitingCount.ts` being served).

**My interpretation, not the user's words:** they asked for "only when an order is created / goes on-off"; the two-minute asking is mine, because a second counter accepting an order rings no bell. I told them so.

**Still to do the same way** (user's second message asks for it; stopped for the night before starting): `POST /pos/devices`, `GET /pos-devices`, `/pos/catalog` on screens that are not a till, and `/shop/settings` — a whole reload asks six things before the screen asks its own (`docs/decisions/shopos-what-a-request-costs.md`).
