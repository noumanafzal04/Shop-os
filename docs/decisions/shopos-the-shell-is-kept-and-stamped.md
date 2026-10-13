# What the shell needs is kept on the device — and the server says when it changed

2026-10-13 (afternoon). The owner, the night before, of the count beside
"Orders": *"aise to theek nahi, har baar load ho — jab hum store use kar rahe
hain to aisi cheezain kyun nahi use kar rahe, ke rate limit theek rahe,
request time na ho"*, and the next day: *"Reload par baqi requests (devices,
catalog, settings) bhi isi tarah store me — network bhi check karna hai"*.

## What a reload asked

Recorded as a HAR of the clothing fixture's owner reloading five screens:

| | before | after |
|---|---|---|
| Dashboard | 8 requests, 6 the shell's | 1 |
| Products | 9, 6 | 2 |
| Sales | 10, 6 | 3 |
| Customers | 9, 6 | 2 |
| Till | 14, 5 | 8 |

The shell's seven: `/auth/me`, `/shop/settings`, `/branches`, `/notifications`,
`POST /pos/devices`, `GET /pos-devices`, `GET /pos/catalog`.

## What is kept, and when it is asked again

`panel/src/common/kept` — one persisted record (`shopos-kept`), one person's in
one shop; signing out throws it away; a browser that will not store keeps
nothing and fails nothing (`deviceStorage.ts`).

| Answer | Kept as | Asked again |
|---|---|---|
| Shop settings | `useKeptQuery("shop-settings")` | a save here · the stamp moving · 5 min |
| Branches | `useKeptQuery("branches")` | a branch saved here · the stamp · 5 min |
| The bell, page 1 | `useKeptQuery("notifications")` | every 30 s, as before — not again because a screen opened |
| Who am I | the auth store's `user` + `userAt`/`userUnder` | a settings save · the stamp · 5 min; not at all straight after sign-in |
| Till announces itself | `STORE.DEVICE.announced {shop, at}` | every 5 min (the rule `touch.ts` already stated), at once for another shop, again after a refusal |
| Till roster | — | **never by the boot.** It was asked for one number that no screen read; the window that matters reaches a till in its catalogue |
| Catalogue | `syncMeta.pulledAt` | something queued to send · nothing held · a pull cut short · 5 min · a line that came back · the 15-min heartbeat · the Sync button · **this device saved something** |

**This device saved something** is new behaviour, not only a saving: a product
made at a counter was not in that counter's offline list until the next
heartbeat — up to fifteen minutes. `client.ts` now says when a write was
accepted (`onServerWrite`), and the till pulls two seconds after the last one
(`catalogueNews.ts` says which writes are not news: the till's own traffic,
sales, the session, the bell).

## The stamp — without it, "kept" meant "stale"

Found by my own probe, not asked for: an admin switches a module on and says
"refresh the page"; the owner refreshes; the page opens from what the device
kept, for up to five minutes. Before this work a reload was always fresh.

So every signed-in answer carries `X-Shell-Stamp` (`StampTheShell`): a hash of
the shop's row and the person's row, read from models the request already
holds — it asks the database nothing. A branch and a plan are other rows, so
saving either touches the shop (`Branch::booted`, `Plan::booted`). The panel
compares it on every answer (`shellStamp.ts`): the same → nothing; moved →
ask for the stamped answers nobody has asked for since. A kept answer
remembers the stamp it was heard under, so a refresh that failed is retried
on the next load.

- It costs no request. A change reaches a device with the next thing it asks.
- Measured in two browsers: module switched off → owner's reload shows it,
  asking `/auth/me` and `/shop/settings` once each → the next reload asks nothing.
- Exposed to browsers in `config/cors.php`. **If the live nginx sets CORS
  itself it must expose `X-Shell-Stamp`**; hidden, the panel still works and
  falls back to the five minutes.
- A Settings save asked three things twice until the stamp learned to let the
  screen go first (counted in a browser; pinned by a test).

## What it changed for the browser specs

A saved sign-in carried the device's kept answers into every test. Specs that
change the shop behind the page saw the old answer for a moment after first
paint — long enough for a sheet opened in that moment to be thrown away.
`e2e/freshDevice.ts`: a saved sign-in is a session, not a device that has
been here (`keepSession`), with a guard that every spec uses it. One spec
answers for the server (`one-place`) and says so (`aDeviceThatKeepsNothing`).

## Tested

- vitest: `common/kept/*` (kept, keptStore, useKeptQuery, shellStamp,
  aSaveRefreshesWhatIsKept — add / change / remove for settings, branches,
  bell, who-am-I), `onServerWrite`, `pullIsDue`, `catalogueNews`,
  `useOfflineBoot`, `useKeepInSync`, `applyPull`. Mutations: 36 + 24, all caught.
- backend: `TheShellStampTest` (19). Mutations: 11, all caught.
- browser: `e2e/kept-on-the-device.spec.ts` (3) on the dev server and on the
  built preview; 7 mutations caught. `offline-shift`, `selling`,
  `refused-sale` on the built preview: 19 passed.
- By hand, in one browser: a product made on Products is in the till's own
  database four seconds later; with the line down it is listed, found by
  name and by scanner; two sales rung offline; the tab closed; the line back
  and a NEW tab opened on Products — both sales on the server, stock down.

## Also found on the way

The count beside Orders (pushed the night before) judged "already kept" by
the clock alone. Two answers inside one millisecond left the menu showing the
new count and the device holding the old one. Fixed and pinned; it showed up
as a test that failed one run in two under load.

## Left

- `/pos/held` is asked seven times and `/pos/registers` four in one
  hold → resume → pay; the sales list asks for a page of products. Not kept yet.
- The first load of a new device is still the whole catalogue (4.6 MB for
  the clothing fixture). Unchanged.
