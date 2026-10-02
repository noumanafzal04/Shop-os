# One answer to "what do I owe?"

*2026-10-02 — the audit that recomputes every figure a second way, and the three faults it found*

Seven shops at real volume — 6,000-line grocery, 4,800-line pharmacy, a
restaurant with 105 modifier groups — were already being built by
`loadtest:shops`. Volume proves the screens survive. It proves nothing about
whether the numbers on them are right, and **both faults this product has
shipped that cost a shopkeeper money were arithmetic, not volume.**

So `loadtest:audit`: for every figure the product states, compute the same
figure from the raw rows **by a different route**, and say so when they
disagree. 84 checks across seven shops.

---

## 1. "What do I owe?" had three answers again

Naming the column once (`Payable::AMOUNT`, after a grocery was shown Rs 45.6M
of debt for goods on a truck) was half the job. The **rule** — how to net what
arrived against what was paid — was still written out three times:

| reader | rule | on one grocery |
|---|---|---|
| suppliers screen | per supplier, every payment, clamped at zero | 61,623,805 |
| dashboard | **per ORDER**, clamped at zero | **65,998,037** |
| purchases report | per supplier, signed across all of them | 60,672,188 |

The dashboard's is the damaging one, and the case that separates them is
ordinary: **pay the bill, the van turns up two cartons short.** That order is
now overpaid, and clamping *per order* throws the credit away. Rs 4,374,232 of
debt the shop did not have, on the first screen an owner opens.

`Payable::owedByShop()` is the one rule now. Per supplier, because money paid
to a wholesaler is money paid whichever docket it was booked against — and
clamped per supplier, never across them, because being in advance with the
flour merchant does not reduce what is owed to the tea merchant.

The report's figure stays period-scoped on purpose — "what is still owed on
orders placed in these dates" is a different question — but its rows are
clamped per supplier now instead of netting one against another.

## 2. The Pay button paid for goods that never arrived

This is the one that moves real money, and it was hiding behind the fix for
the last one.

`Payable::openOrdersFor` was pointed at the delivery, so an order still on the
truck is no longer even offered to the allocator. `RecordSupplierPaymentAction`
then took, out of the orders it *was* offered:

```php
$due = round((float) $po->total - (float) $po->amount_paid, 2);
```

`total`. The ordered value. So every short delivery was overshot and the money
went out for cartons that never came — **Rs 5,325,848 across 24 orders on one
load-test grocery**, and zero after the fix.

The same line guarded the named-order door (`refuseOverpayment`), so a cashier
could pay 10,000 against an order where 6,000 had arrived and the server said
yes. That is literally the fault the whole payables work was about, still wide
open through the other door.

## 3. A settled short delivery read "partial" for ever

`syncPaymentStatus()` compared `amount_paid` to `total`. Take delivery of six
of ten sacks, pay for six — and the order says **partial**, permanently. The
shop is then chasing a balance it does not owe, and the commonest way that ends
is paying it.

It measures the delivery now. Nothing delivered is "unpaid" whatever has been
handed over: there is no bill to settle, and money paid ahead shows as an
advance on the supplier's account, which is where it belongs.

---

## What the audit checks, and what it refuses to call a pass

Per shop: supplier payables by two routes **and** the dashboard against the
suppliers screen; every khata balance against its own ledger (per customer —
one Rs 500 over and another Rs 500 under sums to zero and is two wrong
accounts); every bill's subtotal against its lines and its total against its
own arithmetic (inclusive tax is *inside* the lines, so adding it again doubles
it); nothing returned more than it was sold and no line refunded past what was
paid; the branch shelves against the product's own figure; every loss valued at
quantity × cost with **unknown staying NULL, never zero**; every points balance
against its ledger.

And then **what the audit had to look at** — the row count of every table it
touched, and which are still empty. A check against an empty table passes, and
a page of passes means nothing until you know how many of them had a subject.
That list is how the whole gap was found: customers, khata, returns, counts,
transfers, write-offs, coupons and points were all zero across seven shops, and
every screen built on them had been green for months against nothing.

Still empty, and named rather than quietly absent: `customer_groups`,
`product_units`, `product_barcodes`, `tax_groups`.

## Two findings the audit got wrong, and how

Worth recording, because both were caught by reading what the rows actually
said rather than trusting the red line.

**"The dashboard says 0.00 on every shop."** The audit read
`['stats']['payable']` and the key is `['money_owed']['payable']`. A missing
key is null, null casts to 0.0, and the check reported a clean, confident,
entirely fictional zero. It asserts the key exists before comparing now.

**"Three customers' points are adrift."** It summed `points_earned -
points_redeemed` off the sales, filtered to `status = completed` — so a partly
refunded sale was dropped entirely, and a refund does not rewrite
`sales.points_earned` anyway: it appends a `reverse_earn` to the ledger, which
is right. The sale earned 48 points and 39 were handed back. The balance lives
in the ledger, and that is what the check reads now; the sales column is
checked separately, against the ledger's `earn` total.

## And five the seeder found about itself

The first run of the extended seeder produced four refusal lines that each
looked like a product bug and was not one. They are listed because the habit —
**count every refusal by reason** — is the only thing that told them apart.

- `0 on the book`, every shop. `amount_paid` is the **tender**, not the cash
  handed over: on a credit sale the single tender is of method `credit`, so it
  is the figure that goes on the book, and the server refuses anything under
  the full due. The seeder prices the basket by ringing it inside a transaction
  that is rolled back — writing a second pricer is the thing this seeder exists
  not to do.
- `This coupon code is not valid` ×60 — at a shop whose trade has no
  `promotions` module, so no coupon table.
- `This item does not track inventory` ×6 — a service shop, asked to put a
  haircut in a van.
- `Please choose at least 1 for "Spice level"` ×82 — the rule working, and the
  seeder ordering food the way nobody orders food. Worse: it meant **not one
  sale in any shop had ever carried a modifier**, so the resolver's pricing had
  never been exercised at volume by anything.
- `Allowed memory size exhausted`, halfway through the fourth shop, leaving a
  half-built pharmacy and an audit reporting *450 of 450 shelves adrift*. The
  query log, in a command that makes hundreds of thousands of queries.

**84 of 84 checks agree.** backend 2,889 tests.
