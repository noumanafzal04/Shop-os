---
name: shopos-one-press-one-record
description: STANDING (B07, 2026-10-14): every form that records money sends useOnceKey() and its route carries the `once` middleware (AnswerOnce + answered_requests); renew the key only on success
metadata:
  type: feedback
---

A double-click recorded a khata payment, a supplier payment and an expense twice (tester pass 1). Fixed generically: `App\Http\Middleware\AnswerOnce` (alias `once`) keeps the first answer per (user, `idempotency_key`) in `answered_requests` (pruned daily after 2 days); same key → same answer (`Idempotent-Replay: true`); in flight → 409 REQUEST_IN_FLIGHT; a refusal releases the key. Panel: `common/onceKey.ts` `useOnceKey()` → `{key, renew}`.

**Why:** the button disables only after React re-renders; two POSTs leave first.

**How to apply:** a NEW money form = `once` on its route + `idempotency_key: once.key` in the create payload + `once.renew()` in onSuccess (never on error). Not on edits (an edit with a stale key would be answered as the old one). Sales, returns, receipts, transfers keep their own per-table keys. See [[shopos-tester-and-fixer]].
