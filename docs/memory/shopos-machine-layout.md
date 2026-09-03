---
name: shopos-machine-layout
description: "2026-09-03 moved machines: repos renamed (backend/panel/mobile under chordhr-web-mobile-app), ONE public GitHub repo with a branch per checkout"
metadata:
  type: reference
---

The project moved to a new Mac on 2026-09-03. **Paths and folder names changed**,
so anything in older memories written as `shopos-backend/` or
`shopos-admin-and-user-panel/` no longer resolves.

**Root:** `/Users/noumanafzal/PhpstormProjects/chordhr-app/chordhr-web-mobile-app`
(the folder name is left over from another project; it IS the ShopOS/CartZe
parent repo — `HANDOVER.md`, `docs/`, the scanners).

| folder | branch | was called |
|---|---|---|
| `.` (parent) | `main` | shopos |
| `backend/` | `offline/v1/backend` | shopos-backend |
| `panel/` | `offline/v1/admin-panel` | shopos-admin-and-user-panel |
| `mobile/` | `mobile` | shopos-mobile (NOT to be built) |

**One repo, not four:** all four checkouts point at
`https://github.com/noumanafzal04/Shop-os.git` on different branches. Nested
clones, so the parent lists `backend/ panel/ mobile/` as untracked — that is
normal and must not be committed.

**The repo is PUBLIC.** `git ls-remote` works with `GIT_TERMINAL_PROMPT=0` and no
credentials, so a fetch/pull needs no login at all. (GitHub has not accepted a
password for git since 2021 anyway — it would be a PAT or SSH, and neither is
needed here.) The user's *global* git is GitLab and is unrelated to this project.

**Toolchain here is NEWER than the old machine:** PHP **8.5.9** (composer asks
`^8.3`), Laravel **13.19**, Node **24.19**. The old machine ran PHP 8.4 /
Laravel 12. Watch for deprecations that the old box never showed.

**`node_modules` does not travel.** It came across from the old Mac and vitest
died on a missing `@rollup/rollup-darwin-arm64` — npm's optional-dependency
platform binaries are per-architecture. `npm ci` in `panel/` fixed it; expect the
same after any machine or Node major change.

`mobile/android/gradlew.bat` shows as modified with 98/98 lines changed — that is
a CRLF line-ending difference, not work. Leave it.

Related: [[shopos-docs-discipline]] (memory now syncs to `docs/memory/` under the
new root), [[shopos-deployment]].
