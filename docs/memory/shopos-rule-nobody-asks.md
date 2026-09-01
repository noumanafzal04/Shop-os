---
name: shopos-rule-nobody-asks
description: FIXED — Tenant::real() was written for "every platform figure" and called by NOBODY; the console counted demo shops as businesses (5 where 2 were real); found by scripts/dead-rules.py
metadata:
  type: project
---

**Found by running the scanners the repo already had**, with nothing left on the
plan. `scripts/dead-rules.py`: *"NOBODY ASKS THESE, AND NOBODY HAS SAID WHY —
scope `real()` on Tenant"*.

Its own docblock named the callers:

> the places that must exclude it are the marketplace, every platform figure and
> every admin list

The **marketplace fences demos itself** (`marketplaceVisible()` carries its own
`where('is_demo', false)`) — which is exactly why nobody noticed the rest. Every
figure on the platform console counted a shop a stranger was handed from the
landing page and which is deleted the next day: total, active, suspended, online
shops, the growth chart, the business-type spread, plan spread, module adoption
and the five most recent shops.

**Measured: 5 reported where 2 were businesses.**

`new_this_month` was the worst — demos are given away from a public page, so a
growth figure that includes them is a marketing metric measuring its own landing
page.

**Why:** a rule can be written, documented and correct, and simply never called.
One caller (the marketplace) doing it inline is enough to make the gap invisible
forever.

**How to apply:**
- run `scripts/dead-rules.py` when there is nothing else on the list; a scope
  with no callers is either dead or a rule nobody is applying, and it will not
  tell you which — go and look.
- when excluding a class of row, publish the excluded COUNT rather than dropping
  it: "how many people are trying it" is a real question.
- name both halves (`real()` / `demo()`) so they stay complements — the day a
  third state appears, both must move together or a row is counted twice or
  never.

Related: [[shopos-detector-vs-rule]], [[shopos-promise-in-another-file]],
[[shopos-low-stock-one-rule]], [[shopos-the-front-door]].
