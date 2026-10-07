# Fuel on the shelf is what the dips say — and the forecourt's other doors

**2026-10-07 · found by the petrol pump's journey, stage N**

A forecourt's shift arithmetic (meters against the till, book against the
dip, test litres, a rolled meter) was right, and the closed shift reads the
way a station needs it to. What was wrong was around it: four things the
server could already do with no screen that asked, and one sentence the close
said that installing a tank did not.

## What a station met

| Where | Fault |
|---|---|
| Tanks & pumps | **A tank installed with fuel in it left the shelf at nought.** Stock only followed the ground when a shift CLOSED, so on the first morning the till called the station's own diesel out of stock, and a tanker's cost was blended against an "empty" tank that was a fifth full. |
| Deliveries | **A tanker never moved what the fuel cost.** `products.cost` was only ever blended by a purchase order, and a forecourt buys nothing on one — its petrol stayed at the cost typed the day it was carded, through every fortnightly rate. |
| Till | **"Do hazaar ka daal do" could not be rung** on an ordinary till. Selling by money lived only on the on-screen keypad's sheet, opened only when the keypad was on — off by default, and switched from inside the tender sheet. |
| Rates | **A rate could only be entered for the moment it was saved.** The server has held a rate until its hour since August; the form had no box for the hour, and the Help told the owner to be at the screen "at the moment it takes effect" — midnight. |
| Deliveries | The list has a Supplier column and the server takes one; the form never asked, so every row read "—". One dip without the other was dropped in silence and the load received on the invoice. |
| Tanks & pumps | "Holds" listed the first fifteen items of the catalogue — on a station with a tuck shop, perhaps not its own petrol. |

## Now

- `FuelInTheGround::settle` — a fuel's stock at a branch is the sum of its
  active tanks' dips, said wherever a dip is WRITTEN outside a shift: a tank
  installed, re-dipped, switched to another fuel, taken out of use, removed.
  Inside a shift the close does it, as before. A fuel the station does not
  count is left alone.
- `RecordFuelDeliveryAction` blends the fuel's cost with `MovingCost` on what
  ARRIVED, exactly as a purchase order does. No rate given → the cost is left.
- Any line sold by weight or volume carries a **By rupees** chip (a kiryana's
  sugar sack too); the sheet takes a real keyboard (`NumPad keyboard`).
- New rate: **Now** or **At a time** (midnight tonight offered; an hour that
  has gone is refused). A rate that is waiting says "Not at the pumps yet".
  `fuel/rateTiming.ts`.
- Record delivery: **From** (where the shop keeps suppliers); one dip is said
  and cannot be sent.

## Left as it is, and why

- A delivery's `total_cost` stays *received × rate* — the value of what went
  into the ground. The supplier's bill is for the invoiced litres; the gap is
  the shortage, stored in litres so it can be argued later.
- By-rupee sales leave a few paisa between the meter's value and the till's
  (Rs 2,000 is 6.897 litres, which is Rs 2,000.13 at the meter). It shows as
  "0 L · Rs 0.13" unbilled. Honest, and the litres are what matter.

## Tests

Backend `FuelManagementTest` (+11: shelf follows ground, cost blend). Panel
`rateTiming.test.ts`, `localInput.test.ts`. Browser: journey stage N (6) and
`e2e/trade.forecourt-counter.spec.ts` (3 — it saves nothing, so it leaves the
station exactly as it found it).
