# Money in, litres out

**2026-09-04.** The largest gap left in the petroleum vertical, and the one a
station meets on every single sale.

---

## The gap

Everything else about a forecourt was built — tanks, pumps, nozzles, the shift
that reads every meter and dips every tank, deliveries, rate changes, attendant
attribution, 43 tests. What was missing was the transaction itself.

**Nobody at a petrol pump asks for 7.449 litres.** They hand over two thousand
rupees. The attendant sets the pump to the MONEY and the litres are whatever it
buys. The till could only be told litres, so the cashier needed a calculator
for every customer — and the number they typed was their own arithmetic, not
the shop's rate.

Verified before building: the word "litre" appeared **nowhere** in the panel's
POS, and there was no amount-entry path of any kind.

## The shape of the fix

A sale line may now name `amount` **instead of** `quantity`. The server divides
by its own rate and derives the quantity.

**It is not a price, and cannot be used as one.** The client says what the
customer handed over; the rate is the server's. A bigger amount buys more fuel;
it can never buy the same fuel cheaper. `unit_price` is still refused from HTTP
exactly as before, and there is a test that says so.

Allowed only on `sold_by = weight` items — the set where a fractional quantity
is already legal. Zero migration, and the semantics are right: **if a thing can
be sold in fractions, it can be sold by money.** A butcher's "Rs 500 ka gosht"
is the same interaction; a phone is not.

## The two decisions worth not re-deriving

### 1. The amount IS the gross. It is not recomputed.

Rs 2,000 at 268.50/L is 7.449 litres, and 7.449 × 268.50 is **Rs 2,000.06**.

Six paisa is not a rounding preference:

* the tender no longer covers the bill, so **the server refuses the sale
  outright** — proven by mutation, which turned five green tests into 422s;
* at three hundred sales a day it is thirty-six rupees of drawer variance that
  means nothing. A forecourt is measured twice **on purpose** — meter against
  till finds fuel that left the pump unbilled, book against dip finds fuel that
  left the ground. Adding a third, fictional variance is the opposite of the
  point.

A pump does the same thing: it dispenses until the money display reads what was
asked for, and the litres are whatever they are.

### 2. `amount` is MORE correct offline than `quantity`, not less.

This is the part that surprised me while reading the code.
`CreateSaleAction` re-prices every synced cart **deliberately** —
`trusted_offline` exists precisely so a till can say *when* a sale happened
without being believed about *money*.

A forecourt's rate changes overnight. A sale queued as "7.449 litres" comes
back priced at tomorrow's rate and stops matching the two thousand rupees
actually in the drawer. Queued as "Rs 2,000" the money survives the change and
only the litres move — which is the half a dip reconciliation exists to catch.

## One rule, one copy

The price expression — level, tiers, branch override, pack — used to be written
inline once, which was fine while only one thing asked it. An amount line has
to ask the same question *first*, to turn rupees into litres. So it moved into
`CreateSaleAction::rateFor()`: **two copies of a price rule is two prices.**

Tiers settle in two passes, because the rate depends on the quantity and the
quantity on the rate. A product with no tiers — every fuel there has ever been
— settles on the first. Mutation-proven: capped at one pass, a Rs 5,000 diesel
purchase pays the small-quantity rate for a large-quantity fill.

## Where the invariant lives, and the 49 tests that decided it

The first version put "exactly one of quantity/amount" in `StoreSaleRequest` as
`required_without` + `prohibits`. It broke **every offline sale in the queue**:

```
✘ PosSyncTest — 49 failures
  "operations.0.sale.items.0.amount field is required when items.0.quantity is not present"
```

`SyncRequest` re-keys every rule in that file under `operations.*.sale.` and
does **not** re-key the sibling paths named *inside* the rules. So the rule
went looking for `items.0.quantity` at the root of a sync payload and never
found it.

The invariant moved to the action, which is the one place all three doors go
through — the till, the sync queue, an order being completed. **A request
validates shape and range; an action owns the rule.**

## The till

The quantity pad on a weight line now offers two buttons — the unit, or
**Rupees** — and shows what the money buys before it is committed. The cart line
says *"for Rs 2,000"* beside the derived quantity, because a cashier who typed
2000 has to be able to see that 2,000 is what is being charged and the litres
are the consequence.

Typing a quantity retires the amount: the cashier's last instruction wins.

## Guards

| | |
|---|---|
| `SellByAmountTest` | 13 cases — the exact money, the derived stock, the rate rising, a branch price, tiers, every refusal, and the offline seam |
| `priceCart.test.ts` | the till's own engine, mirroring the gross rule |
| `pricing.json` fixtures | three new carts, **generated on the server**, so both engines are locked to one answer rather than merely agreeing today |

The fixture generator reads the derived quantity back off the sale it just
rang. Deriving it in the fixture file would be a second implementation of the
rule, which could be wrong the same way the first is and would agree with
itself forever — the exact failure that file exists to prevent.

Mutations, all caught:

```
gross recomputed from qty  → five tests turn 422: the tender no longer covers the bill
tier settling capped at 1  → "expected '200.00' … got '250.00'"
offline mirror recomputed  → parity: "expected 2000.06 to be 2000"
```
