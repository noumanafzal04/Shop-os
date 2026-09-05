---
name: shopos-commission-and-push
description: "2026-09-06 SHIPPED: commission engine (rate is a SNAPSHOT, online orders only, at completion); FCM rewritten for HTTP v1 (legacy died July 2024); rider MODE replaces the navigator"
metadata:
  type: project
---

Full write-up: `docs/decisions/shopos-commission-and-push.md`.

## Commission — the platform's cut

Two debts, never confused: the **plan** is the software subscription; the
**commission** is a share of what the marketplace sold. Charged on
`channel = 'online'` orders **only**, at **completion**, never at placement.

**The rate and the base are SNAPSHOTS** on `commission_charges`. Change the
platform rate tomorrow and last month's invoice must not move. Base = goods
after discount; the delivery fee is left out because it is the rider's money.

Off by default, and **off is not zero** — pausing billing must not lose the
agreed number. One charge per order behind a unique index. Invoices are
**voided, never deleted**, and voiding returns the charges to outstanding.
`commission.manage` is its own platform permission, deliberately not
`billing.view`: reading revenue is not deciding it.

A shop checks its own bill order-by-order on Subscription. See
[[shopos-plans-and-flow]] for the plan half.

## FCM was talking to a dead endpoint

Legacy `POST /fcm/send` — **Google switched it off July 2024**. The file said
"swap for HTTP v1 in production" and nothing had. Now: OAuth2 bearer from a
service account, JWT signed by hand, token cached 55min of 60, **one request
per device** (v1 has no `registration_ids`), prune only on UNREGISTERED /
NOT_FOUND / INVALID_ARGUMENT. Credentials from a JSON file on the private disk.

**Two test bugs found writing it.** The old suite ran the push job by hand
AFTER `notify()` had already dispatched it under the sync queue — every push
sent twice, invisible while the legacy API took all tokens in one call. And
`rider.*` had no `DeepLinks` destination, missed because the "every type"
test used a **hand-typed list of twelve**. It greps the emitters now and
expands the interpolated forms from their enums. [[shopos-promise-in-another-file]].

## Rider MODE, not a rider section

The mode swaps the WHOLE navigator: three tabs (Deliveries · Earnings ·
Account), **no basket** — somebody delivering is not shopping.

**A preference is not a permission.** The stored mode is honoured only while
the server says approved; `syncFromProfile` demotes and never promotes, and
`canRide` is tested at RENDER as well as in the store because an effect that
has not run is not a fence. A 700ms cover hides the navigator swap, with the
tree changed halfway through. `ScreenHeader` gained a hamburger — **a mode you
can enter and not leave is a trap**.

## Two guards caught being wrong

The panel's `localDate` guard reported the first file to EXPLAIN the bug (it
strips comments now — same fix as the mobile inset guard,
[[shopos-detector-vs-rule]]), and `routesExist` knew only the customer
navigators.

## Verified NOT built (2026-09-06)

- **No online-only business type.** Every marketplace type also carries POS
  and inventory. A shop that only sells online has no shape of its own.
- **The panel has NO web push** — no `Notification.requestPermission`, no
  PushManager. It is an installable PWA (VitePWA) and polls orders every 30s
  while open, so a shop owner with the phone in a pocket learns nothing.
- Firebase is not installed in the mobile app; adding the gradle plugin
  without `google-services.json` breaks the Android build.
- No cascade offer engine — the pool is an **open board**, 8km, first-accept.
  Scheduler and `database` queue exist, no Redis.
