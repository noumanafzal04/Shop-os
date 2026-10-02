# Change comes out of cash, and only out of cash

**Decided and shipped 2026-10-02.** Found by the load-test seeder, not by
reading: paying by card produced a NEGATIVE `cash_sales` figure on a shop that
had taken no cash at all.

## The problem

`CreateSaleAction` computed

```php
$changeDue = round($amountPaid - $due, 2);
```

and never asked which tender the money arrived on.

That is correct for notes and wrong for everything else. A Rs 1,850 bill keyed
as Rs 2,000 on a **card** recorded Rs 150 of change — and `DrawerMath`
subtracts change from cash takings, because in a cash sale the change does come
out of the drawer. So the till told the cashier to count Rs 150 less than was
there, every time, and a shift that took only cards went negative.

The money is not imaginary either way round: a card is charged the exact bill,
so the Rs 150 was never collected, never refunded, and the drawer carried the
difference as a permanent unexplained short.

## The decision

A sale is refused when the change it would produce exceeds the cash tendered.

```
change = amount_paid − due
cash   = the sum of the CASH tenders (or amount_paid when the only
         payment method named is cash)

change > cash  →  CHANGE_WITHOUT_CASH
```

With no cash tender at all the message is different, because the mistake is
different: *"No cash was handed over, so there is no change to give — charge
the bill, not more."* Otherwise it names the figure: *"Change cannot be more
than the cash handed over (1,000.00)."*

## What is deliberately exempt

**A credit sale.** On khata the single tender is method `credit`, and
`amount_paid` there is not cash in a hand — it is the figure that goes ON THE
BOOK. The server already refuses less than the full due and refuses more
(`CREDIT_EXCEEDS_DUE`), so this guard would only pre-empt a better message.
It skips whenever a credit tender is present.

**A trusted caller.** Offline sync replays a sale the counter already
completed; the money crossed long ago and no refusal can un-cross it.

## Why a refusal and not a correction

Silently clamping the change to the cash would print a receipt that disagrees
with what the cashier typed, and the cashier would never learn that the keypad
entry was wrong. A refusal happens while the customer is still standing there,
which is the only moment it can be fixed.

## Proof

`tests/Feature/ChangeComesOutOfCashTest.php`. Delete the guard and the card
overpayment is accepted again, which is the mutation that matters.
