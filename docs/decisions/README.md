# Decision history

Why ShopOS works the way it does — the reasoning behind the build, what was
ruled out and why, and what each sprint actually shipped. None of it is
derivable from the code or the git log.

These files were Claude Code's persistent memory for this project. They lived
only in `~/.claude/` on one laptop until 2026-08-07, which meant a machine
rebuild would have erased every decision made between July and August 2026.
They are checked in here so that can't happen.

**Start with [`MEMORY.md`](MEMORY.md)** — it indexes the rest with a one-line
hook each.

## Restoring them as Claude's memory

```bash
mkdir -p ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory
cp docs/decisions/*.md ~/.claude/projects/-Users-<you>-PhpstormProjects-shopos/memory/
```

The directory name is the checkout path with `/` replaced by `-`. Adjust it if
your home directory or folder name differs.

## Reading them

They are a **log, not a spec.** Each was written on the day the decision was
made and reflects what was true then — a file naming a flag, an endpoint or a
column is evidence that it once existed, not proof it still does. Check the code
before acting on a detail. Where a file and the code disagree, the code wins and
the file wants updating.

Dates in filenames and headings are when the work happened. The newest ones
(`shopos-audit-aug06.md`, `shopos-modules-jul31.md`, `shopos-plans-and-flow.md`)
are the most likely to still be accurate; the oldest describe a product that has
moved on considerably.
