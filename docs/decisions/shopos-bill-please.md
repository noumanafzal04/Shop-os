# Bill please

**2026-10-10 · the last of the items left after the queue**

"Bill please." A waiter could answer that only by settling the tab. The one
paper with a total on it was the invoice, and an invoice is printed after the
money has changed hands — so the figure was read out off a screen, or the tab
was settled before the customer had seen a number.

And the screen's figure is not the bill. The tab screen says "+ tax at the
bill" because its tax is an ESTIMATE: the subtotal times the shop's default
rate. Its own comment calls an over-estimate safe, since the invoice carries
the real one. A table with tea at 18%, a zero-rated naan and a cola in a 13%
tax group owes something else.

## What it is

`GET /restaurant/tickets/{ticket}/bill` — a slip, printed through the panel's
one print door, on the paper the shop prints receipts on.

- **Not a receipt, and says so twice.** No invoice number, no tenders, no
  cashier — nothing that says money changed hands, because it has not, and a
  slip that looked like a receipt would be one in a customer's hand.
- **Only what is still to pay.** A line settled earlier is on its own invoice;
  the bill says how many items were "paid for earlier and are not on this
  bill", so a split table does not read as items left off.
- **A read.** Anybody who may see the tab may print it — it changes nothing.
- Refused for a closed tab (its invoice is the paper for that) and for one
  with nothing left to pay.

## The figure is the till's

`App\Support\TabBill` is the sale path's own rule for a tab, written once
more: the price is the tab's snapshot; each line is taxed at its product's
effective rate today (tax group, else its own rate, else the shop's default;
nought is exempt); tax is added on top and rounded as it accumulates.

Written once more — which is the thing this codebase does not do without a
test that holds the two together. `TheBillIsWhatTheTillWillAskForTest` bills
a tab, then settles the same tab, and the totals must be one number: five
baskets (one rate, four rates, an awkward price, discounts, all exempt) at
three default rates. If the sale path's arithmetic changes and the bill's
does not, it fails. The browser test goes one further: it reads TO PAY off
the paper and pays exactly that, and the till must take it with no change.

Extracting the tax arithmetic out of `CreateSaleAction` so both could call
it would be better still, and is not done: that function is the money path,
eight hundred lines of it, and this was the last hour of a long day.

## On the screen

*Bill* sits between *Send to kitchen* and *Settle*, in their row — not under
it. The footer is pinned on a phone, and a fourth line of it is a dish the
waiter cannot see.

## Not done

- A bill is not RECORDED as printed. A waiter can print a bill, take cash and
  cancel the tab; the cancel is in the trail, the bill is not. Counting
  prints per tab needs a column and belongs with the reprint log.
- A discount agreed at the table is typed at Settle, so it is not on a bill
  printed before it.

## What the new dishes found

The bill's two fixture dishes sort first on the restaurant's till, and two
older walks had been leaning on whatever used to be there:

- `food.kitchen-slip` waited to SEE the new cart line. On a phone the cart is
  behind its own tab; it had only ever passed because the first dish used to
  open an options sheet. The line is counted now.
- `tillOffers` (shared by the mart, the restaurant and the trade walks)
  pressed the customer chip without showing the cart pane, and on a phone
  waited five minutes for it. It shows the pane first.

Neither was a fault in the till. Both were a walk that passed for a reason
other than the one it was written for.

One new route, one view. No migration.
