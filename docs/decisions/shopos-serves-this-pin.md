# Does this shop reach me — SHIPPED

**2026-09-09.** Plan: `shopos-serves-this-pin-plan.md`. This is what was built,
and where it differs from the plan.

## The rule

`Tenant::scopeServesPin($lat, $lng, $cityId)` — one scope, called by `home`,
`shops` and the product aisle (which shares it with its facet counts):

- **city** is a hard fence when it resolved (indexed FK, cuts before any
  trigonometry);
- a shop that **delivers** must have the pin inside its own
  `delivery_radius_km`;
- a shop that **does not deliver at all** is fenced by `CITY_WIDE_KM` (35) —
  you can go and collect it, but not from the next province;
- a shop with **no coordinates** is kept: unmeasurable, not refused.

`null` radius means the shop's own city, which is what `ShopSettings`' comment
has claimed since the setting existed and nothing enforced. `deliversTo()` is
the same question answered in PHP, so a card cannot promise a delivery the
checkout refuses; `delivers_to_me` now rides on the list payloads under the
name the detail payload already used.

## One decision reversed from the plan

The plan said a shop out of delivery range but pickup-capable **stays listed**
as "Pickup only". Built that way first, and it made the fence useless:
`pickup_enabled` defaults to **true**, so nearly every shop passed and nothing
was filtered. **A fence that lets everything through is worse than none — it
reads as done.** Pickup earns a shop the CITY, not an exemption from distance.

## In the aisle, the pin is part of the city axis

Both are dropped when the CITY facet is counted. A facet reading "Lahore (12)"
exists so somebody can switch to Lahore; counting those twelve against a
Karachi pin answers "(0)" for every city but the one they are in — a rail that
can only ever tell you to stay put. Every other facet keeps the fence, or the
rail says 24 over a list of 6.

## The app sends both halves, from one place

`useServingPin()` — `{ lat, lng, city_id }`. The app had been sending the pin
and **never the city**. Four hooks need it and three are called from more than
one screen: seven places to forget one field. In the aisle it goes on the
BASE, never on the filters — on the filters side one Reset would widen the
list to shops that cannot deliver here. The city is in every query key, or
react-query serves Karachi's answer to somebody who just moved their pin.

## Two of my own tests were weaker than they claimed

Mutation testing found both:

- the city test put the other city 1,000 km away, so the DISTANCE fence
  dropped it and the test passed with the city fence deleted. The other city's
  shop is 5 km from the pin now: a city is an administrative fact, not a
  distance.
- the boundary test placed a shop at 9.9 km with a 10 km radius, which `<`
  also satisfies. It is now asserted 50 m either side, and the file says
  plainly that `<=` versus `<` at an exactly equal double is **not
  observable** through SQL floating point — `Geo::distanceKm` rounds to two
  decimals and the SQL haversine does not — so it is not claimed.

11 mutations, 10 caught, 1 documented as unobservable.

## Also fixed, same day

**"Rider side no order coming."** `rider_profiles.is_platform` defaults to
FALSE and was writable in exactly one place — the apply payload — while
`apply()` refuses an approved profile and the admin screen only serialises the
field. A rider whose application went through without the flag was invisible
to the pool for ever, with no control anywhere and nothing on any screen
naming it. `PUT /rider/pool` is the exit, and `RiderService::offerBlock` names
one of six reasons the board is empty (five fixable) where before all six drew
"No deliveries near you". Leaving the pool does not touch work in hand.

**"On click on line it a taking time to be online."** The duty switch awaited
a high-accuracy fix before telling the server anything: 12 s for satellites
plus an 8 s fallback, with the row still reading "You are offline" because the
mutation had not been sent. One quick attempt now (5 s, no retry, cached fix
accepted), then online with whatever came back; the heartbeat corrects the pin.

Backend 2701 passed / 2 skipped · panel 1522 · mobile 760 · APK
`cartze-1.0.6-b11.apk` (versionCode 7).
