---
name: shopos-mobile-customer-shape
description: 2026-09-05 mobile design day — 7 defects the references exposed; palette moved to #E94E00; splash was gated on the server
metadata:
  type: project
---

The customer app's design pass, 2026-09-05. What the references EXPOSED, not
what they decorated — the decorations are in the code.

1. **The basket fitted five lines.** 330px of an 800px screen went to furniture
   before an item was drawn: a step bar announcing a step the tab bar showed,
   rows stacked three deep, a 140px footer. Rebuilt to a costed budget
   (header 46 / row 70 / bill 152) → eight lines, no scroll for a normal order.
2. **The basket screen was not in the flow.** The shop's "View cart" bar
   navigated to Checkout; the cart was reachable only by noticing the tab.
   Checkout had no back button either.
3. **Checkout was the cart again** — full item list with steppers. One summary
   line now, Edit goes back.
4. **Four home shortcuts, one destination.** Offers / Pick-up / New shops /
   Top rated all opened the unfiltered shop list with a different heading.
   Now each carries its filter; `shortcuts.test.ts` fails if one narrows
   nothing or two narrow the same thing. Pick-up deleted —
   `pickup_enabled` defaults true, so it would return the whole marketplace.
5. **The filters already existed on the server with no mobile caller.**
   `/marketplace/products` + `/products/facets` (price range, sort, category,
   size, rating, on_sale, in_stock, counted per axis). Built for the web aisle.
   Mobile now has `BrowseScreen` + `FilterSheet` + a hand-built dual-thumb
   `PriceRange` (no Reanimated/Gesture Handler in this app).
6. **Two shopping trolleys in one tab bar** — `mart`/`grocery` mapped to
   `ShoppingCart`, so did the basket button. `mart` is a basket now.
7. **The splash was gated on the server.** `useBootstrapSession` held
   `booting` until `/auth/me` answered; a one-hour token means a next-morning
   cold start is 401 (≤20s) + refresh (≤20s) on the logo. Measured ~3 minutes.
   Tokens on the phone now open the app and the profile lands behind it —
   which forced `user != null` into the role branch, because
   `user?.role !== "customer"` is TRUE for null.

**Second pass, from a real phone (same day):**

8. **Seven pushed screens cut off at the bottom.** `edges={["top"]}` is right
   for a TAB (the floating bar covers the gesture area) and wrong for every
   pushed screen. Invisible on an emulator with no gesture bar.
   `bottomInset.test.ts` reads both navigators and fails on a stack-only screen
   that pins the top edge.
9. **`NavigationContainer` had no theme** — `DefaultTheme`'s light grey in BOTH
   modes, showing through the tab bar's rounded corners on a dark page.
10. **Favourites and Reservations had no back control at all.** Shared
    `ScreenHeader` + `wayBack.test.ts`.
11. **The white-circle spacer was still on 3 more headers** — a title centred by
    an empty View wearing the BACK BUTTON's style. `ScreenHeader` left-aligns,
    so there is no gap to balance.
12. **6 back arrows in `c.black`** — invisible on dark; the old guard could not
    see them because those screens call `useColors()` correctly. Token forbidden
    outright now.
13. **No way to edit your own profile** — no screen, no endpoint.
    `PUT /auth/profile` added; changing email/phone drops its verified mark.
14. **The location picker's only control did nothing** (no geocoding key).
    `GET /marketplace/cities` answers from our own rows — and city is the half
    that matters, since the marketplace lists BY CITY.

**Third pass, from a photograph of a real phone.** The second pass fixed the
seven `edges={["top"]}` screens and NOT the thing the photo showed, because two
more places spend the bottom inset and neither goes through `SafeScreen`:

15. **React Navigation zeroes the inset context for a custom tab bar** — it
    hands the real figure to the bar as a PROP. `useSafeAreaInsets()` returned
    0 there, so `Math.max(0, 8)` gave 8pt of clearance under a 48pt navigation
    bar: labels touching the buttons, basket disc cut in half. Invisible on a
    gesture-nav emulator, where 8 nearly covers the inset.
16. **An absolute bar does NOT sit inside its parent's paddingBottom** — Yoga
    measures `bottom` from the border box. The shop's sticky cart bar adds the
    inset itself.
17. **The guard for #15 matched its own docblock** — it grepped the raw file
    for `useSafeAreaInsets(` and hit the prose explaining why the hook is wrong
    there. It strips comments now. STANDING: a text guard must read code, not
    prose.
18. **The splash was two SEQUENTIAL Keychain reads** — settings, then tokens,
    for two answers that do not depend on each other. `Promise.all`, plus
    `hydrateTokens` returning early when they are already in memory.

To reproduce this bug class on the emulator:
`adb shell settings put secure navigation_mode 0` (0 = 3-button, 2 = gesture).

**Palette moved** to #E94E00 primary / #EBC249 warm / #80B931 green /
#221711 ink. White on #E94E00 is ~3.1:1 — button labels and icons only, never
body text. `warm[700]` and `green[600]` exist because the 500s are FILLS and
yellow-on-white text is unreadable.

**`prefs` keeps the theme in the Keychain** (a documented misuse) because this
app has no key-value store and AsyncStorage needs a native rebuild.

See [[shopos-mobile-is-customer-and-rider]], [[shopos-cartze-brand]],
[[shopos-the-aisle]], [[shopos-token-lives-one-hour]].
Full argument: `docs/decisions/shopos-mobile-customer-shape.md`.
