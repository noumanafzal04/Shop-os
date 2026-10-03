---
name: shopos-check-that-cannot-fail
description: STANDING — an absence assertion passed twice with the guard deliberately removed; always mutate an absence check
metadata:
  type: feedback
---

**2026-10-04.** Wrote an e2e asserting the HR menu is ABSENT for a shop
without the module, then removed the gate on purpose to watch it fail. It
passed. Twice.

1. Looked for links named Payroll / Attendance. HRM is a **collapsible
   group** — its children are not in the DOM until expanded, so the
   assertion could never have failed.
2. Looked at the group label instead. Still passed, because the sidebar
   hides HRM in **Simple mode** and Simple is the default. It was asserting
   that a menu hidden by DENSITY was hidden, and counting it as proof the
   MODULE gate worked.
3. Switched to Full view first. Now it fails without the gate.

**Why:** an assertion that something is NOT on screen passes for every
reason it could be missing, and only one of them is the reason you meant.
A positive assertion at least fails when the thing is gone; a negative one
fails at nothing.

**How to apply:** never commit an absence check without running it against
the removed guard. And before writing one, ask what ELSE would hide the
thing — collapsed, behind a density mode, behind a permission, not yet
loaded. Related: [[shopos-detector-vs-rule]], [[shopos-fixture-on-no-plan]],
[[shopos-workflow-test-rule]].
