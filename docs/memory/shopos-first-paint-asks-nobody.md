---
name: shopos-first-paint-asks-nobody
description: STANDING — fonts are LOCAL (index.css imported Outfit from Google = render-blocking, blank till on a dead line); and READ THE FAILED RUN'S TRACE before re-running — Playwright deletes it on a pass
metadata:
  type: feedback
---

**What happened (2026-10-10):** two full admin e2e runs failed in three
different places (a heading never appeared; two screens "took 7.3s"), each
passing alone. API was answering in ~20 ms, nothing refused. The failed test's
trace had it: `fonts.googleapis.com` 5.3 s + the woff2 3.4 s. `src/index.css`
began with `@import url("https://fonts.googleapis.com/…")` — part of a
render-blocking stylesheet, so EVERY screen waited on Google before first
paint; on a router that is up with the line down, a reloaded till stays blank.

**Fix:** `panel/src/assets/fonts/outfit-latin{,-ext}.woff2` + `@font-face` in
`index.css` (same subsets/ranges as Google v15, `font-display: swap`,
OFL.txt beside them); precached by the SW. Guard:
`src/test/firstPaintAsksNobody.test.ts`. Decision:
`docs/decisions/shopos-first-paint-asks-nobody.md`.

**How to apply:**
- Nothing a page needs before it can draw may live on another server — no
  `@import url(https://…)`, no outside `<link rel=stylesheet>`.
- **An intermittent e2e failure: unzip the failed run's `trace.zip` and read
  `*-trace.network` BEFORE re-running anything.** I re-ran the appearance spec
  first, it passed, and the evidence was deleted; the cause was only found
  because the NEXT run failed too. Second time the same day (first:
  [[shopos-one-admin-240-a-minute]]).
- A `.css` file imported into a vitest test is an EMPTY string, `?raw` or not —
  read it with `fs.readFileSync("src/index.css")`, and assert its length first.

Related: [[shopos-failed-check-is-not-a-verdict]], [[shopos-offline-in-a-browser]]
