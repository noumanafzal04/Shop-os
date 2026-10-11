---
name: shopos-check-measured-the-wrong-thing
description: STANDING — three e2e checks that passed with the fault put back (stage Q, 2026-10-10): elementFromPoint ≠ what is painted; a check inside "if not already done" never runs on resume; a form closing ≠ what the person was told
metadata:
  type: feedback
---

Found only because every fix was mutated. Each is a way an e2e check passes
while blind to its subject:

1. **"What is on top here" is not "what can be seen here."** The map-over-Save-
   bar check used `elementFromPoint` at the button's centre: Leaflet tiles are
   `pointer-events: none`, so it answered "the button" under a map covering it
   completely. Painted-over is measured in PIXELS: screenshot the element with
   the thing beneath it and without, compare sampled points (stage 28, Q12).
   Also: find the scroll parent by walking up from the element — "the first
   scrollable thing on the page" was the sidebar.
2. **A check inside `if (!alreadyDone)` does not run on a resumed business** —
   so a mutation run against a lived business cannot fail it. What must hold on
   every run goes OUTSIDE the resume guard (open the form, read it, cancel).
3. **"The form closed" is not "it was confirmed."** On Income the drawer warning
   REPLACED the "Income recorded" toast and the form still closed. Assert the
   message the person is given, and that the wrong one is absent.

Also: PHP `collect()->where('over', 'never')` matches `true` (loose compare) —
an "impossible value" mutation was equivalent. Use a value of the right type.

Related: [[shopos-detector-vs-rule]], [[shopos-workflow-test-rule]],
[[shopos-mutation-aimed-at-wrong-rule]]
