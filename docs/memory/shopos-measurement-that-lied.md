---
name: shopos-measurement-that-lied
description: STANDING — a tool that could not do its job returns something SHAPED like an answer; three in one session (wrong cwd, unquoted heredoc, soft-deleted target)
metadata:
  type: feedback
---

SEVEN times in one session a measurement produced readable, plausible output while
the tool had not actually done the job. Four of the six were a relative path:

| what I ran | what it looked like | what happened |
|---|---|---|
| `vitest` from the parent repo | **224 failures** | it never found the files |
| `python3 - <<PYEOF` (unquoted) | edits applied | the shell **executed the backticks in my prose**, silently deleting four code names from two memory files |
| planted a test value with `->first()` | guard "fired" | the row was **soft-deleted**; the guard never ran |
| `cd ../shopos-backend` from the parent | task "failed with exit code 1" | the cd failed; **the suite never ran**. Happened FOUR times in one session |
| `npx playwright test --project=desktop` from the parent | `Project(s) "desktop" not found. Available projects: ""` | no config found — it ran nowhere, and the MUTATION it was proving therefore proved nothing |
| a python heredoc writing `Path("src/…")` from the parent | printed nothing alarming; the guard clause exited | **the file was never written**, and `npx vitest` on the same path then answered "15 passed" — about tests that did not exist |
| `tsc --noEmit -p tsconfig.app.json` | typecheck clean | it does **not cover test files** — `npm run build` (`tsc -b`) does, and it failed on an `Object.hasOwn` the app config never looked at |

**Why:** none of them errored. Each returned something with the shape of a
result, and each shape was the shape of the answer I was expecting.

**How to apply:**

- before believing a red result, ask whether the tool RAN — a suite that
  "fails" 224 tests found no files, and one that "fails with exit code 1" may
  never have started;
- the panel's typecheck gate is `tsc --noEmit -p tsconfig.app.json` and it
  EXCLUDES the tests. `npm run build` is what compiles them, and a broken test
  file takes down the Playwright webServer with "Process from config.webServer
  was not able to start" — a message that says nothing about the real cause;
- **use absolute paths.** Relative `cd` between the three repos broke four times
  in one session, because the shell's cwd is wherever the last command left it
  and that is not where the last MESSAGE was about;
- quote the heredoc delimiter (`<<'PYEOF'`) whenever the body contains backticks
  or `$`;
- when planting a value to prove a guard fires, plant it on the row the system
  actually reads — check `deleted_at`, scopes, and which of several duplicates
  is live;
- **count the backslashes when a regex is written by a script that writes a
  script.** A `\\\\` inside a heredoc landed as four literal backslashes, so an
  import scanner matched nothing and returned `[]` — which reads exactly like
  "nothing is wrong". The mutation that was supposed to prove the new check
  worked instead proved it did not, and only because the mutation existed;
- **do not read a finding list through `grep -A2` or `tail -8`.** Three times
  now a truncating window has hidden entries and made me draw the wrong
  conclusion about the tool's output — once nearly filing "the sweep's reuse
  branch never runs";
- **playwright's webServer has `reuseExistingServer: true`** and serves a BUILT
  `dist` via `vite preview`. A preview process left over from an earlier run
  keeps serving the OLD bundle, so a new e2e fails against code that is not on
  the page. Kill port 4173 (`lsof -ti:4173 | xargs kill -9`) before trusting an
  e2e failure that says a control is missing;
- and the general form: **a tool that could not do its job does not return an
  answer, it returns something shaped like one.**

Same family as [[shopos-token-lives-one-hour]] (97 "bugs" that were one expired
credential), [[shopos-asked-as-nobody]] and [[shopos-failed-check-is-not-a-verdict]].
