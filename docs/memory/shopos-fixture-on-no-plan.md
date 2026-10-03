---
name: shopos-fixture-on-no-plan
description: The nine load-test shops were on no plan at all, so the biggest fixture proved nothing about pricing
metadata:
  type: feedback
---

**2026-10-04.** Nine load-test shops the size of real businesses, three
browser projects walking them — and not one shop was on a plan. The tenant
factory handed every tenant 20 branches / 100 staff / 20 lanes as a flat
override, so no ceiling was ever near, every usage band read "ok", and the
retention window could not fire because there was no plan to carry one.

**Why:** a fixture that over-provisions everything is indistinguishable from a
fixture that tests everything. It runs green and it is measuring nothing. The
same shape as a guard that passes while blind to its own subject
([[shopos-detector-vs-rule]]).

**How to apply:** when a fixture sets a limit, ask what state it makes
UNREACHABLE. The shops now sit across the ladder, one on Basic with a
hand-granted staff allowance, and the filling station deliberately runs four
lanes on a three-lane plan — so "over a ceiling", the state the admin screen
most needs to be looked at in, is reachable at all.
