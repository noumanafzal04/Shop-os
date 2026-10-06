---
name: shopos-build-check-is-tsc-b
description: STANDING — before ANY panel push run `npm run build` (tsc -b && vite build); `tsc --noEmit -p tsconfig.json` misses what the deploy catches
metadata:
  type: feedback
---

**Rule:** before every panel push: `cd panel && npm run build` must exit 0. Not `npx tsc --noEmit -p tsconfig.json`.

**Why:** 2026-10-06 the user's deploy on the droplet failed on three errors I had pushed (unused import in HardwareDevices, `step="1"` on a number prop in PosPage, unused local in an e2e spec). The build is `tsc -b` — project references with `noUnusedLocals` and the `e2e/` folder included — and my quick check used the root tsconfig, which reports none of them. The user: "don't create issues like this on deployment."

**How to apply:**
- `npx tsc -b` for a fast check while working; `npm run build` before the push. Never beside Playwright ([[shopos-suite-vs-itself]]).
- e2e specs are type-checked by the build too: an unused variable in a spec breaks a production deploy.
- The shared `<Input>` has a narrow prop list (`step` is a number, no `inputMode`): a prop that looks like plain HTML may not exist on it.
- Server runs node 20 while a dependency asks for >=22 (EBADENGINE warning) — a warning today, worth telling the user before it becomes an error.

Related: [[shopos-exit-code-not-summary]], [[shopos-cicd-and-mobile]]
