---
name: shopos-resume-here
description: RESUME POINT 2026-10-07 ~17:30 — ALL PUSHED incl. journey stages L (retail) + M (auto): backend d2391f1, panel 976f9c2, docs 7c268b7; NEXT = 4 unrun workshop mutations, then petroleum, services, online, finance
metadata:
  type: project
---

**State at 2026-10-07 ~11:55 PKT — everything is COMMITTED AND PUSHED** (backend `ee29add`, panel `e04edaf`, root docs after it). Backend 3,162 tests exit 0; vitest 172 files / 2,013; `npm run build` exit 0. Dev DB has migration `2026_10_07_000001` applied.

**2026-10-07 ~17:30 — stages L + M COMMITTED AND PUSHED** (backend `d2391f1`, panel `976f9c2`, docs `7c268b7`) on the user's word ("first commit and push… we will implement this later"). Backend 3,219 tests exit 0; vitest 178 files / 2,088; build exit 0. LEFT FOR LATER by the user's choice: 4 of 13 workshop browser mutations not run (`mut/e2e4.py`: handover-reading, billed-job-still-takes-parts, server retotal, owner-not-linked), then petroleum → services → online → finance.

**(earlier) 2026-10-07 ~13:30 — stage L (retail) DONE** in backend + panel + root docs ([[shopos-unit-sold-by-number]]). Backend 3,193 tests exit 0; vitest 177 files / 2,085; `npm run build` exit 0. Dev DB has migration `2026_10_07_000002_units_that_came_back` (DATA ONLY) applied. Deploy note: backend first (TWO migrations now: …000001 schema, …000002 data repair), then panel. Commit + push only when the user says.

**Done 2026-10-07 (the three decisions, on "khud se perfect banao"):**
- One day rule, server + panel ([[shopos-shop-day]]) — and the wall-date fixes it exposed (expired medicine sellable to 05:00, lapsed quotes, due bills).
- Reopen today's closed day ([[shopos-day-closed-no-reopen]]); journey stage I 5/5 in a browser; stage G no longer skips.
- Scale price label = whole rupees ([[shopos-offline-scale-label]]).
- Sidebar default PRIMARY for shop / demo / admin, on the user's word ([[shopos-sidebar-default-primary]]).
- Journey stage J (food menu + bill, 10/10) and K (chemist, 8/8), five faults fixed ([[shopos-journey-stages-j-k]]).

**Deploy note for the user:** backend first (ONE migration), then panel. No historic figure changes.

**Next, in order:**
1. The other trades' own journey stages — ~~retail~~ (stage L), ~~auto~~ (stage M, [[shopos-job-grows]]) — next petroleum, services, online, finance. Was: auto (vehicles, bay board, trade-in), petroleum (meters, dips, a tanker), services, online, finance — per `docs/qa/journey/CASES.md`; food leftovers (deal with a sized item at the table, per-size recipes, 86 mid-service, hand-over). The biggest remaining piece of the standing QA request.
2. No open decisions left for the user.
3. Not built: a printed "bill please" for a table before it is settled.
4. Carried over: `core/src/api/client.ts` retries every 401; mobile bottom-sheet; Partner/Customer APKs.

**At the very end of a session the user wants:** what was done, what % is set, what is left — Roman Urdu, tables ([[shopos-reply-style]]).

**Scratch helpers (untracked, never commit):** `panel/e2e/.demo.mjs`, `panel/e2e/.shots.mjs`.

**Push method:** the user's GitHub token is NOT stored; used one-off in memory per push. Remind them to delete/regenerate it after deploy. Before every panel push: `npm run build` exit 0 ([[shopos-build-check-is-tsc-b]]).

**Slips to not repeat:** an UNQUOTED heredoc runs backticked words ([[shopos-measurement-that-lied]]); zsh `echo "$json"` turns `\n` into newlines (use a file or `print -r`); `=====` as an echo argument is a zsh expansion error.

Related: [[shopos-the-journey]], [[shopos-ui-direction-oct06]]
