---
name: shopos-e2e-checked-by-nothing
description: STANDING — panel/e2e was in no tsconfig, so a spec with an unbalanced brace committed clean; fixed with tsconfig.e2e.json, and the same hole is worth checking in any repo directory that only runs under a tool
metadata:
  type: feedback
---

`npx tsc -b` in `panel/` covered `tsconfig.app.json` (`src`) and
`tsconfig.node.json` (`vite.config.ts`). **`e2e/` was in neither.**

So a Playwright spec with one brace too many — left behind when a `for` loop
became a function — typechecked clean and committed clean. It would only ever
have been caught by RUNNING that project, and the volume project is not run
in CI because it needs a seeded database. `npm run lint` found it in the end,
as one parsing error among twenty-five warnings.

**Fixed:** `panel/tsconfig.e2e.json`, referenced from the root tsconfig,
including `e2e` and `playwright.config.ts`. It needs `DOM.Iterable` in `lib`
because `for (const b of document.querySelectorAll(...))` inside
`page.evaluate` is ordinary browser code.

**Why it matters beyond this bug:** this is the same shape as the day
`tsc --noEmit` passed a `step="any"` that `tsc -b` refused — a checker that
looked like it covered everything and did not. The question to ask of any
directory is not "does it typecheck" but **"what config includes it, and is
that config in the build?"**

A test that cannot be run is not evidence; a test that cannot even be parsed
is not a test. See [[shopos-detector-vs-rule]],
[[shopos-measurement-that-lied]], [[shopos-reachability-rule]].
