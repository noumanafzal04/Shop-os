# A payment the screen could actually make

**2026-08-30**

## What was wrong

The Suppliers list has a **Pay** button. It sends an amount and a method and
nothing else — there is no order picker on it and never has been.

`RecordSupplierPaymentAction` accepted every one of those payments: it filed the
row, took the cash out of the drawer, and applied it to **nothing**. A supplier's
Outstanding was computed as

```
sum(purchase_orders.total) − sum(purchase_orders.amount_paid)
```

and `amount_paid` only ever changes when a payment names an order. So the red
figure on the row did not move. The shopkeeper pays, sees the same amount owed,
and pays again.

### Why 2,373 green tests never saw it

Every payment test in the suite passed `purchase_order_id`:

- `PurchasingTest::test_supplier_payment_updates_po_and_balance`
- `MartTenantWalkthroughTest` (three calls)
- `ReportsExpansionTest::test_purchases_report_totals_and_by_supplier`

The API had a door the UI does not use, and that door was the only one under
test. `PaymentOnAccountTest` now tests the door the screen actually opens; all
seven of its checks failed on the unfixed code.

## What "owed" means now

Three places answered *what does this shop owe its suppliers* and they disagreed:

| Reader | cancelled | **draft** |
|---|---|---|
| `Supplier::withOutstanding` — the row, the Pay button | excluded | **counted as debt** |
| `DashboardService::payable` | excluded | excluded |
| `ReportService::purchases` | excluded | **counted** |

A draft is a basket somebody is still filling. Counting it put a red figure and
a Pay button on a supplier the shop owed nothing to, while the dashboard said a
smaller number for the same account.

`App\Support\Payable` now draws that line once and all three read it. An order
becomes a bill when it is **placed**.

## The balance is signed

```
outstanding = placed order totals − ALL payments to the supplier
```

Not `amount_paid`. The difference is money that has not landed on an order:
a wholesaler's van arrives, cash changes hands, nobody raises a PO. That is the
commonest payment a small shop makes, and `CashMovementTest` has covered it
since August — a Rs 3,500 cash payment to a supplier with no orders at all.

Positive is owed. **Negative is an advance**, exposed as its own `advance`
attribute and shown on the row as "Rs 3,500 in advance". Refusing that payment
would have been the easy consistency and the wrong one.

## Allocation

An on-account payment settles open placed orders **oldest first** — the order a
shop and a wholesaler both keep the account in, and the order a supplier chases.
`po_number` breaks same-day ties so a replay lands identically.

- The payment row names the order when the whole amount landed on **one**;
  null when it spanned several, which is what an on-account payment is.
- **One** cash movement per payment, however many orders it settled.
- A payment aimed at a **named** order is still held to that order's balance —
  the caller quoted a figure that can be checked.
- A **draft or cancelled** order cannot be paid against (`PO_NOT_PAYABLE`).

## What the shopkeeper sees

The dialog now shows the balance, and the moment an amount is typed it says what
will still be owed **after** it — the number the screen never showed. Plus a Pay
full shortcut, an order picker when there are open orders, a date, and a
reference for a cheque or transfer. Overshooting says so in words: "Rs 500 more
than is owed — recorded as an advance."

The arithmetic lives in `payMath.ts`, not in the component, so it can be tested
and so a second screen showing the same line cannot drift from it.

## Not done

Unallocated advance does **not** auto-apply to a later order at the moment the
order is placed — the balance is correct immediately (the sum accounts for it),
but the new order's own `payment_status` still reads unpaid until a payment is
recorded against it. Automatic settlement needs an allocation ledger, which is
more machinery than a launch needs.
