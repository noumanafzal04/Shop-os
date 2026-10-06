---
name: shopos-resume-here
description: RESUME POINT 2026-10-06 evening — kitchen/floor/tab rebuilt + demo fix; NEXT = sidebar black-line + polish, dashboard UI, landing screenshots (last), food journey stage
metadata:
  type: project
---

**State at 2026-10-06 evening.** Earlier the same day: journey stages 10–12 (105 mart cases, fresh run 103/105), 23 fixes pushed (backend `e111b37`, panel `a97a4e6`). Breadth run of the other 8 trades (stages 01–02) = 64/64.

**Built this evening (see the four memories linked below):** kitchen board = this service + one-press clear; floor in one look + takeaway row + close-older; tab order-taking for tablets (taps join, −/+, kitchen note, "Send to kitchen"); icon rail on floor/tab/kitchen; demo shops stocked with valid items. New tests: backend 50 (ThePassIsTonights 17, TheFloorInOneLook 12, ATabLineCanChange 15, ADemoShopSells 6), panel 28 + `food.tab-order.spec` + `food.chrome.spec` green at 3 sizes.

**Queue, in the user's order ([[shopos-ui-direction-oct06]]):**
1. Sidebar: the "black vertical line" when a submenu opens + a modest polish (sections, shop card, solid active pill). NOT STARTED in code beyond the tap-peek fix.
2. Dashboard UI — more colourful, reference = inspiration only.
3. Landing page screenshots (Dashboard + POS, good data) — LAST, after the dashboard.
4. Food journey stage: `panel/e2e/journey/20-food-the-floor.spec.ts` is an uncommitted draft written against the OLD tab/kitchen names — update, then run with `JOURNEY_TRADE=food`; then the other trades' own flows.
5. Open decisions for the user: when a shop's day ends ([[shopos-paper-reads-shops-clock]]); scale price-label decimals ([[shopos-offline-scale-label]]); reopen a closed day ([[shopos-day-closed-no-reopen]]).
6. Carried over: `core/src/api/client.ts` retries every 401; mobile bottom-sheet; Partner/Customer APKs.

**At the very end of a session the user wants:** what was done, what % is set, what is left — Roman Urdu, tables ([[shopos-reply-style]]).

**Scratch helpers (untracked, never commit):** `panel/e2e/.demo.mjs` opens a demo shop through /demo and saves its session; `panel/e2e/.shots.mjs` screenshots pages at desk/tab/tabp/phone (`OUT= STATE= TAG= SIZES= PAGES=`).

**Push method:** the user's GitHub token is NOT stored; used one-off in memory per push. Remind them to delete/regenerate it after deploy. Before every panel push: `npm run build` exit 0 ([[shopos-build-check-is-tsc-b]]).

**A slip to not repeat:** I wrote this very file through an UNQUOTED heredoc, so the shell ran every backticked word in it as a command ([[shopos-measurement-that-lied]]). Quote the heredoc (`<<'EOF'`) whenever the body has backticks or `$`.

Related: [[shopos-pass-is-tonights]], [[shopos-line-changes-until-sent]], [[shopos-work-screen-rail]], [[shopos-demo-item-types]], [[shopos-the-journey]]
