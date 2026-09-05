# The customer app takes its shape

**2026-09-05 · mobile**

A day of design references, and every one of them uncovered something that was
already broken. Recording the defects rather than the decorations, because the
decorations are in the code and the defects are the part that repeats.

---

## 1. The basket was a screen you had to scroll to check

A cart exists so somebody can see everything they are about to pay for **at
once** and press one button. Ours fitted five lines.

The space had gone to furniture, not to the basket:

| Block | Cost | What it was |
|---|---|---|
| `StepBar` | 48px | ①Menu ②Cart ③Checkout — announcing a step the tab bar already showed |
| Each row | 86px | a 56px thumbnail with name / options / stepper stacked three deep beside it |
| Footer | 140px | a label, a number, a line of small print and a full-width button |
| Scene padding | 98px | genuinely needed by the floating bar |

330px of an 800px screen before a single item was drawn.

Rebuilt to a costed budget — header 46, row 70, bill 152 — which fits eight
rows, and a normal order of three to six things does not scroll at all.

**The options line was the quiet one.** Name and options were two lines and the
options line is empty for most items, so every row paid for a third line of
height that usually had nothing in it.

## 2. The basket screen was not in the flow

`MarketShopScreen`'s sticky bar said **View cart** and navigated to
`Checkout`. So the one screen where you change a quantity or drop a line was
skipped on the way to the screen that asks for your address, and the only way
to reach it was to notice the tab.

Checkout had no back button either — it is a modal with no navigation bar, and
the way out was an outline button *below the totals*, under a form long enough
that reaching it meant scrolling past everything you had just filled in.

## 3. Checkout was the cart, again, with a payment form attached

It listed the whole basket with a stepper on every row. Eleven items pushed the
address, the total and the button off the bottom. Two copies of the cart could
not disagree only because they shared a store — they still made the same screen
twice. It is one summary line now, and Edit goes back to the basket.

## 4. Four shortcuts, one destination

`Offers`, `Pick-up`, `New shops` and `Top rated` on the home screen each
navigated to the shop list passing **only a title**. Four buttons, one
unfiltered list of every shop, four different headings over it. Nothing failed;
the screen looked finished; the claim was the heading.

They now carry the filter as part of their definition — `__tests__/shortcuts.test.ts`
fails if one narrows nothing, if two narrow the same thing, or if one names a
sort the server would 422.

**"Pick-up" is gone rather than fixed.** `pickup_enabled` defaults to true for
every shop, so filtering on it returns the whole marketplace: a correct filter
and a useless shortcut. "Under Rs 500" is a question people actually ask.

## 5. The filters existed already, on the server, with no caller

`/marketplace/products` and `/marketplace/products/facets` — price range,
sort, category, size, rating, on-sale, in-stock, every option counted from the
same query the listing runs — were built for the web aisle and had **no caller
on the mobile side at all**. The app's only filters were two chips that
narrowed the page of search results already on screen.

So the filter sheet is not new capability, it is a door: `BrowseScreen` plus
`FilterSheet`, driven by the real facets, with the button reading
"Show 42 results" from the same count.

The slider's bounds come from the server for the same reason. A hardcoded
0–10,000 puts an entire grocery aisle inside the first eighth of the track,
where no two prices can be told apart.

## 6. Two shopping trolleys in one tab bar

`mart` and `grocery` both mapped to `ShoppingCart`, which is also the middle
button. One meant "groceries" and one meant "what you are buying right now".
`mart` is a basket now — one edit, in the one icon map.

## 7. The splash screen was gated on the server

`useBootstrapSession` held `status: "booting"` until `/auth/me` answered. An
access token lives one hour, so the ordinary case — opening the app the next
morning — is a 401 after up to twenty seconds, then up to another twenty
refreshing, with the app sitting on its own logo throughout. **Measured at
about three minutes.**

Tokens on the phone are enough to open the app. The profile arrives behind it;
a dead session drops the person to guest, visibly, while they are already
browsing.

That change had a consequence worth naming: the route test was
`user?.role !== "customer"`, which is TRUE for a null user. Every returning
customer would have seen "you are in the wrong app" until their profile loaded.
The branch now requires `user != null` as well.

---

## Second pass — the same day, from a real phone

**Seven pushed screens were cut off at the bottom.** `edges={["top"]}` is right
for a TAB — the floating bar covers the gesture area, and padding it again
opens a dead strip under every list. It is wrong for everything else, because
nothing sits below a pushed screen: the location picker, search, reservations,
favourites, order tracking, notifications and addresses all put their last row,
and on some their only button, under the gesture bar. All seven look perfect on
an emulator with no gesture bar. `bottomInset.test.ts` now reads both
navigators out of `RootNavigator` and fails on any stack-only screen that pins
the top edge — and asserts that `MarketScreen`, which is a tab AND `ShopList`,
computes it per instance instead.

