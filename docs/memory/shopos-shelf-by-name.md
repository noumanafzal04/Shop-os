---
name: shopos-shelf-by-name
description: STANDING — e2e fillCart took "any plain product", which meant 20 stray fixtures at zero stock; the suite's result depended on which project ran first
metadata:
  type: feedback
---

Two Playwright failures that were **not the product**, and cost a full
investigation to say so.

```
Error: the queue never drained.
Outbox: [{"status":"failed",
  "error":"Not enough E2E Deal Pizza (Large): only 0 in stock."}]
```

`fillCart` filled from `[data-pos-item]:not([disabled]):not([data-pos-sized])` —
"any plain product". By now that meant **twenty `E2E …` products** left behind by
sibling specs, every stray at ZERO stock while the shelf's own fourteen hold 240.
**A DEAL is not sized, so `E2E Family Deal` looked plain** and got rung.

Every step of the product was correct: the offline till sold from the mirror it
pulled at boot (that is what offline IS), the server refused the sync because the
pizza inside really had none left, the outbox recorded the refusal WITH its
reason, and `refusedRows()` shows it on the till.

**The order was the whole story.** `tablet-landscape` sold the last of it and
passed; `tablet-portrait` and `phone` found zero; `desktop` ran `deal-size.spec`
first, which restocks, and passed. `workers: 1`, `fullyParallel: false` — I
first assumed parallel contention and was wrong.

**How to apply:** a fixture-filling helper must ask for stock the suite CONTROLS,
by name — `fillCart` now filters on `E2E Shelf Item`. And when a spec fails on
some projects but not others, check what ran BEFORE it before reading the
failure as a bug in the screen.

See [[shopos-fixtures-that-breed]], [[shopos-mirror-and-refusal]],
[[shopos-the-machine-slept]].
