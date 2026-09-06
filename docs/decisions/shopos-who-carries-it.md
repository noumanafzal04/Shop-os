# Who carries it

**2026-09-06.** `delivery_provider` now defaults to `platform`, and for the
first time a shop can see the setting at all.

## The state it was found in

The key was in `ShopSettings::defaults()`, in `rules()`, described by a comment,
read by `OrderService` to start the offer engine and by `RiderService` to decide
who may accept — and there was **no control for it on any screen**. A grep for
`delivery_provider` across the whole panel returned nothing.

So every shop had `self`, none of them could say otherwise, and the entire
platform-rider path — the staged widening, `TellShopNobodyTookIt`, the accept
race, the rider board — was written, tested, and unreachable in production.

This is why the user's own order "shop ke paas chala gaya": it was the only
place it could go.

## The half that would have broken silently

Flipping the default alone would have been worse than leaving it.
`delivery_provider` is read on two sides that resolve an **absent key**
differently:

| Reader | How | Absent key |
|---|---|---|
| `OrderService::advance` | `Tenant::setting()` → merges `defaults()` | the default |
| `RiderService::platformShopIds` | `where('settings->delivery_provider', …)` | SQL NULL → **matches nothing** |

Every existing shop's `settings` JSON has no such key. With only the default
moved, `beginOffering` would have fired for every confirmed delivery order and
`openOffers` would have shown it to nobody — the engine running against an empty
pool, ending three minutes later in a "no rider yet" notice with no cause
visible on any screen.

`platformShopIds()` now **asks** `ShopSettings::defaults()` what an absent key
means, so flipping the default back needs one edit, not two.

## Why platform is the right default

A shop that signs up to a marketplace has signed up to its riders. The failure
mode of the wrong default is a three-minute delay, not a lost order:
`TellShopNobodyTookIt` tells the shop it is still waiting and it can hand the
order to its own rider at any point. The order is never stuck and never
cancelled.

Opting out is one control: **Shop Settings → Order fulfillment → Who delivers**.

## What proves it

- `test_a_shop_that_never_touched_the_setting_is_in_the_pool` — asserts both
  halves. Mutating `platformShopIds()` back leaves the notification assertion
  passing and the rider's board empty, which is exactly the silent failure.
- Two existing tests were leaning on `self` being the default and so were
  really testing the default, not the opt-out. Both now state `self` on the row.
- `settingsHaveControls.test.ts` (panel) — every key on `ShopSettings` has a
  control or a stated reason it has none. 56 keys, 48 controls, 8 named
  exceptions. `delivery_provider` was the 9th, and nothing said so.

## The class

A setting with no control raises no error. The screen just does not mention it,
which looks exactly like a screen that is finished. Same family as
[a switch with nothing behind it](shopos-switch-with-nothing-behind-it.md) and
[offered must be reachable](shopos-offered-must-be-reachable.md) — and this one
had a whole subsystem behind it.
