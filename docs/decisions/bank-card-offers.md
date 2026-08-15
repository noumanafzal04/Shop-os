# Bank card offers — the plan

**Requested and BUILT 2026-08-15.** The plan below is what was argued with
first; the four open questions at the end are answered in §7, which was written
after the build rather than before it.

> *"Settings mein banks ka CRUD — koi bank card par kuch percent discount de
> raha, ya min amount par, ya fixed ya percentage. POS mein card method select
> ho to card ka number optional aur bank select; bank select kare to backend par
> jo uska discount save hai wo show. Har tenant ke lehaz se — sab ka same nahi
> hoga."*

---

## 0. What this actually is, and why that changes the build

A "bank discount" is **not** a discount the shop is giving. HBL runs *10% off on
HBL cards this Ramadan*; the customer pays 10% less; **the bank reimburses the
shop**. The shop is a channel for somebody else's marketing.

Everything below follows from that one sentence:

- The figure must be **auditable per bank per period**, because the shop is going
  to invoice HBL for it. A discount that only shows up folded into a sale total
  is a discount the shop cannot claim back. **This is the feature.** The POS
  interaction is the easy half.
- It applies to **the card slice**, not the bill. In a split payment — Rs 3,000
  cash, Rs 7,000 card — the bank funds a share of 7,000, not of 10,000.
- It is **not** a promotion. Promotions are the shop's own money and are decided
  by the cart. This is decided by the *tender*, and the money comes from
  elsewhere. Folding it into `promo_discount` would make both figures wrong and
  make the claim impossible to compile.

---

## 1. Two constraints that are not negotiable

### 1.1 The card number: last four digits, never the full one

The request says "card ka number optional". **A full card number ("PAN") must
never be stored, logged, or sent to the server.** Storing PANs puts a shop —
and this platform — inside PCI DSS scope, which is an audit regime, not a
setting. It is also the kind of thing that ends a company when a database leaks.

**What gets stored: the last 4 digits and nothing else.** That is what a receipt
prints everywhere in the world, it is what a bank claim needs to match a
transaction, and it carries no risk worth the name.

So the POS field is labelled *"Last 4 digits of the card"*, `maxlength=4`,
numeric. Not "card number". The label is the control — a box labelled "card
number" will have sixteen digits typed into it by lunchtime on day one.

**The first BIN digits are tempting and must also be refused.** A bank *can* be
inferred from the first six digits, and doing so would save the cashier a tap —
but the first six digits plus the last four is most of a PAN, and the two halves
will end up in the same table. The cashier picks the bank from a list.

### 1.2 Pricing stays server-authoritative

The standing rule in this codebase: **HTTP never supplies a price, a tax or a
discount.** The POS sends `bank_offer_id` (and optionally the last 4). The
server looks up the offer, checks it is live, checks the minimum, computes the
figure and writes it.

The POS **shows** the discount before the sale is completed — that is the whole
point of the request — but what it shows is a *quote it asked the server for*,
not a number it worked out. There is already a shape for this:
`POST /promotions/preview`. This gets the same treatment.

> **Offline:** a bank offer is a rule the shop wrote down in advance, the same
> for every till, with nothing to reserve — by the offline rule
> (`docs/decisions/offline-pos.md`) it is *decidable alone* and could be
> mirrored later, exactly as promotions were. **Not in v1.** Until it is
> mirrored, a cart with a bank offer selected must be refused offline the way an
> unsupported promotion is, or a till prints a receipt that is wrong by the
> discount. Phase it in only after the shadow check has run on it.

---

## 2. Data

Two tables, not one. A bank is a long-lived thing; an offer is a campaign with
dates that gets replaced every few months.

### `banks`

| column | why |
|---|---|
| `id`, `tenant_id` | per-shop by construction — every shop signs its own deals |
| `name` | "HBL", "Meezan", "UBL" |
| `short_code` | printed on the receipt where space is 32 characters |
| `is_active` | banks are retired, not deleted — old sales still point at them |

### `bank_card_offers`

