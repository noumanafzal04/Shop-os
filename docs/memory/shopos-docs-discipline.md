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

## An index hook must not carry a STATUS

`MEMORY.md` is the only thing loaded every session, so its hooks are what I
actually read — and a hook that says what is DONE or STILL PENDING is a copy of
a fact that lives in the file. Copies drift, and this one drifts silently
because the file is right and nobody opens it.

Measured 2026-08-24: **four** hooks claimed work still owed that had shipped —
`shopos-size-picker-gap` ("variants STILL cannot be edited" while the file said
**BUILT 2026-08-23**), `shopos-food-dinein` ("recipe/BOM + POS UI still
pending"), `shopos-loyalty` ("remaining: inclusive tax"), `shopos-offline-shift-gap`
("shift open/close offline still owed"). Each one had sent me hunting something
already built, and one of them survived a whole session of me repeating it in a
pending list.

`shopos-qa-sweep-aug09` had already recorded this exact failure — *"Index said
'none fixed' for days after they were — check the file, not this line"* — which
is the point: the note existed and the shape recurred anyway, because the fix
was one line rather than the rule.

**The rule:** a hook says what the memory is ABOUT. Status lives in the file
only. Anything a hook claims is owed must be verified against the CODE before it
enters a plan — same as [[shopos-admin-side-backlog]], the record that a memory
can go stale silently.

## 2026-09-02 — and CORRECT what is already there

User: *"purana na kuch chora karo, update kiya karo."*

Appending a new entry is not the job; the OLD lines have to be corrected too. A
stale line reads exactly like a current one, and a wrong one about work that IS
done sends the next person to rebuild it.

Caught in HANDOVER's "In flight": four offline items listed as *still owed*.
**Three had been built afterwards** — the shift queue (`shiftQueue.ts`), its sync
endpoint (`flushShifts.ts` → `/pos/sync/shifts`), and opening a shift with no
server (`offlineShift.ts`, walked in a browser by `offline-shift.spec.ts`). Only
offline **hold/recall** was genuinely still owed.

The same file already warns about this in its CI/CD section — a paragraph
"believed and repeated for two weeks" — so it is the second time.

**How to apply:** when a doc paragraph touches what you are working on, VERIFY
each claim against the code and rewrite the ones that have moved, with the file
that proves it. Never leave a corrected fact only in the new entry.

