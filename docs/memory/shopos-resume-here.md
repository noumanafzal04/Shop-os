---
name: shopos-resume-here
description: RESUME POINT 2026-10-07 ~11:55 — ALL PUSHED: 3 decisions (ShopDay, reopen day, rupee labels), sidebar default Primary, journey stages I+J+K; NEXT = retail, auto, petroleum, services, online, finance
metadata:
  type: project
---

**State at 2026-10-07 ~11:55 PKT — everything is COMMITTED AND PUSHED** (backend `ee29add`, panel `e04edaf`, root docs after it). Backend 3,162 tests exit 0; vitest 172 files / 2,013; `npm run build` exit 0. Dev DB has migration `2026_10_07_000001` applied.

**Done 2026-10-07 (the three decisions, on "khud se perfect banao"):**
- One day rule, server + panel ([[shopos-shop-day]]) — and the wall-date fixes it exposed (expired medicine sellable to 05:00, lapsed quotes, due bills).
- Reopen today's closed day ([[shopos-day-closed-no-reopen]]); journey stage I 5/5 in a browser; stage G no longer skips.
- Scale price label = whole rupees ([[shopos-offline-scale-label]]).
- Sidebar default PRIMARY for shop / demo / admin, on the user's word ([[shopos-sidebar-default-primary]]).
- Journey stage J (food menu + bill, 10/10) and K (chemist, 8/8), five faults fixed ([[shopos-journey-stages-j-k]]).

**Deploy note for the user:** backend first (ONE migration), then panel. No historic figure changes.

**Next, in order:**
1. The other trades' own journey stages — retail (serials, warranty), auto (vehicles, bay board, trade-in), petroleum (meters, dips, a tanker), services, online, finance — per `docs/qa/journey/CASES.md`; food leftovers (deal with a sized item at the table, per-size recipes, 86 mid-service, hand-over). The biggest remaining piece of the standing QA request.
2. No open decisions left for the user.
3. Not built: a printed "bill please" for a table before it is settled.
4. Carried over: `core/src/api/client.ts` retries every 401; mobile bottom-sheet; Partner/Customer APKs.

**At the very end of a session the user wants:** what was done, what % is set, what is left — Roman Urdu, tables ([[shopos-reply-style]]).

**Scratch helpers (untracked, never commit):** `panel/e2e/.demo.mjs`, `panel/e2e/.shots.mjs`.

**Push method:** the user's GitHub token is NOT stored; used one-off in memory per push. Remind them to delete/regenerate it after deploy. Before every panel push: `npm run build` exit 0 ([[shopos-build-check-is-tsc-b]]).

**Slips to not repeat:** an UNQUOTED heredoc runs backticked words ([[shopos-measurement-that-lied]]); zsh `echo "$json"` turns `\n` into newlines (use a file or `print -r`); `=====` as an echo argument is a zsh expansion error.

Related: [[shopos-the-journey]], [[shopos-ui-direction-oct06]]
