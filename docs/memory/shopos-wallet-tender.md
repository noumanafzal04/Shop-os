---
name: shopos-wallet-tender
description: wallet tender (JazzCash/Easypaisa) shipped; offline-safe like a card; nine copies of one tender list collapsed to PaymentMethod::counter()
metadata:
  type: project
---

**2026-09-15 SHIPPED** — `PaymentMethod::Wallet` ('wallet'). backend `dc19e41`,
panel `2eceadf`.

**Why it existed as a gap:** eight cases, no wallet, so shops rang JazzCash /
Easypaisa as `other` or `bank_transfer` — whose POS label had already drifted to
"Bank / wallet". A workaround in a label with no ticket behind it.

**The rule that decides it:** recorded, never captured (CartZe has no gateway) →
same standing as `card` → **offline-safe**, in `OfflinePolicy::TENDERS`. The
confirmation comes over the cashier's own phone data, not the shop's line.

**The money claim:** a wallet must NOT move `expected_cash`. `DrawerMath` sums
only `method = 'cash'` — unchanged, but now mutation-proven. Wrong = every
wallet sale reads as a shortage at close.

**The refactor that mattered more than the tender:**
`in:cash,card,bank_transfer,other` was written **nine times** (7 request classes
+ 2 model constants) → `PaymentMethod::counter()` / `counterOrCredit()`.
`SyncRequest` needed nothing — it borrows `StoreSaleRequest` wholesale.

**Two bugs found by adding a fifth button:** POS tender labels were a ternary
ending `: "Cash"` (any new tender would be drawn, pressed and called Cash) → now
`METHOD_LABEL`; and the "Default" badge was hardcoded to cash, contradicting a
shop that chose Card → now follows `defaultTender`.

**Two testing lessons, both standing:**
- `it.each(OFFLINE_TENDERS)` reads the list it tests — it proves every listed
  tender is accepted, never that a tender is listed. Name the new one as a
  literal. Same family as [[shopos-detector-vs-rule]] and
  [[shopos-matrix-own-blind-spot]].
- A mutation **passed because the regex omitted a trailing comma** and never
  applied. Assert the match count before trusting a surviving mutation. See
  [[shopos-mutation-aimed-at-wrong-rule]] and [[shopos-measurement-that-lied]].

Related: [[shopos-offline-plan]] · [[shopos-payments-status]] ·
[[shopos-pos-trade-coverage]] · [[shopos-workflow-test-rule]]
