# Out of stock is not a dead button — at a chemist's, it asks for the same salt

**2026-10-07 · found by the chemist's journey, case K7**

## The fault

The till has had a sheet, "Same salt, in stock", since the pharmacy work: when
the brand is out it lists what else on the shelf has that salt. It opens from
the place a product is rung.

An out-of-stock tile is a **disabled** button. The press that was meant to
open the sheet never arrived. The only way in was to arrow down to the
product and press Enter — on a tablet, where a chemist's till is, the feature
did not exist. The journey's finger timed out against a dead button.

## Now

`offersEquivalent()` in `pos/availability.ts`: a MEDICINE, at a chemist that
keeps stock, not 86'd by hand, stays pressable when it is out. The tile says
"Out — tap for same salt"; the row says "Same salt?". It still cannot be
rung — the tap opens the sheet. The same rule decides it in `commitProduct`,
so the tile and the keyboard cannot disagree.

Two more from the same run:

- **A notice about one customer's medicine stayed for the next.** "℞ needs a
  prescription", "batch expires in 20 days", "Substituted with…" were only
  ever taken down by the ✕. What is said of a LINE now goes with its sale;
  what is said about the till (a receipt that did not print) stays. The first
  version of the fix read a ref inside a state updater, after the ref had
  been cleared — the browser case caught it; nothing else would have.
- **The batch list called a lot EXPIRED on its last good day**, from five in
  the morning: `new Date("2026-10-07") < new Date()`. `isPastDate` in
  `common/shopDay.ts` — the date on the shop's wall, as the till judges it.

## Tests

`availability.test.ts` (+4), `shopDay.test.ts` (+4), the journey's stage K
(8 cases), and `e2e/trade.same-salt.spec.ts` — the same thing somewhere it
can be run every time, selling nothing so its shelf never runs down.
