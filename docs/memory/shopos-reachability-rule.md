---
name: shopos-reachability-rule
description: "STANDING RULE from 2026-08-17: src/common/reachable.test.ts fails when an export's only user is its own test. Two exemption lists; NOT_SURFACED_YET names what must be BUILT to leave it."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-18T04:57:29.255Z
---

`docs/decisions/shopos-reachability-rule.md` · `src/common/reachable.test.ts`.

The codebase's oldest shape — *"a capability is not shipped until something a
person touches can reach it"* — had been found **eleven times by hand**. It is
now mechanical:

> **An export whose own test file is the only thing that uses it.**
> Tests prove a thing works. They do not prove anybody can get to it.

**Why:** the largest instance was the whole offline module — barcode index,
search, category index, stock deltas — all built and tested, POS wired to none
of it, so offline a till could not add a single item in any trade.

**How to apply:**
- `TEST_ONLY` = scaffolding (`reset…`/`forget…`/`clear…`, map introspection).
  Permanent, fine.
- `NOT_SURFACED_YET` = **unshipped capability**, each line naming what must be
  BUILT to remove it. **Watch this list — past a handful it means the product is
  accumulating work nobody can use.**
- Before deleting an "unused" export, **read its file**. `code128Svg` looks dead
  and its own comments explain both why `LabelsPage` uses the other variant and
  why its XSS escaping exists *because* it has no caller.

**The rule had three bugs of its own** (an audit is code too):
1. `RegExp.test` with `/g` is **stateful** → real callers looked absent.
2. Comments counted as callers → *a rule a leftover sentence can satisfy is not
   a rule.* Strip comments; keep imports (eslint fails unused ones).
3. It timed out until stripping was cached per file rather than per lookup.

> **An audit tool that produces findings is a thing to verify, not to believe.**

It caught the author's own work the same day: recurring income shipped with
backend, service, hooks, tests and **no screen**.

**The backend has its own half now** — `tests/Unit/ReachableTest.php`, same
sentence, and it caught a real bug on its first run. See
[[shopos-item-rule-on-sync]] (including the PHP trap: never strip string
literals, a Laravel route names its method as one).

Related: [[shopos-offline-browse]], [[shopos-sold-out-and-reachability]], [[shopos-workflow-test-rule]].
