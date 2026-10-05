# The amount on the screen is the amount charged

**2026-10-05.** Reported from the till:

```
Amount due   Rs 12,610
Sale failed  Amount paid (12,610.00) is less than the total (14,023.94).
```

…with *"u did not properly test pos screen in detailed."* Correct: the till
had a suite about layout and one browser test about money, a cash sale of
untaxed goods, which could not fail.

## What was wrong

`PosPage.tsx` priced the cart with its own inline copy of the server's rules.
The tested engine (`offline/pricing/priceCart.ts`, held to the server by golden
fixtures) ran beside it only as a shadow. The copy had drifted in five places:

| | screen | server |
|---|---|---|
| tax rate | line rate → shop default | **tax group** → line rate → shop default |
| rounding | summed raw, rounded once | rounded at every addition |
| customer group % | never applied | off before tax |
| customer group level | never applied | prices every unmarked line |
| cash + trade-in | rounded to the coin | exact (two tenders) |
| split, all cash | exact | rounded to the coin |

Short was refused. Over was worse: on a card it was refused with nothing to
press ("no change to give"); on cash it was **recorded at a figure nobody at
the counter saw**.

## What it is now

- **One bill function.** `panel/src/modules/pos/tillBill.ts`, the server's order
  of operations step for step. The page gathers inputs; it adds nothing up.
- **Held to the server by real sales.** `TillBillFixturesTest` rings 22 bills
  through `POST /sales` and writes `tests/fixtures/till-bill.json`; the panel's
  `tillBill.test.ts` makes every one again. Regenerate with
  `SHOPOS_WRITE_FIXTURES=1` and copy to `panel/src/modules/pos/fixtures/`.
- **The till says what it showed.** `expected_payable` (online only). A sale is
  made at that figure or refused with `BILL_MISMATCH` and the real one. Never on
  the offline queue: a sale that already happened must not be refused at sync.
- **Every bill refusal carries the figures** — `PAYMENT_INSUFFICIENT`,
  `CHANGE_WITHOUT_CASH`, `BILL_MISMATCH` — and the till shows the corrected
  bill; the cashier presses Complete again. Never retried automatically.
- **`payable`, not `amount_due`.** `amount_due` is after the bank's help and
  includes goods traded in. A till holds "what the customer hands over": bank
  share still on, trade-in off. Reading `amount_due` asked for a traded-in
  battery twice and, with a bank offer, looped for ever.
- **The lookup names the group.** `/customers-lookup` returns
  `group: {price_level, discount_percent}`, resolved exactly as the sale does.
  Not gated on loyalty any more.
- **A line's level is what the cashier CHOSE.** Unset follows the customer; an
  explicit retail is SENT as retail (it used to be sent as nothing, so a trade
  customer got wholesale anyway).
- **Offline matches the phone exactly**, as the sale does
  (`memberGroupFor`) — a near-match that prices wholesale syncs short.

## The promotion preview was a third copy

`PromotionService::preview` priced the cart itself at shelf price × quantity.
The sale gives a promotion on each line's REAL total. Same number for a plain
line and for no other kind — a quantity break, a trade price, a pack, a line
discount — so ten percent was ten percent of two different figures, and a
spend threshold could promise a discount the sale never gave.

- The preview may be TOLD `items.*.line_total`. Display only: a sale never
  reads it (`ThePreviewIsOfThisCartTest::test_what_the_preview_is_told_never_reaches_a_sale`).
- Offline there was nobody to ask, so the screen showed NO promotion while the
  queued sale applied one. The screen now asks the till's own engine
  (`promotionLocally`) — the same one the queued sale is priced by.

## Left alone

- Money on screen formats as `Rs 4,460.4` (no trailing zero) — a display
  choice across the panel, not a wrong figure.
- `taxableBase` is left unrounded because the server's is. No fixture tells the
  two apart; this is agreement by copying, not by proof.
