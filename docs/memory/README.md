# A verbatim snapshot of Claude Code's memory directory

**Not for reading.** The long-form reasoning lives in [`../decisions/`](../decisions/);
these are its short, frontmatter-carrying index entries, kept here so a wiped
laptop can be restored exactly.

`MEMORY.md` in this directory is the live index — the one loaded into context at
the start of every session.

## Why this directory exists

`docs/decisions/` was created to stop the reasoning existing **only** in
`~/.claude/` on one machine. It did not finish the job:

- Nine memories had no `docs/` counterpart at all — including two STANDING rules
  (`shopos-workflow-test-rule`, `shopos-detector-vs-rule`). A wipe would have
  taken them.
- The restore command in `HANDOVER.md` copied `docs/decisions/*.md` **into** the
  memory directory. Those files are longer, differently written, and carry no
  frontmatter — so restoring would have overwritten 24 memories with documents
  the memory system cannot index by description.
- `docs/decisions/MEMORY.md` had drifted into being **wrong**, not merely stale:
  it still described the admin-side backlog as "REQUESTED, not built" months
  after it shipped. A restore handed a new machine a false index.

A backup that has never been restored is a belief, not a backup.

## Refreshing it

```bash
./scripts/sync-memory.sh          # memory dir → docs/memory/
./scripts/sync-memory.sh --check  # exits 1 if they differ, for CI or a habit
```

Run it in the same pass as writing a memory, for the same reason the decisions
are written as work happens: this machine may be rebuilt at any time.
