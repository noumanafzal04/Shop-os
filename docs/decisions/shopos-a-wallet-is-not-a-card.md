# A wallet is not a card, and not a transfer

**2026-09-15 · SHIPPED** · backend `dc19e41`, panel `2eceadf`

## The gap

`PaymentMethod` had eight cases and none of them was a mobile wallet. In
Pakistan that is not an edge: JazzCash, Easypaisa, SadaPay and a Raast
transfer are a daily tender across food, mart and retail.

So it went somewhere. A cashier rang it as `other`, or as `bank_transfer` —
and `bank_transfer`'s own label in `CloseShiftModal` had already drifted to
**"Bank / wallet"**. That drift is the finding. Somebody hit this, worked
around it in a label, and nobody filed anything. A shop closed its day with
one box covering two tenders that reconcile against two different apps, and
the question they actually ask at the counter — *how much came through the
wallet today* — had no answer anywhere in the product.

## The rule it lives under

The offline rule decides this, and decides it cleanly:

> Offline may do only what a single till can decide correctly, ALONE.

A wallet payment is **recorded, never captured**. CartZe has no gateway, so
there is nothing to authorise — precisely the same standing as `card`. The
confirmation arrives on the cashier's own phone over their own data, not
over the shop's line. Nothing is shared with another till and nothing is
reserved. It is therefore in `OfflinePolicy::TENDERS`, and refusing it
during an outage would have taken a daily tender off the counter at the one
event the whole offline feature exists for.

## The money claim

**A wallet payment must leave the drawer exactly where it was.**

`DrawerMath` already summed only `method = 'cash'`, so nothing needed
changing — what needed *proving* is that it stays that way. Get it wrong
and every wallet sale reads as a shortage at closing, arriving at the
cashier as a variance they cannot explain. That is worse than having no
wallet tender at all, which is why it is the test with a mutation pointed
straight at it.

At close the cashier declares the wallet total on its own line and gets its
own over-or-short figure, beside the card one. `declared_tenders` was
already keyed by arbitrary method and varied over the union of declared and
expected, so this needed no new mechanism — only a row in `DECLARABLE`.

## Nine copies of one list

`in:cash,card,bank_transfer,other` was written **nine times**: seven request
classes and two model constants. A list copied nine times is a list that is
wrong in at least one of them the first time it changes, and adding a tender
was that change.

`PaymentMethod::counter()` and `counterOrCredit()` are now the one copy the
request rules read. The model constants (`Expense::PAYMENT_METHODS`,
`Income::PAYMENT_METHODS`, `SaleDocument::DEPOSIT_METHODS`) stay literal
arrays — a `const` cannot call a method — but they no longer decide anything
on their own.

`SyncRequest` needed nothing at all: it borrows `StoreSaleRequest`'s rules
wholesale, so the offline path accepted the wallet the moment the online one
did. That is the borrow paying for itself.

## Half a rule, avoided

Widening the till alone would have left the wallet reachable at one door and
refused at eight. A customer repaying khata by Easypaisa hits a different
endpoint; so does a supplier being paid, a reservation deposit, a dine-in
tab settled, a layaway converted, an expense, an income. All widened.
So was the **sales-list filter** — without it a shop cannot ASK which sales
were paid by wallet, which is most of the reason the tender exists.

## Two things that fell out of the fifth button

**The labels were a default, not labels.** The row read
`m === "credit" ? "Khata" : m === "split" ? "Split" : m === "card" ? "Card" : "Cash"`.
Any tender added to the row would have been drawn, pressed, and called Cash.
Now `METHOD_LABEL`, one copy, with a test that fails if the row draws
anything the map does not name.

**The "Default" badge was hardcoded to cash.** A shop that set Card as its
till default was told two contradictory things at once: the pre-selected
button said Card, the badge under Cash said Default. It follows
`defaultTender` now — which is also where `wallet` became selectable as a
shop's own default (`pos_default_payment`).

Five buttons do not fit across a 360px till, so the split is **stated** —
three then two — rather than left to wrap. Same lesson as the POS footer.

## A test that could not have caught this

`canSellOffline.test.ts` had `it.each(OFFLINE_TENDERS)("takes %s")`. It
reads the very list it is testing, so it passes whatever the list happens to
say — including a list that has quietly lost a tender. It proves every
listed tender is accepted; **it cannot prove a tender is listed.** The
wallet is now named as a literal beside it.

Add it to the same family as the ShapeMatrix blind spot and the `mutate.py`
anchor that matched three presets: a guard reading its own subject.

## Mutations

Seven, all caught, after one that did not apply.

| Mutation | Result |
|---|---|
| Drawer counts a wallet as cash | 3 fail |
| `OfflinePolicy::TENDERS` loses wallet | 1 fail |
| `PaymentMethod::counter()` loses wallet | 6 fail |
| Button row loses wallet | 3 fail |
| "Default" badge pinned back to cash | 1 fail |
| Split sheet loses wallet | 1 fail |
| `METHOD_LABEL` loses wallet | 1 fail |

The offline mutation **passed on its first run.** The regex had omitted a
trailing comma, so nothing was ever removed and the "surviving" mutation was
a measuring stick that had not touched the code. Re-applied with an
assertion on the match count, it failed as it should. A mutation that passes
is a missing check *or* a broken mutation, and the only way to tell is to
assert that it applied.

## Not built

- Naming *which* wallet on the button (JazzCash vs Easypaisa). A shop takes
  several; naming one is how a cashier decides the others do not belong
  there. The transaction id goes in `reference`, which already existed and
  already prints on the receipt.
- Any gateway. This stays a recorded tender. The moment it captures, it
  stops being offline-safe and the whole entry above has to be rewritten.
