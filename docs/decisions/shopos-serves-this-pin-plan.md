# PLAN — "Does this shop serve where I am standing?"

**Written 2026-09-09. NOT SHIPPED — this is the flow, agreed before the work.**

Asked for as: *"location ki base py shops show hongi or products, mean hr city
k lehaz sy — or specific radius tk delivery hr shop ki, k hr shop kitni door tk
delivery dy skti, like foodpanda."*

Two fences, and the app currently applies neither to a list.

## What is already here

| Piece | State |
|---|---|
| `delivery_radius_km` shop setting | **exists** (`ShopSettings`, `null` = "city-wide"), panel control at Shop Settings → Order fulfillment |
| Checkout refusal outside the radius | **exists** — `OrderService`, `OUT_OF_DELIVERY_AREA`, names the shop's km and the customer's |
| `delivers_to_me` on ONE shop | **exists** — `GET /marketplace/shops/{slug}` when the caller sends a pin |
| GPS → city | **exists** — `/marketplace/locate`, `locationStore` holds `city` |
| `city_id` as an optional filter | **exists** on home, shops, browse, categories |

## What is missing — and it is the same thing three times

**Nothing that returns a LIST asks either question.** `home` (nearby, top
rated, deals), `shops` and `browse` (the product aisle) all list every
marketplace-visible shop in the country, sorted by distance when a pin is sent.
So:

- A shopper in Karachi is shown Lahore shops, further down the same list.
- A shop 30 km away with a 5 km radius is listed, tapped, filled with a basket,
  and refuses at **checkout** — the last possible moment.
- The app never sends `city_id` at all. `useHomeFeed` passes `lat`/`lng` only.
- `ShopSettings` says `null = no distance limit (city-wide)` and **nothing
  enforces the city half of that sentence.** A promise implemented nowhere —
  the shape this codebase keeps finding.

## The rule to implement

> A shop is listed if it can serve THIS pin: same city, and — for delivery —
> within its own `delivery_radius_km`.

Written **once**, as a query scope on `Tenant`, and called by every list.
`marketplaceVisible()` already proves the pattern works; the reason to insist on
one copy is `RiderService::platformShopIds()`, where the same key read two ways
offered every order and showed it to nobody.

### Decisions

1. **City is a hard fence, radius is the finer one.** City first: it is an
   indexed FK column, so it cuts the set before any trigonometry. A pin with no
   resolvable city (out of service area) falls back to distance alone rather
   than to an empty page.
2. **`null` radius means the shop's own CITY, not the country.** That is what
   the setting's own comment has always claimed. Anything else means a
   null-radius Lahore shop is offered to Karachi.
3. **A shop out of delivery range is not deleted from the world.** If it does
   pickup, it stays listed and says **"Pickup only — too far to deliver"**.
   Delivery-only and out of range: dropped from the list. Foodpanda greys these
   out; dropping them entirely is a smaller change and can be revisited.
4. **The same vocabulary everywhere.** `delivers_to_me` is already the name on
   the shop detail payload, so the card, the list and the aisle use that field —
   not a second flag meaning the same thing.
5. **Products follow their shop.** The aisle joins `tenants`; the scope applies
   there, and the facet counts must be computed from the SAME scoped query or
   the rail says "Food 24" over a list of 6.
6. **Never a silent empty page.** "No shops deliver to *Gulberg, Lahore* yet" +
   a way to change the pin, and the count of shops that were within the city but
   out of range, so the sentence is a fact rather than a shrug.

### SQL shape

```
city:   where('city_id', $cityId)
radius: whereRaw(
          "(COALESCE(json_extract(settings, '$.delivery_radius_km'), 1e9)) >= {$distanceExpr}"
        )
```

`json_extract` is spelled the same on MySQL 8 and SQLite, which is what the
tests run on. `Geo::sqlDistanceKm` already exists and is the only place the
haversine is written.

## Phases

1. **`Tenant::servesPin($lat, $lng, $cityId)`** + `Geo` helper, with tests
   first: same-city in-range, same-city out-of-range, other-city, null radius,
   no pin, no city, shop with no coordinates.
2. **Wire the three lists** — `home` (nearby + top rated + deals), `shops`,
   `browse` + `facets`. Every payload carries `delivers_to_me` and
   `distance_km`.
3. **App sends the city** — `useHomeFeed`, `useMarketShops`, `useBrowse`,
   `useUniversalSearch` all pass `city_id` beside the pin, and the query keys
   include it (a key that omits it serves Karachi's answer to Lahore).
4. **Say it on the card** — "Pickup only" chip, and the empty state above.
5. **Panel** — the control exists; the HINT must say what `null` means now
   ("your whole city"), and Shop Settings should show the shop's own pin beside
   it, because a radius is meaningless if the shop's coordinates are wrong.
6. **Help Centre** — both sides (`panel/src/modules/help/content.ts`,
   mobile `HelpScreen`): why a shop I saw yesterday is gone, and how a shop sets
   how far it delivers.

## How it must be able to fail

- Delete the city fence → a Lahore shop appears for a Karachi pin.
- Set one shop's radius to 1 km → it leaves the list, and its products leave
  the aisle, and the facet count drops by one.
- Make `null` mean "no limit" again → the cross-city test fails.
- Drop `city_id` from a query key → the second city's list is served from the
  first city's cache.
- Scope the listing but not the facets → the rail's number disagrees with the
  page (the bug class `browseQuery` was written to prevent).

## Not in scope

Rider offer radii (`RiderService::MAX_RADIUS_KM`) are a different question — how
far a RIDER will go, not how far a SHOP delivers — and stay untouched. A live
map to draw the radius on is still the pending MapLibre task.
