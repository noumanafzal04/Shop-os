---
name: shopos-tester-and-fixer
description: CHANGED 2026-10-15 — the cloud tester's credits ran out; I now TEST AND FIX (the user: "ab sb kam tmhara hai"). Before that (2026-10-14): cloud session tested only, I fixed from docs/qa/BUGS.md
metadata:
  type: feedback
---

**2026-10-15 — CHANGED: the cloud tester's credits are finished. The user: "uski limit kam hai isliye ab short testing kr raha" then "ab sb kam tmhara hai usk credtis khtm".** I now do BOTH: fix from `docs/qa/BUGS.md`, then test what is left myself (the list the tester handed over is at the end of `docs/qa/TESTER-REPORT-2026-10-14-pass-5-part.md`; prove each thing 5 ways: screen, status, stored value, chorus, nothing else). Bug IDs continue (next B63). Keep the tracker, report files and SYSTEM-TEST §7 log exactly as before so a new tester (or a new chat) can pick up. The rest of this note is how it worked before; the bookkeeping still applies.

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
