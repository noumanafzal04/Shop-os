---
name: shopos-checkout-defaulted-to-pickup
description: "the customer checkout defaulted to PICKUP, so untouched orders never reached a rider; delivery is the default now where the shop delivers"
metadata:
  type: project
---

`CheckoutScreen` had `useState<"pickup" | "delivery">("pickup")`.
`RiderService::beginOffering` only runs for a DELIVERY order — so every order
placed without touching the toggle bypassed the whole rider side, correctly and
silently. `preferredFulfillment()` is the rule now (pure function, exported and
unit-tested): delivery where the shop delivers, never a mode the shop cannot
honour, never overriding a person who has chosen (`chosen` flag).

**Why:** part of the "rider side no order coming" hunt, alongside
[[shopos-default-flip-does-not-reach]] (the live cause) and
[[shopos-rider-pool-had-no-switch]].

**How to apply:** the shop loads AFTER this screen mounts, so the preference is
applied in an effect — and an effect without `chosen` would undo somebody who
deliberately picked Pickup on every refetch. One assignment from one rule:
three sequential `if`s each calling setState in the same run means two overwrite
the third in write order.

**Three test attempts measured something else** before one measured
fulfillment: `accessibilityState.selected` (cannot tell "pickup selected" from
"delivery segment not drawn"); a stale `apiPost` call from the previous test
(module mocks are not reset between tests); and a settle condition on the word
"Delivery", which the summary's "Delivery fee" row renders before any data
arrives. Press the button, read the request.

See [[shopos-orders-live-first]], [[shopos-serves-this-pin]].
