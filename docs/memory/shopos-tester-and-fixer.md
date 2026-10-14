---
name: shopos-tester-and-fixer
description: STANDING (USER 2026-10-14): a cloud Claude Code session only TESTS (never fixes) from docs/qa/TESTER-BRIEF.md; I (local) fix from docs/qa/BUGS.md; reports reach me through the user
metadata:
  type: feedback
---

The user (2026-10-14): "naa k fix b kry wo sirf testing kry ga … jo bugs nikle again tumy de dn ga tum khud fix krna … apas main kaisse coordinate krna tum dono ny dekh lena".

The loop:
1. I push, then write a log line in `docs/qa/SYSTEM-TEST.md` §7 naming the three commits and what to re-test, mark bugs FIXED `<commit>` in `docs/qa/BUGS.md`, and REWRITE §5 of `docs/qa/TESTER-BRIEF.md` (R-table of re-tests + the next phase).
2. The tester pulls those commits, re-tests every FIXED since its last pass, then tests the next phase; it writes `TESTER-REPORT-<date>-<what>.md` with a "Summary for the fixer" first.
3. The user hands that report to me. I copy new bugs into `BUGS.md` with the tester's IDs (next free number is at the top of BUGS.md), fix P1 first, and go to 1.

**Why:** the cloud session cannot push (GitHub 403 "Resource not accessible by integration") and has no memory of my rules; two sessions changing the same files would collide (its pass-1 list re-found 5 bugs I had already fixed but not pushed).

**How to apply:**
- Never let the tester's list replace verification: before fixing, check its claim in the code (pass 1: 7 claims checked, all true).
- Push my fixes BEFORE handing the next pass, so the tester never tests stale code.
- Owner questions go to the user; an answer that clashes with the code's model is held and the clash stated (Q4: salary advance vs customer advance).
- Still one phase per pass and the per-phase push rule ([[shopos-system-test-in-phases]]).
