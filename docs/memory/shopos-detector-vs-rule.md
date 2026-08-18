---
name: shopos-detector-vs-rule
description: guard tests kept passing because their detectors only recognised the exact shapes already fixed — three instances in one day
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-18T05:57:22.633Z
---

2026-08-18. Three guard tests in this codebase reported clean sweeps while the
defect they guard was still present, all for the same reason.

| guard | what it could not see |
|---|---|
| `scripts/dead-endpoints.py` | stripped string literals — **in Laravel a route names its method as a string** |
| `destructive.test.ts` | anchored word list vs a label written as a ternary (`{busy ? "Removing…" : "Remove review"}`) — every destructive button with a spinner |
| `rowAction.test.ts` | detector was **two literal class strings: the exact two the previous sweep had replaced** |

The third found **17 bare row actions in table cells**, several in rows where
Delete had been swept and the Edit beside it had not — worse than neither,
because the pair stops reading as a pair.

> **A detector that recognises the instances somebody already found is not a
> rule. It is a record of one afternoon.**

**Why:** a passing guard is read as evidence. When its matcher is narrower than
its stated rule, it actively conceals the thing it was written to catch — and
the docblock keeps claiming the broad rule.

**How to apply:**
- When a guard test flags NEW code, first ask whether it can actually READ the
  code before assuming the code is wrong. Twice this was the parser, not the
  subject — and fixing the parser found real defects immediately.
- Give every scanning guard a **denominator** assertion (count of files, `<td>`,
  buttons found). A broken matcher then fails instead of reporting zero.
- Write the detector against the SHAPE (a button with no padding) not against
  the STRINGS you just replaced.
- After broadening one, re-run it before trusting the result: the first run of
  the endpoint audit was 5 findings / 3 false, the second 1 / 0.

Related: [[shopos-endpoint-reachability]], [[shopos-item-rule-on-sync]],
[[shopos-reachability-rule]], [[shopos-ui-sweep-aug17]].
