# A CVE pass is not a thing you do once

**2026-08-24 · CI**

"CVE pass still owed" sat on the backlog for weeks. Today it was done in two
commands:

```
composer audit  →  No security vulnerability advisories found.
npm audit       →  found 0 vulnerabilities
```

And that result is worth almost nothing on its own. **An audit that was clean in
August says nothing about September** — the whole point of an advisory is that
it gets published after somebody last looked. A pass is a snapshot; what this
needed was a gate.

So both deploy workflows run it now, before the deploy step:

| | |
|---|---|
| backend | `composer audit --locked` |
| panel | `npm audit --omit=dev --audit-level=high` |

`--locked` because advisories are about the lockfile, not about whatever
`composer install` happens to resolve on the runner.

`--omit=dev` because this gate is about **what reaches a shop's browser**. A
build tool with an advisory is worth knowing and is not worth blocking a deploy
over at 2am; a dependency inside `dist/` is. `--audit-level=high` sets the same
line.

## The check had no denominator

`0 vulnerabilities` and *the audit did not really run* print identically, and
the first attempt to prove otherwise proved nothing: lowering `--audit-level`
changed the output not at all (there is nothing to find), and passing a bogus
level only produced a warning and still exited 0.

So both were run against a project that IS vulnerable:

```
minimist@0.0.8          npm audit --omit=dev --audit-level=high  →  exit 1
guzzlehttp/guzzle@6.5.0 composer audit --locked                  →  exit 1
our panel / our backend                                          →  exit 0
```

That is the pair worth having: the command goes red where it should and green
where it should. A gate nobody has watched fail is a gate nobody knows the
polarity of.

## And a measurement that lied, in the middle of proving it

The first run of the vulnerable project printed `1 critical severity
vulnerability` and then `exit=0`, which read as "the gate does not fail". It
did fail — `$?` after a pipe is **`tail`'s** exit code, not `npm`'s.

Fourth wrong measurement of the day, same family as the rest: see
`docs/memory/shopos-measurement-that-lied.md`.
