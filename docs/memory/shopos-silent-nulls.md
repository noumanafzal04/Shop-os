---
name: shopos-silent-nulls
description: STANDING — Eloquent answers a missing ATTRIBUTE with null and a missing RELATION with an exception; scripts/silent-nulls.py hunts the first. Found Sale::customer() missing, which would have thrown on the receipt action's first line
metadata:
  type: feedback
---

`$product->branch_id` on a model with no such column returns **null**. No error,
no warning, no log. A typo, a renamed column or an assumed field behaves exactly
like a field that is legitimately empty — and this app is full of legitimately
empty fields.

Nearly written into `SyncProductVariantsAction`; the user's response is the
reason the scanner exists: *"iska matlab aur pages par bhi miss ho sakti."*

`scripts/silent-nulls.py` judges every read whose variable NAMES its model
(`$product->x` against `Product`) against columns + casts + accessors + relations
+ `$appends` + anything assigned as `$x->foo =` anywhere (this codebase stamps
`branch_price`/`branch_stock` on before serialising). Ambiguous reads are counted
as **UNJUDGED** and printed as a denominator rather than guessed at. `--prove`
blinds it and requires all 836 judged reads to be reported — allowing framework
names through made a fully blinded scanner still look 68% right, which is not a
shape anybody would recognise as broken.

**836 judged · 1 real finding:** `Sale` had **no `customer()` relation** while
`sales.customer_id` had existed since the table was created. The only caller,
`SendSaleReceiptAction`, opens with `loadMissing('tenant','customer')` — so it
would throw `RelationNotFoundException` on its FIRST line. It has no callers, so
the throw had never happened: SMS/email receipts were built, wired to nothing,
and would have failed the moment anybody wired them.

**Why:** a missing attribute is silent; a missing RELATION throws. The silent one
is the one nobody notices, so that is the one worth a scanner.

**How to apply:** the other seven findings were `withCount` and
`selectRaw … as alias` — real manufactured attributes. Both were taught to the
scanner, because a tool that cries wolf five times is not opened the sixth.

Related: [[shopos-detector-vs-rule]], [[shopos-promise-in-another-file]].
