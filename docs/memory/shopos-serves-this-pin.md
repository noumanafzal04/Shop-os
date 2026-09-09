---
name: shopos-serves-this-pin
description: "PLANNED (not shipped): shops/products listed only if same city AND within the shop's own delivery_radius_km; one scope, three lists"
metadata:
  type: project
---

**PLANNED 2026-09-09, agreed before the work.** Full flow in
`docs/decisions/shopos-serves-this-pin-plan.md`.

Asked for as "location ki base py shops show hongi or products, hr city k lehaz
sy — or specific radius tk delivery hr shop ki, like foodpanda".

**The rule:** a shop is listed if it can serve THIS pin — same city, and for
delivery within its own `delivery_radius_km`. Written ONCE as a `Tenant` query
scope (`servesPin`) and called by `home`, `shops` and `browse`+`facets`.

**Why:** `delivery_radius_km` already exists and is enforced at CHECKOUT only
(`OUT_OF_DELIVERY_AREA`) and on single-shop detail (`delivers_to_me`). No list
asks either question, so a Karachi shopper sees Lahore shops and a 30 km shop
with a 5 km radius refuses only after a basket is built. The app never sends
`city_id` at all.

**How to apply:**
- `null` radius = the shop's own **city**, not the country — which is what
  `ShopSettings`' own comment has always said and nothing enforced.
- City fence FIRST (indexed FK), then the distance expression;
  `json_extract(settings, '$.delivery_radius_km')` is spelled the same on MySQL
  8 and SQLite.
- Out of range but pickup-capable = listed as "Pickup only", not deleted.
- Facet counts MUST come from the same scoped query, or the rail says 24 over a
  list of 6.
- Every query key must include `city_id`, or one city is served the other's
  cached answer.
- Rider offer radii (`RiderService::MAX_RADIUS_KM`) are a different question and
  stay untouched.

See [[shopos-half-a-rule]], [[shopos-promise-in-another-file]],
[[shopos-nearest-branch-fills-it]], [[shopos-the-aisle]],
[[shopos-approximate-is-allow]].
