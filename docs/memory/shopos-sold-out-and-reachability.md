---
name: shopos-sold-out-and-reachability
description: "2026-08-17: 86/sold-out shipped (a dish could never be out of stock by design); offline_selling had NO admin screen — 7th 'built but unreachable'. PWA icons + install prompt + CVE pass done."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T15:02:37.889Z
---

`docs/decisions/shopos-sold-out-and-reachability.md`.

**1. A dish could never be out of stock.** `InventoryService` lets recipe
depletion go negative *on purpose* — a dish is made to order, and refusing to
settle a tab for food already eaten is worse than a negative figure. So a
sold-out fish sold all evening. Now `products.sold_out_at`:

- **A timestamp, not a boolean** — the failure mode is FORGETTING to switch it
  back on, and "off since Tuesday" is the sentence that fixes that. Pressing
  twice keeps the FIRST time.
- **Never clears overnight** — an item that un-86s itself while the kitchen
  still has none puts a customer in front of a dish that never arrives.
- Refused **server-side** (`ITEM_SOLD_OUT`), exempt on the trusted path
  (dine-in settle / order / reservation), **sent to the till not filtered out**
  (an omitted row looks like a tombstone), `products.manage` not `sales.manage`,
  not fenced to food.

**2. `offline_selling` had no admin screen at all.** In PlanLimits the whole
time; server reads it, till obeys it, outbox refuses without it — and the only
way to grant it was a hand-written HTTP request. The limits modal lists five
COUNTABLE ceilings and this is a policy, so it fell between them. **Seventh
"built but nothing a person touches can reach it."** Own card now; revoking
sends `null` (extendLimits refuses < 1).

**"How does a shop set up offline?" — it doesn't.** Till registers itself,
caches the catalog, runs shadow pricing, all automatic. The admin's grant is
the only decision, made after reading Reports → Offline.

Also: PWA icons (all 3 entries pointed at a 48×48 file — the SECOND, unfamous
blocker on installing, beside HTTPS); install prompt (Safari fires nothing, and
**iPadOS reports `MacIntel`** so UA checks miss the target device); CVE pass
(panel 15→1, backend clean, all checked against `dist/`). `npm audit fix` moved
vite 6.1→6.4 and killed the RUNNING dev server — stale process, not a bad
install; pkill + `rm -rf node_modules/.vite`.

**Still open from the Aug-09 gaps:** near-expiry notification · recurring
income · reorder list → purchase order. Four other entries were stale and are
corrected — see [[shopos-qa-sweep-aug09]].

Backend 2004 · panel 882.

Related: [[shopos-offline-plan]], [[shopos-ui-sweep-aug17]], [[shopos-security-pass]].
