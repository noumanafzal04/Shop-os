---
name: shopos-exit-code-not-summary
description: "STANDING: judge the backend suite by its EXIT CODE, not the summary line. `php artisan test` reported \"2225 passed\" while exiting 1 — a PHPUnit warning. The suite had been RED for as long as the mismatch existed."
metadata:
  type: feedback
---

**2026-08-25.** The CI gate went red on its first run against a working branch.
For an hour it looked like a Linux-only failure. It was not:

```
Tests:  1 warning, 2225 passed (9344 assertions)
Process completed with exit code 1
```

**No test failed.** A PHPUnit 11 warning — a data provider handing a test three
arguments where the method accepts one — takes the process to exit 1. The suite
had been red for as long as that mismatch existed, on CI *and locally*.

**Why I could not see it:** every backend run I read came back as
`{"tool":"phpunit","result":"passed","tests":2225,...}`. That summary has no
opinion about the exit code. I said "backend green" all day on the strength of a
line that was not measuring the thing I was claiming.

**How to apply:**
- Judge the backend suite by `echo $?`, never by the summary. `./vendor/bin/phpunit; echo "EXIT=$?"`.
- When stdout is being rewritten, make the tool write a FILE and read that:
  `./vendor/bin/phpunit --log-events-text /tmp/ev.txt` then
  `grep -c "Triggered PHPUnit Warning" /tmp/ev.txt`.
- CI job LOGS need admin rights (403); **annotations do not**. Emit `::error::`
  lines so a red gate can be diagnosed by whoever sees it go red.
- Fix a provider/arity mismatch by DERIVING a narrower provider
  (`array_map(fn ($r) => [$r[0]], self::trades())`) — not by adding unused
  parameters (a signature that lies) and not by a second hand-written list
  (two copies, one gets updated).

Fifth entry in [[shopos-measurement-that-lied]]: wrong cwd, unquoted heredoc,
soft-deleted target, machine asleep, **and a summary that swallowed the exit
code**. Related: [[shopos-cicd-and-mobile]], [[shopos-the-machine-slept]].
