---
name: shopos-failed-check-is-not-a-verdict
description: "STANDING: a Workflow verify-lane died on a session limit and my script reported all 22 unverified claims as REFUTED, because a failed agent returns null and I read !verdict?.real as a refutation. Three verdicts, never two"
metadata:
  node_type: memory
  type: feedback
---

**2026-08-21.** Ran three read-only subagents (pharmacy paths, accessibility as
a class, untouched API areas), each claim to be attacked by a skeptic before
being believed. **The session hit its usage limit: 23 of 25 agents died, every
verifier among them.**

My workflow script then reported all 22 surviving claims as **`refuted`** —
because a failed agent returns `null`, and I wrote `filter(j => !j.verdict?.real)`
as the refuted bucket.

> **A failed check is not a passed check, and it is not a failed subject
> either.** Had I trusted my own output I would have discarded 22 leads, four of
> which were real defects I then found by hand.

**Why:** identical to the `HARNESS_NO_TOKEN` lesson from the same morning
([[shopos-asked-as-nobody]]) — a tool that cannot do its job must SAY SO rather
than answer anyway. Both times the bug was a two-valued verdict where three
values were needed. `mutate.py` already learned this and has CAUGHT / MISSED /
**UNCLEAR**.

**How to apply:**
- Any verify/judge lane needs **three** outcomes: confirmed · refuted ·
  **could not be checked**. Bucket by `verdict === null` FIRST, before reading
  any field on it.
- Do not let a `?.` on a possibly-null result decide a verdict. `!x?.real` is
  true for "refuted" AND for "never ran".
- When a workflow reports agent errors, **read the failure list before the
  result** — the result may be shaped by the failures.
- Subagent findings are LEADS. Four of these were verified by hand and fixed;
  two were verified and DOWNGRADED (real but unreachable from the UI); one was
  verified and REFERRED to the user as a design decision. Verify before
  believing, and be willing to say "smaller than it looked".

**Also worth keeping:** a reviewer who did not write a fix found the half that
was missing — my own morning `role="dialog"` fix had no accessible name and no
focus management, so `aria-modal` declared the page inert while focus stood in
it. *That is the whole argument for the verify lane, and it is the lane that
died.*

Related: [[shopos-asked-as-nobody]], [[shopos-detector-vs-rule]],
[[shopos-workflow-test-rule]], [[shopos-qa-sweep]]
