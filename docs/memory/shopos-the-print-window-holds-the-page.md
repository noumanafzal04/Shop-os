---
name: shopos-the-print-window-holds-the-page
description: STANDING — Chrome holds the page while its print window is up and DROPS a queueMicrotask queued then; React 19 died after one print. Never settle a print promise inside `afterprint`. Print is tested in a browser with a real print window (project print-window).
metadata:
  type: feedback
---

**The user's report (2026-10-12):** "print nikala to dobara print py click ni huwa … fire to kitchen, usk bad again wahn click ni huwa, na settle py … sells page view modal main print, refund … jb dobara krta to app stuck hojati, koi b route." And: "to tum test kya kr rhy ho … aisi cheezain q bhool rhy ho".

**What it was.** `common/print.ts` (my change of 6 Oct, "one print at a time") resolved the job's promise inside the iframe's `afterprint`. Chrome delivers `afterprint` while it still holds the page for the print window. The caller's continuation ran, set React state, React 19 queued its scheduling microtask (`queueMicrotask`) — and Chrome does not run a microtask queued while the page is held. Measured in real Chrome: "microtask#51 queued", never "RUNS". React had marked a render as on the way and never drew anything again: every button and every route dead until a reload. Six days, every test green.

**Why no test saw it:** headless Chromium has no print window (print() returns at once, nothing is held), and most print specs REPLACE `window.print` with a recorder. A cashier's "look at the window, close it, carry on" had never happened in a test.

**Fix:** `afterprint` only ASKS for the finish (`setTimeout(…, 0)` → a task the browser cannot start until it lets go). The frame is not removed on the no-signal guess (Safari), only on afterprint / after 60s. Focus goes back to where it was.

**How to apply:**
- Anything that prints: never run app code (resolve a promise, set state) inside `beforeprint`/`afterprint` or any handler that can fire while a print/alert window is up.
- Print is checked with a REAL print window: `PRINT_WINDOW_CDP=http://127.0.0.1:9333 E2E_BASE_URL=http://localhost:5177 npx playwright test --project=print-window` (`e2e/printWindow.ts`, `print-window.counter.spec.ts`, `print-window.kitchen.spec.ts`). It closes the window through CDP (`Target.getTargets` → `chrome://print` → Escape). Kiosk-printing was used once to prove a REAL print (PDF) — never commit that: on a machine with a printer it prints paper.
- **The user's wish (their words): "chrome bar bar open na kro, aik br open krk side py rkh lo, or empty tab b open krlo"** — one headed "Chrome for Testing" on port 9333 at the right edge (`--window-position=892,38 --window-size=620,900 about:blank`, profile in the scratchpad); every headed check attaches to it and opens a TAB. Do not launch headed browsers repeatedly. Headless runs are fine.
- A press that calls `window.print()` inside the click handler (Labels page) does not return until the window closes: start the click, close the window, then await the click.
- **Mutations of served panel code go on a COPY** (`scratchpad/panel-mut`, own port 5199, its own `cacheDir`) — the user is using the dev server. A copy that shares `node_modules/.vite` re-optimizes the REAL server's deps: give the copy `cacheDir: ".vite-mut"` and copy `tsconfig.e2e.json` too.
- Related: [[shopos-what-the-screen-adds-up]], [[shopos-workflow-test-rule]], [[shopos-screen-testing]].
