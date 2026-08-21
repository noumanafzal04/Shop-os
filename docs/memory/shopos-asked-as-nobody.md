---
name: shopos-asked-as-nobody
description: "STANDING: a sweep call with NO token went out bare and the server's 401 was printed as a product bug — one full run faked 96 of them. Also: a throwaway probe that mutates sweep shops leaves the standing sweep lying for days"
metadata:
  node_type: memory
  type: feedback
---

**2026-08-21.** Asked "has every business type been driven?" and ran the whole
sweep to find out. It printed **96 bugs**. Eighty-eight said `401
Unauthenticated`, and one said *"the shop has a Main branch — 0 branches"* about
a shop with **eighteen**. None were about the product.

**Why:** `Api.login()` returns `None` when a sign-in cannot be had —
`throttle:auth` is **5/min per IP** and a full run drives ~100 identities. The
phase then called with `token=None`, which falls through to an ambient token
that was **also** None, so the request went out **bare** and the server
correctly said 401.

This is the sibling of the bug `api.py` already had a long comment about (*"a
permission probe that ran as the WRONG IDENTITY"*). `NOBODY` guarded the
**deliberate** anonymous call; asking as nobody **by accident** had nothing in
front of it.

**Why:** ask "what does this tool do when it CANNOT do its job?" — a detector's
failure mode is usually indistinguishable from a clean result.

**How to apply:**
- A request that would carry no credentials **does not go out** — status `0` /
  `HARNESS_NO_TOKEN`, a status no route returns. `run.py` **fails the run** if
  one happens: *a summary that cannot be trusted must not read like one that
  can.*
- `_login_fresh` passes `NOBODY` explicitly — a sign-in is the one call that
  must carry nothing, and the new guard blocked it on its first run.
- A failed sign-in reports the **server's own answer** (`why_login_failed()`).
  Phase A said *"is the seeder run?"* about an account that logs in fine.
- Retries 4 → 10. **A slow run beats a wrong one.**
- **Read the throttle waits before the verdict:** `grep -c 'rate limited'`.

## Two rules for anything that touches a sweep shop

1. **A throwaway probe must restore what it touched, or use a shop of its own.**
   The one-off script I wrote to measure the audit trail suspended a cashier and
   set retail's discount ceiling to 12%, and left both — so the standing sweep
   reported two false bugs afterwards (`cashier can sign in`,
   `DISCOUNTS.APPLY ACTUALLY GRANTS IT — 403 above the 12% limit`). **The lie
   outlives the probe.**
2. **Every reusable fixture restocks.** Phase G's serialized product was made
   with 50 units and never topped up; each run ate one until the run reported
   `Insufficient stock: only 0 in stock` as a defect. The server was right — the
   sweep had emptied the shelf. *"It must stay re-runnable"* is this sweep's
   oldest rule.

**96 bugs → 3 → 0.** Final: **1743 ok · 0 queries · 0 bugs** over 19 phases,
with zero throttle waits and zero calls made as nobody.

## Per-type coverage, measured

8 trading types + `food_restaurant`. **`finance` was thin BY CONSTRUCTION** —
its only module is `expenses`, so phase C (needs a till) skipped it and every
later phase reads phase C's output: **17 of 19 phases never touched it.** *The
one type whose entire product IS the money screens had never been driven end to
end.*

**FIXED the same day.** It could not go into `sold` — that dict means "a shop
that can ring a sale" and **13 phases index `state["product"]` without asking**
— so `phase_c.BOOKS_ONLY` carries no-till shops and `run.py` hands it to phase E
alone. Everything there but the khata needs only a token (a khata charge is a
SALE on credit). Phase E is gated on `expenses` **not** `pos` in `GATES`, so
cutting the route now prints `SILENT ON: finance` rather than a clean green.

> **A coverage gate tests REACH; a mutation tests a CHECK.** A check that never
> ran cannot be caught by breaking it.

The 9 legacy codes are deliberately not swept — *a sweep of an alias is a sweep
of its target with a different label* — and `EveryTradeLoadsTest` runs every
screen for **all 17** codes.

Related: [[shopos-qa-sweep]], [[shopos-detector-vs-rule]],
[[shopos-workflow-test-rule]], [[shopos-who-changed-what]]
