---
name: shopos-delivery-rider-flow
description: "FUTURE (not yet built): 3-app delivery model — customer + vendor + rider apps, rider assignment engine, live GPS tracking, WebSocket/FCM realtime"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-20T12:17:15.443Z
---

On 2026-07-20 the user shared a Foodpanda/Uber-Eats-style **three-app delivery architecture** as a direction to build **later on** (NOT current scope — current focus is P0 launch-hardening of the admin/tenant web panel; mobile is last). Capturing so it isn't lost.

**The three apps over one shared backend** (realtime via WebSocket + push/FCM):
1. Customer app · 2. Vendor/Restaurant app · 3. Rider app

**End-to-end order lifecycle (richer than today's OrderService):**
`Pending → Restaurant Accepted → Preparing → Rider Assigned → Picked Up → On The Way → Delivered`
(today's `OrderService` lifecycle is pending → confirmed → preparing → ready/out_for_delivery → completed; this flow adds the rider leg between prep and delivery.)

**Rider assignment engine (the new piece):** on restaurant-accept, find riders that are Online + Not-Busy + within radius (e.g. 3 km of restaurant), sort by distance, offer to nearest with a 15–30s accept/decline timeout; on decline/timeout cascade to the next. Variant: broadcast to several nearby riders at once, assign to first accept. Persist `order_id → rider_id` on accept.

**Live tracking:** rider app POSTs GPS (`{lat,lng}`) every few seconds → backend stores latest → customer app gets live position over WebSocket, shows moving rider on a map.

**Stack the user named:** Laravel (they're on Laravel already — NOT Django despite the doc mentioning it) REST API; MySQL; Redis for queues/cache/ephemeral rider state; FCM for push; WebSockets (Laravel Reverb — already flagged as the optional realtime layer in [[shopos-businessos-roadmap]] Phase 5) for status + tracking; Google Maps API for maps/routing/distance.

**Gap vs. today:** ShopOS has customer ordering + vendor order management + delivery fulfillment config + FCM push foundation, but NO rider app, NO assignment engine, NO live GPS tracking, NO WebSocket server stood up. All three are net-new when this phase starts. Also note the standing decision (NO online payments — COD only) still applies unless revisited. Related: [[shopos-mobile-design]].
