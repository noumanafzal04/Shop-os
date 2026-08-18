---
name: shopos-cicd-and-mobile
description: CI/CD rewritten 2026-08-09 (gates before deploy); blocked on DEPLOY_SSH_KEY. Also how to drive this workspace from the phone.
metadata: 
  node_type: memory
  type: reference
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-10T13:06:03.716Z
---

## CI/CD — rewritten 2026-08-09, freeze lifted by the user

Both workflows are now two jobs with `deploy: needs: gate`, so a red suite cannot
reach the droplet. **Gates verified green in Actions on the first run.**

- backend: setup-php 8.4 → composer → `key:generate` → `php artisan test`
- panel: npm ci → tsc → eslint → vitest → **build**

**BLOCKED: `ssh.ParsePrivateKey: ssh: no key found`.** The repo secret
`DEPLOY_SSH_KEY` is empty or malformed — usually the public key pasted instead of
the private one, trimmed BEGIN/END lines, or a passphrase-protected key. Both
workflows carry `workflow_dispatch`, so once the secret is fixed it can be
retried from the Actions tab without a commit.

What was wrong before: **no CI at all** (a push ran `migrate --force` on staging
untested), and the frontend deploy `find -delete`d `/var/www/shopos-panel`, which
is the git checkout — it could only ever work once.

**Server layout (the doc had this wrong):** `/var/www/shopos-panel` = checkout +
build (holds untracked `.env.production`); `/var/www/shopos-panel-live/` = the
Nginx root on :8080. Backend at `/var/www/shopos-api` on :80.

`git pull` → `rm -rf .github && git reset --hard`, which retires the standing
"first pull always aborts" gotcha (droplets hold hand-written copies of the
workflow files at paths the repo now tracks). `reset --hard` leaves untracked
files alone, so `.env` survives.

Gotcha found the hard way: appleboy/ssh-action takes **`script_stop`**, singular.
`script_stops` is accepted as an unknown input and only warned about.

## Driving this workspace from the phone

`/rc` is a **terminal-CLI** feature — it does not exist in the VS Code extension.
The CLI was installed 2026-08-09 (`npm i -g @anthropic-ai/claude-code`, now at
`/usr/local/bin/claude`).

```
cd /Users/devdimensions/PhpstormProjects/shopos && claude --remote-control
```
Then Claude app → Code tab. `--remote-control` skips the `/rc` step entirely.

Two traps:
- A Terminal launched **from inside** a Claude session inherits
  `CLAUDE_CODE_CHILD_SESSION` and starts with transcript saving off. Open Terminal
  yourself, or `unset` the `CLAUDE_CODE_*` vars first.
- The Mac must stay awake and online — the phone is a remote, the work still runs
  locally.

Long jobs stall on permission prompts while the phone is disconnected. Pick
"don't ask again" for `npx vitest *` / `php artisan test *` before walking away.
