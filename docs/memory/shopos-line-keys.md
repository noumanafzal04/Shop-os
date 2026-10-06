---
name: shopos-line-keys
description: FIXED 2026-10-06 — cart line keys restarted at c1 after a reload; a restored line and a new one shared a key (discount/qty/REMOVE hit both)
metadata:
  type: project
---

User report: "ek row ko discount do to doosri row par bhi lag jata hai."

**Why:** line key = module counter (`c1…`); the parked cart (`cartStorage`, localStorage) was restored WITH its keys while the counter restarted at 0. Every key-based action hit both rows — including Remove (goods bagged, off the bill).

**How to apply:**
- Keys are issued only by `panel/src/modules/pos/lineKeys.ts` (`nextLineKey`, `rekeyed`). Anything bringing lines in from outside the page (parked cart, held ticket, a future draft/quote import) must go through `rekeyed()`.
- `theTillAgreesWithTheServer.test.ts` counts `key: nextLineKey()` creations (3) — a new door must be added there.
- Proof lives in `e2e/till-lines.spec.ts` (reload mid-sale, then discount / + / remove). Only a real reload reproduces it; unit tests reload the module with `vi.resetModules()`.
- `PurchaseOrdersPage` has the same counter (`lk`) but never restores lines from storage — safe today; re-key if it ever does.

Related: [[shopos-pos-ux]], [[shopos-cart-hid-its-lines]]
