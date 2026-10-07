---
name: shopos-fuel-shelf-is-the-dips
description: 2026-10-07 journey stage N (petroleum, 6/6): tank installed with fuel left shelf at 0; tanker never moved fuel cost; sale-by-rupees unreachable (keypad-only); rate had no "from when"; delivery had no supplier
metadata:
  type: project
---

**Stage N** `panel/e2e/journey/25-petroleum-the-forecourt.spec.ts` (JOURNEY_TRADE=petroleum): fuels + plant, tanker, shift, sale by money, midnight rate, close. 6/6. Findings 73–81 in `docs/qa/journey/RUNS.md`. The shift arithmetic itself was right first time.

**Faults a station would have met (all fixed):**
- **Tank installed with a dip left `products.stock_quantity` at 0** until the first shift CLOSED → diesel "out of stock" on day one. `FuelInTheGround::settle` (stock = sum of active tanks' dips) on tank create/update/remove outside a shift. Every fixture gave the fuel a stock AND the tank the same dip, so no test could see it — [[shopos-forecourt-branch]] again.
- **Tanker never blended `products.cost`** (only PO receive did). Now `MovingCost` on RECEIVED litres.
- **"Rs 2000 ka daal do" lived only on the on-screen keypad's sheet** (`numPad` off by default, toggled inside the tender sheet). Now a "By rupees" chip on ANY weight line; `NumPad keyboard` prop takes a real keyboard.
- Rate form had no `effective_at` (server had it since August; Help said "be there at midnight"). `fuel/rateTiming.ts`.
- Delivery form had no supplier (list column always "—"); one dip was silently dropped.
- Tank "Holds" = first 15 products ([[shopos-page-two]]).

**How to apply:**
- Re-runnable: `e2e/trade.forecourt-counter.spec.ts` (trade-petroleum) SAVES NOTHING (fills each sheet, cancels) — the pattern for specs on shared demo shops.
- Left on purpose: delivery `total_cost` = received × rate (a test says so); by-rupee sales leave paisa between meter value and till ("0 L · Rs 0.13" unbilled).
- A journey shop set up under a since-fixed fault is healed through the app's own API, and RUNS.md says so.

**Next:** services, online, finance.

Related: [[shopos-unit11-status]], [[shopos-job-grows]], [[shopos-the-journey]]
