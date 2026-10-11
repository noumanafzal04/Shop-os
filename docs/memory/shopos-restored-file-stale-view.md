---
name: shopos-restored-file-stale-view
description: STANDING — after mutating a Blade view, `php artisan view:clear`; restoring it by copy keeps the OLD mtime, so Laravel goes on serving the compiled MUTANT (tests red, dev server wrong)
metadata:
  type: feedback
---

A mutation run restores each file by `shutil.copy2` and proves it with
`filecmp`. On 2026-10-11 the source was byte-identical afterwards and the
suite was still red: `resources/views/kitchen/ticket.blade.php` had been
mutated last, Laravel compiled the mutant into `storage/framework/views`, and
the restore put back the original file **with its original (older) mtime**.
Laravel recompiles only when the source is NEWER than the compiled copy — so it
kept serving the mutant, to the tests and to the user's dev server.

**Why:** `copy2` preserves timestamps; the view cache compares timestamps.
"The file is restored" was true and was not the whole state.

**How to apply:** any mutation (or temporary edit) of a `.blade.php` →
`php artisan view:clear` (and/or `touch` the file) before the final "after"
run, and treat a red "after" run with identical sources as a stale cache, not
as a flake. Same family as [[shopos-measurement-that-lied]]. PHP classes are
not affected (no opcache file cache in dev).