**The navigator had no theme.** `NavigationContainer` was left on
`DefaultTheme`, so every surface React Navigation paints itself came from a
light grey — in BOTH themes. It shows wherever a screen does not cover it, and
the clearest case was the tab bar's rounded top corners: two bright notches cut
out of the bar on a dark page. Nothing in the palette was wrong; the palette was
not being asked.

**Two screens could not be left.** Favourites and Reservations are both
reachable from the side menu and neither had a back control — the only way out
was the phone's own gesture, which nothing on screen mentions. They share a
`ScreenHeader` now, and `wayBack.test.ts` walks every non-modal stack screen.

**Three headers still had the white-circle spacer**, the bug fixed on the
tracking screen a fortnight earlier: a title centred by an empty View that
reused the BACK BUTTON's style, so the balancing gap rendered as an empty
circle. `ScreenHeader` left-aligns its title, so there is no gap to balance and
nothing for a spacer to get wrong — and a guard forbids the shape outright.

**Six back arrows were drawn in `c.black`**, which is the same near-black in
both themes and therefore invisible on a dark page. The existing dark-mode
guard could not see them: every one of those screens calls `useColors()`
perfectly correctly. It now forbids `c.black` outright — the brand fill is a
dark red, so there is no ground in this app where it belongs.

**There was no way to edit your own profile at all** — no screen and no
endpoint. Somebody who mistyped their name at sign-up carried it for ever, and a
changed phone number, which is what a rider calls, needed database access.
`PUT /auth/profile` was added with the screen; changing an email or phone drops
its verified mark, because `email_verified_at` says "we sent a code THERE and
somebody read it" and carrying that to a new address is a claim the system
cannot support.

**The location picker's only control did not work.** Street search needs a
geocoding key and there is not one configured, so a person whose GPS guessed
the wrong city could not correct it. `GET /marketplace/cities` answers from our
own rows — and it is the half that matters, because the marketplace lists BY
CITY and a pin four streets over changes nothing about which shops appear. Only
cities with a marketplace-visible shop: offering an empty one is the same fault
as a filter rail counting from a hardcoded list.

---

## Third pass — a photograph of a real phone

The second pass fixed seven screens that pinned `edges={["top"]}`. It did not
fix the thing the photograph actually showed, because two more places spend the
bottom inset and neither goes through `SafeScreen`.

**The tab bar was reading the wrong inset.** React Navigation renders a custom
tab bar inside a context whose bottom inset is ZERO — it treats the inset as
its own to spend and hands the real figure to the bar as a PROP. So
`useSafeAreaInsets()`, which is correct on every other screen in this app,
returned 0 there, and `Math.max(insets.bottom, 8)` gave the bar eight points of
clearance under a forty-eight point navigation bar: the labels touched the
buttons and the basket disc was cut in half. On a gesture-navigation emulator
8 nearly covers the inset, which is why it survived every check until a
photograph arrived.

**An absolutely-positioned bar does not sit inside its parent's padding.** Yoga
measures `bottom` from the border box, so `SafeScreen`'s inset — which
correctly holds the shop's LIST clear of the navigation bar — does nothing for
the sticky cart bar above it. On a three-button phone it sat underneath the
buttons with "View cart · Rs 3,980" showing through them. It adds the inset
itself now.

Both are guarded, and the guard had a bug of its own worth recording: it
grepped the raw file for `useSafeAreaInsets(` and matched the DOCBLOCK
explaining why the hook is wrong there. A guard that cannot tell prose from
code fails on the explanation of the bug it exists to prevent. It strips
comments first.

**And the splash was two Keychain reads long.** The saved settings gate the
first paint and the session gates the splash, and they ran one after the other:
`App` awaited the settings, mounted the tree, and only then did the bootstrap
start reading tokens. Two sequential trips to the Android Keystore, for two
answers that do not depend on each other. They run together now, and
`hydrateTokens` returns immediately when the tokens are already in memory.

---

## Three things that are deliberately not fixed

**White on the new `#E94E00` is about 3.1:1.** That clears AA for large or bold
display text and not for body text. `onPrimary` is therefore for button labels
and icons on a brand fill, never a paragraph. The previous, darker red cleared
4.2:1 — this is the cost of the warmer hue, stated rather than discovered.

**`prefs` keeps a theme choice in the Keychain**, which is for secrets. This app
has no key-value store at all: React Native ships none and AsyncStorage is a
native module. It is one file to replace when a real store arrives, and nothing
outside it knows where the value lives.

**Geist is not installed.** The font files are not in the repo; see
`mobile/docs/FONTS.md`.

---

## Guards added

| Test | Fails when |
|---|---|
| `shortcuts.test.ts` | a home shortcut narrows nothing, duplicates another, or names an unknown sort |
| `bootSpeed.test.tsx` | the splash waits on the server, or a Keychain throw strands the app |
| `onboarding.test.tsx` | the introduction shows twice, never shows, or opens the app without recording it |
| `format.test.ts` | a screen defines its own money or quantity formatter |
| `darkModeDebt.test.ts` | the theme is pinned, or the saved preference is not read before the first paint |
