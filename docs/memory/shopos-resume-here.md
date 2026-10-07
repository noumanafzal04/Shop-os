---
name: shopos-resume-here
description: RESUME POINT 2026-10-07 ~10:40 — ALL PUSHED: the 3 open decisions built (ShopDay, reopen day, rupee scale labels) + journey stage I; NEXT = more food cases, then pharmacy and the other trades
metadata:
  type: project
---

**State at 2026-10-07 ~10:40 PKT — everything is COMMITTED AND PUSHED** (backend `b89b03b`, panel `53d0b9b`, root docs after it). Backend 3,161 tests exit 0; vitest 171 files / 1,990; `npm run build` exit 0. Dev DB has migration `2026_10_07_000001` applied.

**Done 2026-10-07 (the three decisions, on "khud se perfect banao"):**
- One day rule, server + panel ([[shopos-shop-day]]) — and the wall-date fixes it exposed (expired medicine sellable to 05:00, lapsed quotes, due bills).
- Reopen today's closed day ([[shopos-day-closed-no-reopen]]); journey stage I 5/5 in a browser; stage G no longer skips.
- Scale price label = whole rupees ([[shopos-offline-scale-label]]).

**Deploy note for the user:** backend first (ONE migration), then panel. No historic figure changes.

**Next, in order:**
1. The rest of the food list (sizes + modifiers, recipes, split bill, move / merge), then the other trades' own stages — pharmacy (batches, FEFO, Rx), retail (serials, warranty), auto, petroleum, services, online, finance — per `docs/qa/journey/CASES.md`. The biggest remaining piece of the standing QA request.
2. No open decisions left for the user.
3. Not built: a printed "bill please" for a table before it is settled.
4. Carried over: `core/src/api/client.ts` retries every 401; mobile bottom-sheet; Partner/Customer APKs.

**At the very end of a session the user wants:** what was done, what % is set, what is left — Roman Urdu, tables ([[shopos-reply-style]]).

**Scratch helpers (untracked, never commit):** `panel/e2e/.demo.mjs`, `panel/e2e/.shots.mjs`.

**Push method:** the user's GitHub token is NOT stored; used one-off in memory per push. Remind them to delete/regenerate it after deploy. Before every panel push: `npm run build` exit 0 ([[shopos-build-check-is-tsc-b]]).

**Slips to not repeat:** an UNQUOTED heredoc runs backticked words ([[shopos-measurement-that-lied]]); zsh `echo "$json"` turns `\n` into newlines (use a file or `print -r`); `=====` as an echo argument is a zsh expansion error.

Related: [[shopos-the-journey]], [[shopos-ui-direction-oct06]]
