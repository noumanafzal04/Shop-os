# The tests that need a browser

Everything under `src/**.test.ts` runs in **jsdom**, which has no layout engine:
`getBoundingClientRect()` returns zeros, no stylesheet is applied, and no media
query ever matches.

That is not a gap in the tests. It is a gap in what the tool can see — and it is
why all seven defects a shop found by holding a tablet were invisible to a
thousand green tests. A close button under a header, a 28px target, a modal
taller than the screen: **none of them are wrong in the source.** They are wrong
only once something computes a position.

```bash
# needs the API up, and the sweep's tenants seeded
cd shopos-backend && php artisan serve --port=8000
cd shopos-admin-and-user-panel && npx playwright test
```

The suite signs in once as a sweep tenant owner and reuses the session —
`throttle:auth` is 5 logins a minute per IP.

Three viewports, and the middle one is the one that broke:
**tablet landscape is 1024–1279, which is `lg` in this codebase, not `xl`.**

## One installation gotcha

`npm i -D @playwright/test` pruned **jsdom** out of `node_modules` while leaving
it in `package.json`. The unit suite then failed 201 tests with `localStorage is
not defined` — which reads exactly like a code regression and is not one. If you
see that, run `npm install` and it comes back.

## Rebuild before you believe a result

`playwright.config.ts` sets `reuseExistingServer: true`. If a preview server from
an earlier run is still up, **your source changes are not in it** — the suite
runs the previous build. A newly added test hook simply will not exist, and the
failure reads like a layout defect.

```bash
lsof -ti:4173 | xargs -r kill && npm run build
```

## The shelf is a fixture, and it is built

`shelf.setup.ts` runs between `auth.setup.ts` and the specs. The till correctly
disables a tracked product it has no stock of, and the sweep's mart has stock on
five items — so a cart of nine lines was impossible and the full-cart spec passed
by describing a five-line cart. The setup tops products up (creating its own if
the catalog is thin) and **fails** if it cannot get enough: a thin shelf must stop
the suite, not quietly shrink what the suite can see.

## Reach for things the way a person would

`page.scrollIntoViewIfNeeded()` — and `el.scrollTop = n` — **will scroll a box
whose `overflow` is `hidden`**. A finger will not. A check that scrolls an
element into view and then asks "is it visible" can answer YES about content the
shop can never reach; that is exactly how the cart spec went green while a phone
showed three lines of nine.

Call `onlyWhatAFingerCanReach(page)` before measuring. And when you walk up for a
scroll container, remember `overflow-x-auto` computes **`overflow-y: auto` too** —
require `scrollHeight > clientHeight` or you will find a horizontal wrapper and
scroll nothing.
