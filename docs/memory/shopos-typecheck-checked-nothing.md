---
name: shopos-typecheck-checked-nothing
description: STANDING — panel `tsc --noEmit` compiles ZERO files (root tsconfig is files:[] + references); always `npm run typecheck` / `tsc -b`
metadata:
  type: feedback
---

**In the panel, `npx tsc --noEmit` is a measurement that cannot fail.**

The root `tsconfig.json` is `{"files": [], "references": [app, node]}`. With no
files and no `-b`, tsc compiles **nothing** and exits 0 — however broken the
source is. `tsc -b` walks the references and actually checks.

**Why:** a wallet-tender change shipped green locally and **failed the deploy
build** on `HeldSale.cart.payment_method`. Every prior "typecheck passed" in
this repo that used `--noEmit` was worth nothing.

**Proved, not assumed:** appended `const x: number = "not a number"` to
`posService.ts`. `--noEmit` stayed silent; `tsc -b` named the line.

**How to apply:** run **`npm run typecheck`** (= `tsc -b`, the same thing
`npm run build` runs). Never `tsc --noEmit` in the panel. Before claiming a
build is safe, run `npm run build` — the deploy runs `tsc -b && vite build`,
and only that pair is evidence.

Same family as [[shopos-measurement-that-lied]] (wrong cwd, unquoted heredoc),
[[shopos-exit-code-not-summary]] (2225 passed while exiting 1) and
[[shopos-failed-check-is-not-a-verdict]]. The shape is always: a check ran, said
nothing, and the nothing was read as a pass.

Related: [[shopos-wallet-tender]] · [[shopos-detector-vs-rule]]
