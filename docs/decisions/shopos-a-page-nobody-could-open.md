# A page nobody could open, and a trade it could not name

**2026-09-09**

## The page was unreachable on live

`CategoriesScreen` shipped registered, routed, tested and unopenable. Its only
entry point was a tile on the home grid drawn under:

```tsx
{(feed.data?.business_types ?? []).length > tradeTiles.length && ( … )}
```

`business_types` is the trades that HAVE shops. Live returns four. `HOME_TRADES`
is four. `4 > 4` is false, so the tile did not render and there was no other way
in — on the installation every new city is, and on the one the app actually
talks to.

The condition was asking "is there more to see than the grid shows", which was
the wrong question twice over. It compared against a list that answers a
different question, and the page it guarded is now strictly more than the grid
can be.

The tile is unconditional. `screenReachable.test.ts` asserts that
mechanically — it finds the tile's accessibility label, walks back to its
element, and fails if the line above it ends in `&&`, `?` or `||`. Re-wrapping
the tile in any condition fails the test (proven).

## It also could not name the trade anybody was looking for

Garments, footwear, electronics, mobile accessories, cosmetics and toys are all
one `business_type` — `retail`. Grocery, supermarket and mini mart are all
`mart`. A page that stopped at the trade offered somebody looking for clothes a
row labelled **Retail Store** and no way to say what they meant.

So there is a second level now, from a new endpoint:

    GET /api/v1/marketplace/categories?city_id=

    business_types[] = { type, label, shops_count, categories[] }
    categories[]     = { value, label, shops_count }

- **Every selectable trade**, not just the ones with shops — home's list cannot
  say a trade exists that nobody has joined yet.
- **Zeros are sent, not dropped.** The caller is the only side that knows
  whether it is drawing a shopping list or the platform's breadth.
- **One grouped query** (`business_type, business_category`), so the trade
  totals and the category totals cannot disagree.
- **Legacy codes fold into their primary** via `BusinessTypes::primary()`, or a
  shop still typed `grocery` is counted nowhere on a page whose job is to
  account for every visible shop.

`GET /marketplace/shops` now accepts `business_category` — exact, not `like`,
because `mobile_accessories` contains `mobile` and a Toys row that answered
with everything containing the word is a filter that lies quietly. Without it
the categories page could name Garments and had nowhere to send anybody: the
nearest thing was `search=garments`, a LIKE over the same column that also
matches shop NAMES.

## The gate that would have hidden Pharmacy

The obvious filter for "which trades belong in a marketplace" is
`features.marketplace`. It is **false for pharmacy** — a chemist takes phone
orders and delivers while listing nothing online — and pharmacy is one of the
three trades this product earns its daily money in. The gate is
`products || services`, which excludes exactly one trade (Finance Manager: no
catalog, no till, nothing to browse), plus an escape hatch: any trade that
already has a visible shop is listed regardless, because a page that accounts
for every shop cannot hide the row those shops are counted in.

## One rule about what may be pressed

`shops_count > 0` decides, at both levels. A trade with none reads "Coming
soon" and presses nowhere; a category with none is drawn flat with no count and
no handler. Naming something and then opening an empty list is the shape this
codebase keeps finding — offered, and not doable. An empty trade's chips are
not drawn at all: they would all read zero and say nothing "Coming soon" has
not, and nine trades of them would scroll like ninety.

`categoriesScreen.test.tsx` mounts the screen and asserts it, because the last
version of this page was covered entirely by source scans and a source scan
cannot see a page nobody can reach.

## Two tests that described a moment, not a rule

- `loadFailed.test.tsx` asserted `canSearchAddresses() === false` because "the
  key is empty in source on purpose". True of the repository that day; not a
  rule about the app. Configuring a key failed two tests for the one reason a
  test must never fail — the thing it described had been fixed. Rewritten to set
  up both states explicitly and assert the actual rule (`null` = could not
  search, `[]` = searched and matched nothing), plus the google branch, which
  had never run once and is now the only one that runs.
- The categories tests asserted `useHomeFeed(...)` with the same key as home,
  "so this screen is a cache hit". That reuse was the defect: same hook, same
  four rows.

## The keys live outside the repository now

`src/common/secrets.ts` (gitignored) holds them; `config.ts` imports it;
`secrets.example.ts` is tracked and `postinstall` copies it when the real file
is missing, so a fresh clone still bundles. `secretsStayOut.test.ts` asks git —
ignored, never tracked, example empty — and scans every tracked file for
`AIza[0-9A-Za-z_-]{35}`. Pasting the key back into `config.ts` fails it
(proven).

**None of that stops the key being read out of the APK.** A bundled string is
extractable; it is in `index.android.bundle` and can be found with `grep`. The
only real defence is provider-side: Google Cloud application restrictions
(Android package `com.shoposmobile` + the release SHA-1) and an API allow-list
of Geocoding + Places. The Geoapify key in public git history still needs
rotating.

Backend 2680 passed / 2 skipped · mobile tsc 0, eslint 0 errors, 54 suites /
729 tests · 5 mutations, 5 caught · APK `cartze-1.0.3-b8.apk` (versionCode 4).
