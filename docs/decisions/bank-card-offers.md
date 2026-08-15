# Bank card offers — the plan

**Requested 2026-08-15. Not built. This is the design to argue with before
anybody writes a migration.**

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
