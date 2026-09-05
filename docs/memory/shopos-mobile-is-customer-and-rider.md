---
name: shopos-mobile-is-customer-and-rider
description: "DIRECTION 2026-09-05: the mobile app is CUSTOMER + RIDER in ONE app — no tenant/shop mobile app ever (the web PWA already sells offline); and the brand name must live in ONE constant per repo"
metadata:
  type: project
---

**2026-09-05, the user's decision.** The 42 scaffolded tenant screens in
`mobile/src/modules/{catalog,sales,inventory,expenses,dashboard,shop}` are
**abandoned as a direction**, not paused. The reason is not effort — it is that
the web panel is already a PWA that sells with no network
([[shopos-offline-plan]]), so a second way to run the shop would be a second
place for every till rule to drift.

**What the app IS:** one binary, two hats.

| hat | who | how they get it |
| --- | --- | --- |
| Customer | anybody | sign up, that's it |
| Rider | a customer who applied | uploads documents, gets approved, then a mode switch appears |

Modelled on inDriver: **a rider can switch down to customer; a customer never
switches up without approval.** A plain user stays a plain user forever.

**The structural decision that keeps it from breaking:** a rider is a **USER**,
not a shop's row. Today `riders` is a tenant-scoped name+phone with no login
([[shopos-images-and-riders]] Model A) and it must STAY — a shop that hands
deliveries to its cousin has no app to install. So `riders.user_id` becomes a
NULLABLE link: null = the phone-call rider that exists today, set = the same
person holding the app. Nothing that works today changes shape.

**Two rider populations, one table:** the shop's own (sees only that shop) and
the platform pool (offered any shop's job). `ShopSettings.delivery_provider`
already carries `self|platform` and already says "platform = coming soon".

**The wall applies here too.** A rider profile sits OUTSIDE `BelongsToTenant`
— like `AuditLog` — so every read of an order by a rider needs a hand-written
fence. This is the same shape as the bug in [[shopos-wall-between-shops]], and
a platform rider reading a customer's address and phone is a worse leak than a
dining table.

**Brand name = one constant.** The user expects to rename the product again, so
"change it in one or two places" is a requirement, not a nicety. Today it is
138 hardcoded `CartZe` strings in the panel (mostly `PageMeta title="X |
CartZe"`), a hardcoded `ShopOS` in the mobile sign-in and location-permission
text, and `APP_NAME` on the server. The three storage keys stay frozen forever
regardless — they are data addresses, not branding ([[shopos-cartze-brand]]).

Supersedes the tenant-app half of [[shopos-mobile-design]]; the delivery
architecture in [[shopos-delivery-rider-flow]] is now IN SCOPE rather than
"later".