| column | why |
|---|---|
| `bank_id`, `tenant_id` | |
| `label` | "Ramadan 10%" — what the cashier and the claim both see |
| `type` | `percent` \| `fixed` — as asked |
| `value` | |
| `min_spend` | nullable — "on Rs 5,000 and above", as asked |
| `max_discount` | nullable, and it is **not optional in practice**: an uncapped percentage on a Rs 400,000 sale is a number nobody agreed to. Percent offers should default to a cap |
| `card_types` | nullable — some deals are credit-only. Cheap now, painful to retrofit |
| `starts_on` / `ends_on` | a campaign, not a setting |
| `days_of_week` | "weekends only" is the single commonest form of this deal in Pakistan |
| `is_active` | |

**Reuse, do not reinvent:** `PromotionService` already evaluates exactly this
shape — date range, weekday, time window, percent/fixed, min, cap. The offer
engine should be a sibling of it or a shared trait, **not a second
implementation**, or the two will disagree about what "weekends" means within a
year. That drift is the specific failure this codebase has already paid for
once, in the offline pricing mirror.

### On the sale

| column | why |
|---|---|
| `bank_card_offer_id` | what was applied |
| `bank_discount` | the rupee figure, its own column |
| `card_last4` | nullable, 4 chars |

`bank_discount` is a **separate column from `discount` and `promo_discount`.**
Three different people's money: the cashier's, the shop's, the bank's. One
column would make the claim report impossible and the margin report wrong.

---

## 3. Where it appears

**Settings → Payments → Banks & card offers.** A new sub-tab; it is a payments
concern, not a catalog one. Follows the shop's existing conventions — modal for
add/edit, the one shared confirm-delete component, toasts.

**POS:** when the tender is `card` (or a split with a card slice), a compact row
appears — nothing above it moves.

```
  Card                                          Rs 7,000
  ┌──────────────────────┐  ┌──────────────┐
  │ Bank (optional)    ▾ │  │ Last 4 ····  │
  └──────────────────────┘  └──────────────┘
  ✓ HBL Ramadan 10% — Rs 700 off          [server-quoted]
```

- The bank select is **optional and empty by default**. A cashier who does not
  care never touches it, and the tender behaves exactly as it does today.
- The green line appears only after the server has quoted it. If the quote
  fails, the row shows nothing and the sale completes at full price — a
  degraded offer must never block a sale.
- The list shows **only banks with a live offer today**, worst thing first: a
  dropdown of eleven banks where two have deals is a dropdown nobody reads.

---

## 4. The report — the half that pays for the feature

**Reports → Bank claims.** Per bank, per period: how many sales, gross card
value, discount given, and the list with invoice number, date, last 4 and offer
label. Exportable.

Without this the shop hands money to customers and cannot get it back, which
turns a marketing win into a straight loss. **Do not ship the POS half without
this half.**

---

## 5. Order of work

| | | Why this order |
|---|---|---|
| 1 | `banks` + `bank_card_offers` + settings CRUD | Nothing else can be tested without data |
| 2 | The offer engine, sharing `PromotionService`'s window logic | The rules, alone and unit-tested, before any screen |
| 3 | `POST /pos/bank-offer/quote` | Server-authoritative; the POS asks, never computes |
| 4 | Sale columns + write path + returns/cancel reversal | A refund must give back the right figure |
| 5 | POS UI | Only now, once the number it displays is real |
| 6 | Bank claims report | Ships **with** 5, not after |
| 7 | Offline: refuse a cart with an offer selected | Until the mirror exists |
| 8 | Help Centre | Standing rule |

---

## 6. Questions that change the build — answer before step 1

1. **Can a bank offer and a shop promotion apply to one sale?** Both, or the
   larger, or the promotion first and the bank on what remains? The three give
   different totals and different claim figures. *Recommendation: both apply,
   the promotion to the bill and the bank to the card slice of what is left —
   they are different people's money and neither should silently eat the other.*
