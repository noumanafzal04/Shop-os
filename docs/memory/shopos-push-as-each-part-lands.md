---
name: shopos-push-as-each-part-lands
description: USER 2026-10-15: "sb complete kro or jo hota jaye usy push krty jao" — finish the whole list and push each part as soon as it is gated; no waiting to batch
metadata:
  type: feedback
---

Finish everything on the list, and push each finished part as soon as it passes the gates — do not hold several parts back for one big push.

**Why:** the user wants work to reach GitHub continuously while the list is worked through ("sb complete kro or jo hota jaye usy push krty jao", 2026-10-15).

**How to apply:** after each part: land → five gates → secret scan → commit → push (one-off token per [[shopos-tester-and-fixer]] rules) → BUGS/SYSTEM-TEST/HANDOVER lines; then start the next part without waiting for a reply. Still report briefly. See [[shopos-docs-discipline]].
