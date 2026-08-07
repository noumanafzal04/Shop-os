---
name: shopos-business-priority
description: "ShopOS launch priority: FOOD (restaurant), MART (grocery/retail), MEDICAL (pharmacy) are the 3 daily-revenue business types — cover their edge cases FIRST"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-20T12:23:50.078Z
---

On 2026-07-20 the user set the PRIMARY business-type focus for ShopOS launch: **FOOD, MART, and MEDICAL stores** are the three priorities because they generate daily-basis business. All edge cases for these three must be covered FIRST / on priority. Other business types (salon, workshop, service, wholesale, hardware) still matter but come after.

**Slug mapping in the codebase** (`App\Support\BusinessTypes`):
- **FOOD** = `restaurant` business type → items of `item_type = food_item` (modifiers, add-ons, availability windows / serving hours, dine-in vs takeaway, POS food ordering). Features: marketplace + delivery + reservations.
- **MART** = `grocery` ("Grocery & General Store": Supermarket, Mini Mart, Convenience Store) + `retail` → `physical_product` (barcode scan, weight/decimal selling via `sold_by`, fast POS checkout, tiers). Features: marketplace + delivery.
- **MEDICAL** = `pharmacy` ("Medical Store") → `item_type = medicine` (batch/lot + expiry FEFO, `STOCK_EXPIRED` guard, near-expiry alerts, NO modifiers/addons). Features: delivery on, marketplace OFF by default, reservations OFF.

**How this steers the backlog:** when working P1/P2 (see [[shopos-businessos-roadmap]]), order edge-case work by which of these three it protects. Cross-cutting fixes that hit all three daily (timezone for hours/coupons, coupon-aware + decimal returns) rank highest, then FOOD-specific (availability-window enforcement, POS coupon/hold-resume with table), then MEDICAL (remaining batch edges: oversell clamp, variant lots), then MART (fractional-qty guard on unit items, label /kg). Related: [[shopos-delivery-rider-flow]] (future 3-app model — food delivery especially).
