# The platform's cut, a push that works, and two hats

**2026-09-06.** Three pieces built after the rider side: the commission engine
(the locked decision that had never been started), FCM HTTP v1 (the thing that
was silently broken), and rider MODE (the switch that makes the rider half an
app rather than a section).

---

## 1. Push was talking to an endpoint Google switched off

`FcmSender` spoke the LEGACY API — `POST /fcm/send` with
`Authorization: key=…`. Google turned that off in **July 2024**. The file
carried a note saying *"legacy HTTP shown; swap for HTTP v1/OAuth in
production"*, and **a note is not a swap**: every push this product sent after
that date was a request to a dead URL, failing silently behind a queued job
nobody watched.

Rewritten for **HTTP v1**:

- An **OAuth2 bearer** minted from a service account, not a static key. That is
  the whole reason the old one had to go — a leaked server key sends as you for
  ever, an access token dies in an hour.
- The JWT is assembled and signed by hand (`openssl_sign`, RS256) rather than
  pulling in Google's SDK for one grant. Forty lines, no dependency.
- The token is **cached for 55 minutes** against a 60-minute life. The five
  minutes are the margin: a token that expires in flight is a 401 on a
  notification nobody sees fail.
- **One request per device.** v1 has no `registration_ids` array. A phone with
  three devices is three calls — and per-call failure reporting is an
  improvement, because the old positional matching deleted the WRONG token
  whenever the response array was shorter than the request's.
- Pruning only on `UNREGISTERED` / `NOT_FOUND` / `INVALID_ARGUMENT`. A 500, a
  rate limit or a network blip must not cost somebody their notifications.
- Credentials come from a JSON file on the **private disk**, never env vars: a
  PEM key retyped into `.env` is a mangled key. `storage/app/private/` is
  git-ignored, so it cannot be committed by accident.

**And the test found a second bug.** The old suite ran the push job by hand
*after* `notify()` had already dispatched it under the `sync` queue — so every
push in every test was sent twice. Nothing caught it because the legacy API
took all of a user's tokens in ONE request, so twice and once produced the same
single call. The moment v1 made it one request per device, it showed up as six
sends to three phones.

## 2. Five notification types had nowhere to go

`DeepLinks` knew nothing about `rider.*`. Every approval, rejection and
suspension shipped with `data.link` null, so a tap opened the app wherever it
already was — the same gap the expiry alerts had, found the same way.

Fixed on **both** sides (backend route + the mobile resolver, which would still
have been silent afterwards), and the guard that should have caught it was
rewritten: `test_every_notification_type_this_app_emits_resolves_to_a_screen`
had the right title and a list somebody typed. It named twelve types and could
not have failed for a thirteenth. **It now greps the emitters** and expands the
two interpolated forms (`order.{status}`, `rider.{status}`) from their enums —
a check with no denominator is not a check.

## 3. Commission — what the platform earns

A shop pays **two** things and they must never be confused:

| | |
| --- | --- |
| the **plan** | a monthly subscription for the software |
| the **commission** | a share of what the marketplace actually sold for them |

**Charged on ONLINE orders only**, at **COMPLETION**, never at placement.

- A walk-in at the till and a phone order the shop took itself are sales the
  platform had no part in. Billing those would be billing for the software
  twice.
- An order that is placed may be cancelled, refused or never collected. Money
  that has not changed hands is not revenue, and a platform that bills on
  intent spends its week issuing credit notes.

**The rate is a SNAPSHOT.** `commission_charges.rate_percent` and
`base_amount` are written when the order completes and never read from settings
again. Change the rate tomorrow and last month's invoice must not move: it was
raised against a number both sides agreed to at the time, and a bill that
silently re-prices itself is a bill nobody can check.

**The base is the goods, after discount.** The delivery fee is left out because
it is the rider's money, not the shop's — including it would make a shop that
delivers pay more for an identical basket. Configurable, because that is a
decision somebody should take deliberately rather than inherit.

**Off by default**, and "off" is kept apart from "zero": a platform pausing
billing must not lose the number it agreed with everybody. A platform that
starts charging the day it is installed surprises its first shop.

**One charge per order, for ever** — a unique index on `order_id`, and
`firstOrCreate` so a retried completion does not throw. A shop billed twice for
one sale loses trust that a refund does not buy back.

**Invoices** bundle a period. Raising one takes only charges NOT already on an
invoice, locked — two admins with overlapping periods must not bill the same
order twice, and the window they typed is not what decides that. An invoice is
**voided**, never deleted: a shop that has seen a number is owed an explanation
of where it went, and voiding puts its charges back.

`riders.manage` and `commission.manage` are **separate platform permissions**,
and neither is `billing.view`. Reading the revenue figures is not deciding
them, and reading a stranger's CNIC is a decision about a person.

**A shop can check its own bill.** `GET /commission` and a card on the
Subscription page list every unbilled order with its rate. A bill nobody can
check is a bill nobody trusts: a total has to be taken on faith, individual
orders can be argued with.

## 4. Rider MODE, not a rider section

The rider screens hung off the shopping stack, so a rider on shift still had
Food, Grocery and a **basket** along the bottom of every screen — five controls
with nothing to do with the job in their hand, and no way to put the shopping
half away.

Now the mode swaps the whole navigator. Three tabs: **Deliveries · Earnings ·
Account**. No basket, because somebody delivering is not shopping.

- **A preference is not a permission.** The mode is remembered on the device so
  a rider mid-shift comes back to their deliveries after a restart — and is
  only ever honoured for an account the SERVER still says is approved.
  `syncFromProfile` **demotes and never promotes**: approval is permission to
  switch, not a switch.
- `canRide` is tested at RENDER as well as in the store. An effect that has not
  run yet is not a fence.
- The switch shows a **cover** for 700ms. Not a spinner waiting on work —
  replacing a navigator is a few frames of the old bar, a blank, then a
  different bar, which reads as the app glitching. The cover turns those frames
  into something deliberate, and the tree is swapped halfway through so the new
  one has drawn before it lifts.
- `ScreenHeader` gained a hamburger. A root tab has nowhere to go back to, and
  without it there was no control anywhere in rider mode that could open the
  menu — which is where the switch back lives. **A mode you can enter and not
  leave is a trap.**

---

## Two guards that were caught being wrong

- **The panel's `localDate` guard reported the first file to EXPLAIN the bug.**
  It greps raw source, and a docblock about `toISOString().slice(0, 10)` looks
  exactly like the mistake. It strips comments now — the same fix the mobile
  inset guard needed, for the same reason — and a case was added proving the
  stripper does not blind the detector.
- **`routesExist` knew only the customer navigators.** The moment rider mode
  got its own, it would have reported every working link as broken.

## Gates

| | |
| --- | --- |
| backend | 2616 tests, 2614 passed, 2 skipped, exit 0 |
| migrations | up → down → up on MySQL and sqlite; `tenants.commission_rate` returns clean |
| mobile | tsc 0 · eslint 0 errors · jest 27 suites / 312 tests |
| panel | tsc 0 · eslint 0 errors · vitest 128 files / 1487 tests |
| mutations | 9 removed, 9 failures — rate snapshot, channel fence, invoice double-bill, token cache, prune-on-any-error, single-device send, mode permission, render fence, rider basket |

## Still not built

- Firebase is not installed in the mobile app. Installing it needs
  `google-services.json`, and adding the gradle plugin WITHOUT that file breaks
  the Android build — so the backend is ready and the app half waits for a
  credential. `mobile/docs/FCM-SETUP.md` has the steps.
- No cascade offer engine (needs queues), no map on the customer's tracking
  screen (needs a Maps key), no Urdu.
