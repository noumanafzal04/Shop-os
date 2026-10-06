---
name: shopos-resume-here
description: RESUME POINT 2026-10-06 late night — ALL PUSHED: kitchen/floor/tab, rail, dashboard, theme cache, landing real screenshots; NEXT = food journey stage (draft uses OLD button names), other trades' flows, 3 open decisions
metadata:
  type: project
---

**State at 2026-10-06 ~23:20 PKT — everything is COMMITTED AND PUSHED** (backend `9afd893`, panel `fceb850`, root docs after it). `npm run build` exits 0; backend 3,125 tests exit 0; vitest 167 files / 1,941.

**Done on 2026-10-06 (whole day):**
- Morning/afternoon: journey stages 10–12 (105 mart cases; fresh run 103/105), 23 fixes; breadth run of the other 8 trades (stages 01–02) = 64/64.
- Evening: kitchen board in lanes + this-service window + one-press clear ([[shopos-pass-is-tonights]]); floor in one look + takeaway row + close-older; tab order-taking for tablets ([[shopos-line-changes-until-sent]]); icon rail on floor/tab/kitchen ([[shopos-work-screen-rail]]); demo shops stocked validly ([[shopos-demo-item-types]]).
- Night: dashboard + rail + remembered theme ([[shopos-dashboard-rail-theme-oct06]]); landing page real screenshots ([[shopos-landing-real-screens]]).

**Next, in order:**
1. Food journey stage: `panel/e2e/journey/20-food-the-floor.spec.ts` is an UNCOMMITTED draft written against the OLD names ("Fire to kitchen" → "Send to kitchen (n)"; kitchen "Start" → "Start cooking"; seat dialog now has party-size buttons; takeaway card no longer says "· Takeaway" in text). Update, then `JOURNEY_TRADE=food … e2e/journey/20`. Then pharmacy and the other trades' own flows per `docs/qa/journey/CASES.md`. This is the biggest remaining piece of the user's standing QA request.
2. Open decisions for the user: when a shop's day ends ([[shopos-paper-reads-shops-clock]]); scale price-label decimals ([[shopos-offline-scale-label]]); reopen a closed day ([[shopos-day-closed-no-reopen]]).
3. Not built: a printed "bill please" for a table before it is settled.
4. Carried over: `core/src/api/client.ts` retries every 401; mobile bottom-sheet; Partner/Customer APKs.

**At the very end of a session the user wants:** what was done, what % is set, what is left — Roman Urdu, tables ([[shopos-reply-style]]).

**Scratch helpers (untracked, never commit):** `panel/e2e/.demo.mjs` opens a demo shop through /demo and saves its session; `panel/e2e/.shots.mjs` screenshots pages at desk/tab/tabp/phone (`OUT= STATE= TAG= SIZES= PAGES=`).

**Push method:** the user's GitHub token is NOT stored; used one-off in memory per push. Remind them to delete/regenerate it after deploy. Before every panel push: `npm run build` exit 0 ([[shopos-build-check-is-tsc-b]]).

**A slip to not repeat:** I wrote this file once through an UNQUOTED heredoc, so the shell ran every backticked word in it as a command ([[shopos-measurement-that-lied]]). Quote the heredoc (`<<'EOF'`) whenever the body has backticks or `$`.

Related: [[shopos-the-journey]], [[shopos-ui-direction-oct06]]
