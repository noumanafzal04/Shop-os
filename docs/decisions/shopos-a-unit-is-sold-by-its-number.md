# A unit is sold by its number — and comes back by it

**2026-10-07 · found by the phone shop's journey, stage L**

A phone shop writes a number down three times: when the box arrives, when it
is sold, and when it comes back. The first two were built. The third was
built on the server and offered by **no screen**, and the screens around all
three let the number go missing in ways nobody had walked.

## What a phone shop met

| Where | Fault |
|---|---|
| Returns desk | Sent a quantity, never a number. A refunded phone stayed `sold` under its IMEI: back on the shelf, refused at the till as "already sold", and — once the sale was refunded — no door could ever free it. |
| Warranty desk | Answered from the dates alone: a phone refunded that afternoon read "Under warranty — 365.9999999999884 days left" beside the name of a customer who had their money back. |
| Exchange | Could not say which unit came in or which went out. The replacement left with no number on its bill — nothing for the desk to find a year later. |
| Till | Took the money for a phone with no number, without a word. Sent numbers from slots the sheet had stopped drawing. Let one number be written on two units. Found nothing when the IMEI on the box was scanned. Offered the phone just sold to the next customer for thirty seconds. |
| Goods-in | Six numbers could be sent against five boxes (the red line said so; the button stayed lit). A number scanned twice was not said. "Receive all" shelved a box of phones in one press with no number against any of them. |
| Dates | Cover was counted from the server's UTC date and judged in UTC — a phone sold at half past midnight in Lahore lost a day. Six months from 31 August ran into March. |

## The rules now

**Which unit came back** — `ProcessSaleReturnAction::unitsComingBack`, and
the same rule in the panel (`sales/unitsBack.ts`) so the sheet asks before the
press instead of being refused after it:

- every unit left on the line is coming back → nothing to choose; all their
  numbers are freed without being asked for
- some are → the shop says which (`RETURN_SERIAL_REQUIRED`), unless the rest
  could be units that left with no number
- more names than units, or a name not on the line → refused

A returned unit is on the shelf again **under its number** — and a number that
was only ever typed at the till is written down when it comes back (it used to
be forgotten, so the till could not offer the phone just handed over).

**Is it covered?** — `SaleItemSerial::isCovered()`: out with a customer (not
returned, on a sale that still stands) **and** inside its window, judged on the
shop's calendar. The desk now has three answers, not two: covered, expired,
and *this unit came back* (with when, and whether it is on the shelf).

**The till asks before the money** — `pos/unitNumbers.ts`. Tender (button and
F9, now one function) opens the numbers sheet when a unit has none, or when a
number is on two units. It does not refuse: "Sell without a number" is a thing
the cashier says, and the chip says "· without" afterwards.

**The number on the box** — `GET /pos/lookup` finds a unit by its own serial
and the line arrives with it written; a second unit of the same model joins
the line. A number that was sold is said to be sold, and on which bill; one
two items share is not guessed at.

**Goods-in** — `purchases/receive.ts`: too many and twice are refused on the
sheet; too few is allowed and said ("2 of 5 will go on the shelf with no
number"). An order holding numbered units or medicines is received on the
sheet that asks — no one-press "Receive all".

## What the old desk left behind

`UnitsBackOnTheShelf` (migration `2026_10_07_000002_units_that_came_back`, and
`php artisan shopos:units-back-on-the-shelf`, safe to run again) mends only
what can be KNOWN: a line that came back in full, and a registry row no
standing sale holds. A line that came back in part with no number said is left
alone — one of its units is back and nothing on record says which.

## Tests

Backend `AUnitIsSoldByItsNumberTest` (31). Panel `unitNumbers`, `unitsBack`,
`receive`, `cover` (unit). Browser: journey stage L (12) and
`e2e/trade.sold-by-number.spec.ts` (4, re-runnable: every unit it sells comes
back before it ends). Mutations: backend 59 (1 equivalent), panel 64, browser
38 (1 equivalent at the screen, caught by the backend) — see RUNS.md.
