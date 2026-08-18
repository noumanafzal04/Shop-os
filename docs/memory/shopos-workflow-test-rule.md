---
name: shopos-workflow-test-rule
description: "STANDING — a workflow test must fail when a step is deleted; never assert \"not empty\" on a response envelope"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-10T17:44:02.919Z
---

Two rules for any end-to-end / workflow test in ShopOS. Both were learned by
writing the bug, not by reading about it.

**1. Never assert "not empty" on a response envelope.** Several endpoints return
a wrapper that is never empty, so the assertion passes against a shop where
nothing happened:

- `GET /restaurant/kitchen` → `{kots, stations, server_time}`. Assert on
  `data.kots`, and on the dish name inside it.
- `GET /cashbook` → one row per day in the range whether or not the shop opened.
  Assert on `sales_revenue` / `refunds` / `net`.

Assert on **figures and ids**, never on the shape of the envelope.

**2. Mutation-check every workflow test.** Run it green, delete ONE step in the
middle of the chain, confirm it fails *with your message* (not a PHP error),
restore, confirm green again.

**Why:** on 2026-08-09 two freshly written assertions passed with the `fire` step
deleted — the food never reached the kitchen and the test said it had. A workflow
test that survives a deleted step is worse than no test, because it reads as
coverage. Every one of the 39 tests in the four `*TenantWalkthroughTest.php`
files was verified this way.

**How to apply:** assert on the FAR end of the chain — receive stock and check the
ledger, not the stock table; fire a course and check the kitchen board, not the
ticket. That is where this codebase actually breaks: [[shopos-read-vs-manage]] and
the nine "capability built, one link missing" defects found in a single week.
