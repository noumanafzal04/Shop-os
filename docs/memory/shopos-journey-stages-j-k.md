---
name: shopos-journey-stages-j-k
description: 2026-10-07 journey stage J (food menu+bill, 10/10) and K (chemist, 8/8); same-salt sheet was unreachable by touch; split sheet named lines by dish alone
metadata:
  type: project
---

**Stage J** `panel/e2e/journey/21-food-the-menu-and-the-bill.spec.ts` (JOURNEY_TRADE=food, after H): sizes, a required choice + paid extras, recipe costed from ingredients, same order joins its line, kitchen paper, move table, merge tabs, part-settle, two tenders, recipe stock. 10/10.
**Stage K** `22-pharmacy-the-dispensary.spec.ts` (JOURNEY_TRADE=pharmacy): lots + mandatory expiry, FEFO, Rx record, controlled-drug fence, expired lot refused + written off, substitute, recall. 8/8.

**Faults a shop would have met (all fixed):**
- "Same salt, in stock" could only be opened by KEYBOARD — an out-of-stock tile is `disabled`, so the tap never reached `commitProduct`. `offersEquivalent()` in `pos/availability.ts` keeps an out-of-stock MEDICINE pressable. (8th "built but unreachable".)
- A line's notice ("℞…", "Substituted with…") stayed over the next customer's cart. `sayOfALine` + cleared in `clearSale`. My first fix read a ref INSIDE a setState updater after clearing it — only the browser case caught it.
- The split-bill sheet named a line by dish alone (Half and Full both "Karahi"). `lineName/lineExtras/lineSpoken` in `dinein/tabLines.ts`.
- Batch list marked a lot EXPIRED on its last good day (`new Date(date) < new Date()`). `isPastDate` in `common/shopDay.ts`.
- Help promised "split evenly"; the sheet never had it ([[shopos-promise-in-another-file]]).

**How to apply:**
- A journey settles once, so each fault got a RE-RUNNABLE browser case: `e2e/food.tab-order.spec.ts` (Half/Full), `e2e/trade.same-salt.spec.ts` (pharmacy project only; sells nothing so its shelf never runs down).
- Harness traps met: the till draws its notice twice (phone + counter) — use `.locator("visible=true")`; a button's accessible name is its TEXT ("Reset"), not its `title`; `isEnabled()` on a locator that matches nothing waits the whole test timeout; Disposals opens on "To claim".
- `tsc -b` type-checks `e2e/` too (unused imports fail it).
- Editing `src/` while Playwright runs against the dev server reloads the page mid-test.

**Next:** retail (serials, warranty), auto, petroleum, services, online, finance; food: deal with a sized item at the table, per-size recipes, 86 mid-service, hand-over.

Related: [[shopos-food-journey-stage-h]], [[shopos-the-journey]], [[shopos-shop-day]]
