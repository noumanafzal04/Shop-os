---
name: shopos-unit-sold-by-number
description: 2026-10-07 journey stage L (retail, 12/12): a numbered unit comes back BY ITS NUMBER; refunded phones stayed "sold" for ever; Enter rang the first tile for fast codes (all trades)
metadata:
  type: project
---

**Stage L** `panel/e2e/journey/23-retail-the-serial-and-the-warranty.spec.ts` (JOURNEY_TRADE=retail): goods-in by number, till, warranty desk, refund, one-of-two back, exchange. 12/12. Findings 48–63 in `docs/qa/journey/RUNS.md`.

**The big ones (fixed):**
- The returns desk sent a quantity, never a number → a refunded phone stayed `sold` in `product_serials`: on the shelf, refused at the till, and unreachable once the sale was refunded. Desk said "Under warranty" for the refunded buyer. Now `ProcessSaleReturnAction::unitsComingBack` works out which (asks only when it cannot know: `RETURN_SERIAL_REQUIRED`); `SaleItemSerial::isCovered()`; desk has a 3rd answer `came_back`.
- Old data mended by migration `2026_10_07_000002_units_that_came_back` (DATA ONLY) + `shopos:units-back-on-the-shelf` (`UnitsBackOnTheShelf`); a line back in PART with no number is left alone.
- **Enter in the till search rang `tiles[highlighted]` = the answer to the LAST search** → a code typed faster than the list (any non-digit code) rang the first item on the shelf. Every trade. `pos/enterKey.ts`: Enter waits for the list's answer to THIS term.
- Scanning an IMEI found nothing (now `/pos/lookup` → `serial`); till took money with no number (Tender asks; "Sell without a number"); goods-in sent 6 numbers for 5 boxes.

**How to apply:**
- Re-runnable specs: `e2e/trade.sold-by-number.spec.ts` (trade-retail; NOT serial — each case heals its own shelf) and `e2e/till-enter.spec.ts` (desktop; slows the product list with `page.route` to stand where a scanner stands).
- A SERVER mutation can leave fixture state no door reaches; later mutations then fail on it and look "caught". Heal after each (`shopos:units-back-on-the-shelf`) and check the failing test is the RIGHT one. [[shopos-failed-check-is-not-a-verdict]]
- A forward fix to a "left in a bad state" bug needs a data repair for rows already in that state. [[shopos-half-a-rule]]

Related: [[shopos-retail-depth]], [[shopos-journey-stages-j-k]], [[shopos-the-journey]]
