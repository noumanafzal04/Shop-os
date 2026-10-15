# A khata payment asks before keeping an advance

Date: 2026-10-15. Reported by the user from Ali Raza's card: owed 4,227.30, paid 4,250 by transfer, and the
screen showed "Payment exceeds the 4,227.30 still owed. Confirm to keep the extra 22.70 as an advance." There
was nothing to confirm with. Bugs L13, L15. Flow: `docs/flows/khata-and-installments.md` part 1.

## What was wrong

The server has always refused an overpayment unless the request says `allow_advance` — a deliberate rule, so a
shop never banks a customer's money without meaning to. The panel never sent `allow_advance` and never asked, so
its refusal surfaced as a toast. The payment could not be recorded at all: not as 4,250, and not as 4,227.30
unless the cashier worked out what to type.

## What it does now

- `KhataBox` (the khata part of the customer card) compares the amount with what is owed **before** sending. If it
  is more, it asks: **Keep 22.70 as advance** (sends `allow_advance`), **Take 4,227.30 only** (sends what is owed),
  or **Change amount**. A customer who owes nothing can be given an advance the same way.
- A balance below zero reads **Advance Rs 22.70** in green — "in their favour, their next credit sale uses it
  first" — instead of "Rs −22.70 owed". The payment box no longer disappears at zero.
- Statement lines say what they are: "Paid · Transfer", "Returned · RET-…" (a return is written as a payment
  with method `return`), "Sale cancelled". A credit sale names its invoice, and the invoice opens the sale:
  `GET /customers/{id}` loads `ledger.sale:id,invoice_number`, and the Sales page opens `?open=<sale id>`
  straight onto that sale's sheet. The customer's purchase history links the same way.

## The answer the user asked for

A credit sale is counted in Sales, Reports and profit on the day it is rung, at its full amount. Money paid
against it later is a collection, never a second sale. Cash collections reach the drawer (`khata_in`); a
transfer, card or wallet collection is in no report yet — that is L14, part 3 of the flow.

## Tests

`CreditSaleTest::test_a_credit_sale_on_the_statement_names_its_invoice` (mutation: drop the `with` → fails);
`customers/khata.test.ts`, `KhataBox.test.tsx` (3 mutations caught: send without asking, keep without
`allow_advance`, an advance read as owed). Walk `qa-kit/p6-khata-advance.mjs` on Zari.
