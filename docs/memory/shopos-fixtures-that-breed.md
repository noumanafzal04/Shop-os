---
name: shopos-fixtures-that-breed
description: STANDING — an e2e fixture named with Date.now() leaves one more behind every run; 13 sized products crowded the till's page one and a SIBLING spec failed
metadata:
  type: feedback
---

Two of my own Playwright specs named their fixture `` `E2E … ${Date.now()}` ``.
Each run left one more product in the shop, permanently: **9 shirts and 4 pizzas,
every one of them a SIZED item.**

`chrome.spec` then failed on four viewports with *"the till listed no sellable
products"* — a precondition needing eight PLAIN items, which the sized fixtures
had crowded off page one of the till. **The screen it was accusing was working
perfectly.**

**Why:** a fixture that accumulates is a slow leak, and the spec that fails is
never the spec that leaked. The failure names an unrelated subject, at a
different layer, days later.

**How to apply:** an e2e fixture gets a FIXED name and clears its own ground
first (`removeProductsNamed` in `e2e/api.ts`) — one of a thing, every run,
whatever happened last time. `Date.now()` in a fixture name is the smell. Same
family as [[shopos-asked-as-nobody]]: a throwaway probe that mutates shared state
leaves every later run lying.

Also true of PWA staleness: a report of "this feature is missing" is worth
reproducing in a real browser before believing it. The reported variant bug was
an old service-worker bundle, not a defect — see [[shopos-menu-and-door]] for
what the same session's real bug looked like.