2. **Split payment:** the card slice is what the bank funds — but does the
   discount then reduce the card slice (so the customer taps less) or the bill
   (so the cash slice shrinks)? *Recommendation: the card slice. The bank is
   discounting its own transaction.*
3. **Is the last 4 required when a bank is chosen?** It is what a claim is
   matched on, so a blank one may make a discount unclaimable. *Recommendation:
   optional but warned, and the claim report flags rows that lack it.*
4. **Who may edit offers?** `settings.manage`, or its own permission? A bank
   offer is money — the same argument that keeps `staff.manage` with the owner.

---

## 7. What was built, and how the four questions were answered

**1. Promotion + bank offer: BOTH apply.** The shop prices the cart (its own
discounts and promotion), and the bank then discounts the card slice of what is
left. "Largest wins" is the wrong shape — it would let a campaign the shop is
PAID for cancel one the shop is paying for, and neither party agreed to that.

**2. Split payment: the CARD slice.** The bank is discounting its own
transaction. `min_spend` is measured the same way, or a shop would promise
"Rs 5,000 and above" to somebody paying Rs 200 by card.

**3. The last four digits: optional, and never a reason a sale cannot
complete.** A cashier with a queue must not be blocked by a reference field. The
claim report counts and FLAGS the rows that lack one — dropping them understates
the claim, hiding them overstates what is collectable.

The rule is `digits:4`, which REFUSES sixteen outright rather than trimming
them. A PAN accepted into the request is a PAN in the logs and in any error
report on the way.

**4. Permission: `coupons.manage` to set up, `sales.manage` to apply.** Exactly
the promotions split. Requiring the marketing permission to HONOUR an offer
would mean the only people who can accept one are the people allowed to
negotiate it — the coupons bug, again.

### The arithmetic, which is the part that goes quietly wrong

| | |
|---|---|
| `total` | **does not move.** The shop parted with the whole bill and is owed all of it — part by the customer, part by the bank |
| the tenders | **drop.** That money physically never crosses the counter |
| `bank_discount` | **its own column**, beside `discount` and `promo_discount` |

Three different people fund those three. A shop that cannot separate them cannot
invoice the bank for the third.

### One thing extracted on the way

`App\Support\OfferWindow` — "is this offer running right now" now has exactly
one implementation, read by both `PromotionService` and `BankOfferService`. Two
copies drift, and this codebase has already paid for that once: the offline
pricing mirror silently stopped applying promotions the server was applying.

The proof it is genuinely shared: one mutation of the midnight-wrapping branch
fails a bank test AND a promotion test.

### Where it lives

| | |
|---|---|
| Set up | **Customers → Bank offers** — beside Promotions, same permission |
| At the till | a row on the tender screen when a card is involved. Bank optional, last-4 optional, whole row absent for a shop with no live deals |
| Claim it back | **Reports → Bank claims** — per campaign, with every invoice number, date and last-4 a bank asks for |

### Offline: refused, for now

A bank offer IS decidable by a single till — a rule agreed in advance, the same
for every till, nothing to reserve. By the offline rule it could be mirrored,
the way promotions were. It is not yet: the catalog pull does not carry offers
and there is no mirror of the engine, so a till that accepted one offline would
print a receipt wrong by the whole discount. The refusal names that honestly and
tells the cashier the customer keeps the discount if they wait.

### Still open

- **Returns and cancellations** do not yet reverse a bank discount specifically.
  A cancelled sale correctly drops out of the claim; a partial refund does not
  reduce what is claimed. **This is deliberately unresolved, not forgotten:**
  most banks reimburse against the transaction that happened rather than against
  what the customer kept, so the current behaviour may already be right — and
  the wrong version of this is a shop over-claiming and losing a bank's trust.
  Settle it with a real bank's letter, not from first principles.

**Done since:** the claim report exports as CSV, one row per SALE rather than
per campaign. A bank reconciles line by line against its own settlement file, so
a summary is what a shop reads and a list is what a bank accepts. `card_last4`
is written blank rather than omitted when missing — a gap in a column is a
question somebody asks, a missing row is one nobody notices.
