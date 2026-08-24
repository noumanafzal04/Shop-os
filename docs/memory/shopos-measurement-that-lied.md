---
name: shopos-measurement-that-lied
description: STANDING — a tool that could not do its job returns something SHAPED like an answer; three in one session (wrong cwd, unquoted heredoc, soft-deleted target)
metadata:
  type: feedback
---

Three times in one session a measurement produced readable, plausible output
while the tool had not actually done the job:

| what I ran | what it looked like | what happened |
|---|---|---|
| `vitest` from the parent repo | **224 failures** | it never found the files |
| `python3 - <<PYEOF` (unquoted) | edits applied | the shell **executed the backticks in my prose**, silently deleting four code names from two memory files |
| planted a test value with `->first()` | guard "fired" | the row was **soft-deleted**; the guard never ran |
| `cd ../shopos-backend` from the parent | task "failed with exit code 1" | the cd failed; **the suite never ran**. Happened FOUR times in one session |
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
- and the general form: **a tool that could not do its job does not return an
  answer, it returns something shaped like one.**

Same family as [[shopos-token-lives-one-hour]] (97 "bugs" that were one expired
credential), [[shopos-asked-as-nobody]] and [[shopos-failed-check-is-not-a-verdict]].
