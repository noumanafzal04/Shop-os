# A withdrawn module has no rules

**2026-10-06 · found by the QA journey, stage F**

## What happened

The admin switched Coupons & Promotions off for a shop that had a live
promotion in it. The till — which no longer had the module — priced five bars
of soap at Rs 630. The server took twenty percent off, made the bill Rs 504,
and refused the sale as a mismatch. On every soap sale, over a promotion
nobody at the shop could see, edit or end, because its screen was gone.

## The rule

The module map is what a shop HAS. A rule left behind in a module it no
longer has is **data, not policy**: it stays exactly as it was left, and comes
back the moment the module does, but it does not act while its screen is dark.

| Module off | Automatic rules (silently not applied) | Asked for by name (refused out loud) |
|---|---|---|
| `promotions` | promotions | a coupon code → 403 `MODULE_DISABLED`, not spent; online order → 422 `COUPONS_UNAVAILABLE` |
| `customers` | group price level, group discount, points earned | a khata tender → 403 `MODULE_DISABLED`, no debt written; points to redeem → `LOYALTY_DISABLED` |

Refused rather than dropped, where the request names the thing: quietly
ignoring a coupon would charge a customer more than the screen showed.

Never on the trusted path (an order or a dine-in tab being settled): that
replays a total agreed while the module was on.

## Three places, one answer

- `CreateSaleAction` — `$hasOffers`, `$hasCustomers`.
- `OrderService::place` — the coupon step.
- The offline engine — `heldPromotions()` is the ONE reader of the till's
  cached promotions (the sale, its "can I price this offer" check, and the
  shadow check each used to open the store themselves). `shopHas()` gives the
  same answer the till's own screen does: off when the map does not say.

## Tests

`AWithdrawnModuleHasNoRulesTest` rings every case twice — with the module, to
prove the rule in the fixture is live, then without. Journey F2 does it in a
browser: 630 with the module off, 504 again when it is back.
