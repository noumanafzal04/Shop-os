---
name: shopos-guards-share-a-blind-spot
description: STANDING — four guards read one route list, so a screen missing from it is invisible to all four AND they all report success; the parser was wrong 3 times
metadata:
  type: feedback
---

`/tenant/orders/new` shipped routed, undocumented, unwalked and ungated — with
every guard green. Four suites (browser walk, help coverage, permission map,
menu-reach) all ask "is every screen covered" **of `src/test/routes.ts`**. A
screen missing from that set is invisible to all four at once, and all four
report success.

`src/test/routes.test.ts` now checks the set against App.tsx. It took four
attempts and the failures are the lesson:

1. prefixing relative paths turned `/tenant/products/new` into `/tenant/new`;
2. a `<Route …>` tag regex found 8 routes in a file declaring 50 — because
   `element={<Page />}` contains a `>` and every pattern stops inside it;
3. comparing bare SEGMENTS was robust and **useless**: `orders` and `new` were
   already known, so it could not catch the bug it was written for;
4. strip `element={…}` by **matching braces**, then walk with a stack.

**How to apply:**
- Adding a screen means: App.tsx, `src/test/routes.ts`, `screenPermissions`,
  `shopNavReach` (or a menu), `chrome.spec`, and a Help article.
- **Mutate every new guard.** #3 passed everything and proved nothing; only
  removing the route from the set exposed it.
- Never regex JSX nesting. Brace matching is reliable; tag nesting is not.
- A scanner that is wrong is worse than none — it fails on screens that are fine.

Related: [[shopos-detector-vs-rule]], [[shopos-reachability-rule]],
[[shopos-measurement-that-lied]], [[shopos-half-a-rule]].
