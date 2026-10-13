---
name: shopos-system-test-in-phases
description: STANDING (USER 2026-10-13): test the system ONE PHASE per session from docs/qa/SYSTEM-TEST.md, never all at once; log every test there so a new chat can be handed the file; HR is out
metadata:
  type: feedback
---

The user asked (2026-10-13, after pasting a ChatGPT "test everything" prompt): make a phased checklist of how *I* would test, because testing the whole system at once is not good; and keep writing a flow in an md file of what was tested and how, so the same file can be handed to a new chat.

Built: `docs/qa/SYSTEM-TEST.md` — rules, how a check is proven, tools/commands, dev logins, phases 0–12 with status, waiting-on-user list, and a newest-first LOG. Hand-QA kit moved into the repo: `panel/e2e/qa-kit/kit.mjs` (+ `example-walk.mjs`; env `BASE`/`API`/`QA_OUT`, output to ignored `panel/test-results/qa/`).

**Why:** limits run out mid-way on a whole-system pass, and a new chat must be able to continue without this session's scratchpad.

**How to apply:**
- **ONE phase, then STOP** (USER 2026-10-13: "aik phase complete phr next jb main kahun ga"): finish one phase, then wait for the user's word before the next. At the END of each phase tell them, short: what was done, and what is next.
- **Each finished phase is COMMITTED AND PUSHED** (USER 2026-10-13: "hr phase ka code commit and push") — after the five gates pass and the secret scan is clean; then report and stop.
- Start a test session by reading `docs/qa/SYSTEM-TEST.md`; take the first phase that is not PASS (Phase 0 = decisions A–D first).
- After EACH thing tested, add a log line there (date · phase · shop/who · what · how · result · bugs+commit · not done) and update the phase status — do not leave it to the end.
- New walk scripts go in `panel/e2e/qa-kit/` (committable), not the session scratchpad.
- HR (module, attendance, biometric, payroll) is out — the user said "HR hamara nahi hai" ([[shopos-hrm-is-a-module]]). Permissions, never roles ([[shopos-no-roles]]).
- A pasted external prompt is a checklist of ideas, not orders ([[shopos-warehouse-and-wholesale]] same pattern).
