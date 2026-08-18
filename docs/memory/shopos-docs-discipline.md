---
name: shopos-docs-discipline
description: "STANDING RULE from 2026-08-07 — keep HANDOVER.md + docs/decisions/ updated as work happens, so the laptop can be wiped at any moment"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T06:47:55.981Z
---

Keep the repo's markdown current **as work happens**, not at the end. The user
may reinstall their machine at any time and rebuild only from git.

After any meaningful unit of work, before moving on:

1. Update `HANDOVER.md` on `main` — the running log section, what shipped, test
   counts, what's now pending, anything half-built and which branch it's on.
2. Update or add the relevant file in `docs/decisions/` — the long-form
   reasoning, written for a person.
3. Write or update the memory note, then run `./scripts/sync-memory.sh` so
   `docs/memory/` (the verbatim snapshot of the memory dir) matches.
4. Push. Work that is only on the laptop does not exist.

**`docs/decisions/` is NOT a mirror of the memory directory** — believing that
is what broke the restore. The documents are long, written for a reader, and
carry no frontmatter; the notes are short and indexed by their `description`.
Restore from `docs/memory/`, never from `docs/decisions/`.

**Why:** on 2026-08-07 an audit for exactly this found two things that would
have been destroyed permanently — the mobile app had no git repository of its
own (562 files, ~55% complete, sitting in a folder the parent branch ignores),
and 31 files of decision history lived only in `~/.claude/`. Both are now in
git. The rule exists so that gap can never reopen.

It reopened anyway, quietly, and was found on **2026-08-18**: the restore command
copied the wrong direction of the wrong directory, nine notes (including two
STANDING rules) had no counterpart in git at all, and `docs/decisions/MEMORY.md`
had drifted into being actively **wrong** rather than merely stale. **A backup
that has never been restored is a belief, not a backup** — the same shape as
every "built but unreachable" finding, applied to the docs themselves.

**How to apply:** treat "is this in git and described in HANDOVER.md?" as part
of finishing a task, alongside the test gates. Half-finished work goes on a
`wip/*` branch with a commit message saying exactly what is done and what is
left — never left uncommitted. See [[shopos-audit-aug06]] and
[[shopos-build-sequence]].
