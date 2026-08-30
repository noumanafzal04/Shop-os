---
name: shopos-suite-vs-itself
description: STANDING — never run phpunit/vitest/builds while Playwright runs; a starved suite crosses the 60-min token TTL and reports the signed-out shell as product bugs
metadata:
  type: feedback
---

I ran the full backend suite, a full vitest run, and four `npm run build`s
**while a Playwright suite was running against the very `dist/` I kept
rebuilding**. It reported **16 failures** with durations of 43 minutes, 1.3
hours and 4.1 hours, plus an accessibility ratchet saying `2/5 unnamed` on every
admin screen. Five vitest timing tests "failed" the same way.

None of it was real. `e2e/api.ts` **already has the diagnosis in a comment**:
a starved suite crosses `ACCESS_TTL_MINUTES = 60`, every spec after that point
is measuring the SIGNED-OUT shell, and it looks like "no product cards",
"no sellable products", and the same two unnamed controls on every screen.

**How to apply:**
- Run Playwright ALONE. No phpunit, no vitest, no `npm run build` alongside it.
- Never rebuild `dist/` under a running suite — the preview serves the new
  bundle mid-run, so specs measure a mix of two apps.
- A duration wildly larger than the test's normal one is the tell. Check
  durations BEFORE reading the failure messages.
- Throw a contaminated run away. Do not report any of it, not even the parts
  that look plausible.

Related: [[shopos-the-machine-slept]], [[shopos-measurement-that-lied]],
[[shopos-token-lives-one-hour]].
