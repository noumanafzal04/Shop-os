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
2. Update or add the relevant file in `docs/decisions/` (the mirror of Claude's
   memory dir) and its `MEMORY.md` index line.
3. Push. Work that is only on the laptop does not exist.

**Why:** on 2026-08-07 an audit for exactly this found two things that would
have been destroyed permanently — the mobile app had no git repository of its
own (562 files, ~55% complete, sitting in a folder the parent branch ignores),
and 31 files of decision history lived only in `~/.claude/`. Both are now in
git. The rule exists so that gap can never reopen.

**How to apply:** treat "is this in git and described in HANDOVER.md?" as part
of finishing a task, alongside the test gates. Half-finished work goes on a
`wip/*` branch with a commit message saying exactly what is done and what is
left — never left uncommitted. See [[shopos-audit-aug06]] and
[[shopos-build-sequence]].
