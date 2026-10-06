---
name: shopos-resume-here
description: RESUME POINT 2026-10-06 13:40 PKT — mart journey 12 stages green + 16 fixes ALL PUSHED; next = fresh mart run, 8 other trades, 2 open decisions
metadata:
  type: project
---

**State at 2026-10-06 ~15:20 PKT — everything is COMMITTED AND PUSHED** (backend `e111b37`, panel `a97a4e6`, root `03e1df3`). `npm run build` exits 0 — run it before EVERY panel push ([[shopos-build-check-is-tsc-b]]).

**Done this session:** journey stages 10 (volume), 11 (admin returns), 12 (settings) — 105 cases for a mart; 16 product faults fixed, listed in `docs/qa/journey/RUNS.md` and HANDOVER "The QA journey … 2026-10-06". The two the user reported from the counter: [[shopos-line-keys]] and [[shopos-roll-is-a-roll]].

**Next, in order:**
1. DONE 2026-10-06: fresh mart journey from stage 01 in one sitting = 103/105, 2 not run by design ([[shopos-day-closed-no-reopen]]). ~~A FRESH mart journey from stage 01~~ (`cd panel && E2E_BASE_URL=http://localhost:5177 npx playwright test --project=journey --reporter=line`) — stages 10–12 were built against the shop stages 01–09 made; a clean run proves the order. Stage 09's hand-worked figures only hold right after stage 08.
2. The other 8 trades (`JOURNEY_TRADE=food` …) with their extra cases in `docs/qa/journey/CASES.md`. Biggest remaining piece of the user's QA request (~55% left).
3. Two decisions waiting on the user: when a shop's day ends ([[shopos-paper-reads-shops-clock]]); scale price-label decimals ([[shopos-offline-scale-label]]).
4. `core/src/api/client.ts` (mobile) still retries every 401 — fix with the mobile work.
5. Carried over: mobile bottom-sheet (core+mobile uncommitted), Partner/Customer APKs.

**The user asked for, at the very end of a session:** a list of what was done, what % is set, and what is left — in Roman Urdu, as tables ([[shopos-reply-style]]).

**Journey shop:** "QA Mart 1005-231446" (`panel/e2e/.journey/mart.json`), all modules on, settings restored to what they were.

**Push method:** the user's GitHub token is NOT stored; used one-off in memory per push. Remind them to delete/regenerate it after deploy.

Related: [[shopos-the-journey]], [[shopos-settings-what-listens]]
