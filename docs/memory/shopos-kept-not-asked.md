---
name: shopos-kept-not-asked
description: STANDING (USER 2026-10-13) — what the shell shows on every screen is KEPT on the device and asked again only on news; DONE for settings, branches, bell, who-am-I, till announce, catalogue; the SERVER STAMP (X-Shell-Stamp) is what makes kept safe — without it a change made elsewhere showed up to 5 min late
metadata:
  type: feedback
---

**The rule.** Anything the menu/header shows on every screen is kept in a persisted store and re-asked only when something says it changed. Not on each page load, and not on a short poll.

**Why:** the user's words, 2026-10-13: *"aise to theek nahi, har baar load ho … jab hum store use kar rahe hain to aisi cheezain kyun nahi use kar rahe, ke rate limit theek rahe, request time na ho"*, then *"Reload par baqi requests (devices, catalog, settings) bhi isi tarah store me — network bhi check karna hai"* and *"add, remove, update par store invalidate hota hai ya nahi"* (they want that tested each time).

**How to apply** — built in `panel/src/common/kept` (`useKeptQuery`, `keptStore` key `shopos-kept`, `shellStamp.ts`); full table in `docs/decisions/shopos-the-shell-is-kept-and-stamped.md`:
- New shell-wide answer → `useKeptQuery(name, {queryKey, queryFn, staleTime})`. It is kept inside the asking, under whoever ASKED (the till lets a second person take over by PIN without clearing the query cache).
- If the answer is made of the shop's row / the person's row / the plan / branches, add it to `STAMPED` in `shellStamp.ts`. If it is made of anything else, that thing must touch the shop row on save (as `Branch::booted` and `Plan::booted` do) or the stamp will not move for it.
- **Kept without a stamp is stale.** My first cut passed every test and showed an admin's module change up to five minutes late on reload. Any "kept" answer needs a way to hear a change made ELSEWHERE; ask that question before calling it done.
- Test by COUNTING REQUESTS, in vitest and in a browser (HAR / `e2e/kept-on-the-device.spec.ts`), and test add / change / remove → the DEVICE holds the new answer, not only the screen (`aSaveRefreshesWhatIsKept.test.tsx`).
- A browser spec's saved sign-in must go through `keepSession` (`e2e/freshDevice.ts`) — a saved state is a session, not a device that has been here. A spec that fakes a kept answer with `page.route` calls `aDeviceThatKeepsNothing`.
- zustand `persist` throws out of `setState` when storage is full — a kept note uses `noteStorage()`.

**Still not kept:** `/pos/held` (7× in one hold→resume→pay), `/pos/registers` (4×), the sales list asking for a page of products.

**Deploy note:** if nginx on the server sets CORS headers itself, it must expose `X-Shell-Stamp`; hidden, the panel falls back to the 5-minute clock.
