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
