---
name: shopos-food-journey-stage-h
description: Journey stage H (restaurant) = 8 cases green, 16/16 with A+B on a fresh shop; found "Add item" opening as Physical product in food/pharmacy shops, unnamed takeaway cards, vanishing "+ Add table"
metadata:
  type: project
---

**2026-10-06.** `panel/e2e/journey/20-food-the-floor.spec.ts`, run with `JOURNEY_TRADE=food … e2e/journey/01 e2e/journey/02 e2e/journey/20`. Cases H1–H8 are in `docs/qa/journey/CASES.md` (Stage H): stations + tax → a dish per station → two tables → seat, order (two taps = one line of two), kitchen note, send to two stations → work both tickets off the lanes (floor turns "Food ready") → settle 1,134 → a counter takeaway (472.50) → books show 2 sales / 1,606.50 / tax 76.50.

**Three product faults it found (all fixed):**
- **"Add item" opened as a Physical product in a restaurant and at a chemist's** — the form only left `physical_product` when the shop was not ALLOWED it at all, and those shops are. A dish saved that way tracked stock at 0 (unsellable), had no "Made at". Now `catalog/startingItemType.ts` = the first kind the server offers (the trade's own). The comment above the old code said "first"; the code did "any".
- An unnamed takeaway's kitchen card was headed "Takeaway" like every other; now headed by the receipt number (`customer_name` sent by the board, null when none).
- "+ Add table" vanished after the first table; adding one now leaves the layout open.

**A journey is lived once:** a stage is NOT re-runnable from its top on a shop that has already settled its bill (H4 would open a second tab, H8 expects exactly two sales). After a fix, continue with `-g "H3|H4|…"` on the same shop, or start a fresh shop from stage 01. H7 is written to be resumable (it finds the order it already rang).

**Not in the stage yet:** sizes and modifiers on a dish, recipes, split bill, move / merge tabs. Then the other trades' own stages: pharmacy, retail, auto, petroleum, services, online, finance.

Related: [[shopos-the-journey]], [[shopos-line-changes-until-sent]], [[shopos-pass-is-tonights]]
