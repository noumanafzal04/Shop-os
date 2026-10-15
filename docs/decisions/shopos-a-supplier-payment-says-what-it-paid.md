# A supplier payment says what it paid — on the supplier and on the order

Date: 2026-10-15. The user: "supplier ko jb pay kia jata hai to uski total amount ya remaining amount show hoti
… agar partially pay kia jata hai to uski detail show ni hoti, uski history kb kitne pay kiye thy or kaise —
koi record ni on supplier and purchase main." Bug L9.
Code: backend `offline/v1/backend`, panel `offline/v1/admin-panel` (see the commit that names L9).

## What was wrong

- The API already sent `payments` on a supplier and on an order; no screen drew them. The order said "Paid
  1,000 · partial" and its total; the supplier's row said what is owed. A part payment's date, amount and method
  were on no screen.
- Worse, the record itself was missing for the common case. A payment "on account" (the Suppliers screen's
  default) is spread over the supplier's orders oldest first; when it touched more than one, it named none
  (`purchase_order_id` null) and only raised each order's `amount_paid`. No order could say which payments made up
  what it shows as paid.

## What it is now

- `supplier_payment_allocations` (payment, order, amount) — migration `2026_10_15_000002`, additive. Written by
  `RecordSupplierPaymentAction` from the same `$applied` that raises `amount_paid`, so each order's allocations add
  up to its paid figure for every payment from now on. It is the only writer of `amount_paid`.
- `GET /purchase-orders/{id}` sends `allocations` (oldest first, each with its payment's date, method, reference,
  amount); `GET /suppliers/{id}` sends each payment's `allocations` (with the order number) and the order it named.
  Both are supplier money: stripped for the stockroom like the rest (`supplierMoneyKeys`).
- The order (Purchase Orders → open one): Ordered · Arrived — the bill · Paid · Left to pay, then every payment:
  date, method, reference, the share, and "part of a Rs X payment" where it also paid other orders. Older payments
  that named this order alone are listed whole; what is still unexplained (a pre-15-Oct payment on account) is one
  line, "Paid on account earlier", so the list always adds up to Paid.
- The supplier (Suppliers → History): what is owed or paid ahead; every payment with the orders it paid and how
  much of each ("Paid ahead" for the rest), an older one with the order it named or "On account"; every order with
  bill, paid and left. Latest 20 of each.

## Proof

`ASupplierPaymentSaysWhatItPaidTest` (2 tests; 4 mutations caught): 1,000 cash against the first order, then 3,500
by bank on account → the first order's history is [1,000 cash 11 Oct, 2,000 bank 14 Oct IBFT 7781], the second's
[1,500 bank]; each adds up to its paid figure; the supplier's payment lists both orders; the stockroom is not sent
it. Panel: `OrderPayments.test.tsx` (4; 4 mutations), `SupplierHistory.test.tsx` (1; 3 mutations). Walked
(`qa-kit/p6-supplier-history.mjs`, Zari): Faisalabad Mills owed 10,000; paid 2,000 by bank on account (QA-HIST-1) →
owed 8,000; it landed on PO-000001 (Paid 2,000, Left 4,000); PO-000002 lists its two 13 Oct payments (1,500 cash,
15,000 bank) = Paid 16,500, Left 4,000.

## Deploy

`php artisan migrate` (one new table). Already run on the dev database.
