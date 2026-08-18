---
name: shopos-moving-cost
description: "products.cost is now blended (weighted average) on PO receive; it used to be typed once and never move, making every margin report wrong"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T10:07:31.032Z
---

**Shipped 2026-08-16** (audit item 20, found by reading the MART trade — the one
that reaches every shop that buys stock).

Every margin/profit/COGS figure comes from `products.cost`, and **nothing ever
wrote to it except a human on the product form.** `ReceivePurchaseOrderAction`
touched `cost` only to stamp a batch. A kiryana's sugar cost stayed at March's
rate all year while every delivery recorded its true price on the PO line.

`App\Support\MovingCost::blend()`, applied in `ReceivePurchaseOrderAction`.

**Invariants not to break:**
- **Weighted average, NOT last price.** The shelf holds both. A last-price rule
  overstates while cheap old stock sells and understates on one odd discount.
- **Never blanks a known cost** — a delivery with no price is missing
  information, not free goods.
- **Blend per BASE unit** (`unit_cost / factor`) or a pack price multiplies the
  error by the pack size.
- **Variants blend against the variant's own stock**, not the product's.
- The pre-receive quantity must be captured BEFORE `inventory->adjust()`.

Companion finding: [[shopos-recipe-cost]] does the same job for made-to-order
dishes (a dish's cost comes from its ingredients, not a typed number).

Full reasoning: `docs/audit-2026-08-12/VERIFIED.md` item 20.

Related: [[shopos-recipe-cost]], [[shopos-business-priority]].
