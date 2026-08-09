---
name: shopos-deployment
description: "Staging deploy — droplet shopos-dev 159.223.78.102 ($6/1GB Ubuntu 24.04, 4GB swap); backend live at /api/v1/health; panel on :8080 (unconfirmed — may need DO cloud firewall port open)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-30T11:47:45.915Z
---

**Staging server (set up 2026-07-29):** DigitalOcean droplet **shopos-dev**, IP **159.223.78.102**, $6/mo 1 GB RAM Ubuntu 24.04, **4 GB swap** (doubled from the brief's 2 GB because RAM is halved on the $6 box). Installed: Nginx, MySQL 8, PHP 8.4-FPM, Composer, Node 20.

**Backend** — cloned `backend` branch → `/var/www/shopos-api`. DB `shopos` created; `migrate --seed` ran clean (**228 API routes**). `.env` = production, config/route/view cached. Queue worker via **Supervisor** running; **cron** scheduler active. LIVE-VERIFIED: `http://159.223.78.102/api/v1/health` → healthy JSON. (Backend serves on **port 80**.)

**Frontend** — cloned `admin-panel` branch, **built on the droplet** (plan changed from build-on-Mac; worked despite 1 GB + swap). Two directories, and the split matters: `/var/www/shopos-panel` is the **git checkout + build** (holds untracked `.env.production`), and `npm run build` output is copied into `/var/www/shopos-panel-live/`, which is the **Nginx root** on **port 8080** (80 is taken by the API; no domain yet to split by hostname). Anything that treats the checkout as the web root destroys the source tree — that was exactly the old deploy bug below.

**Pending / gotchas:**
- Not yet confirmed the panel loads at `http://159.223.78.102:8080/` (ran `curl -I`, result unseen).
- If it doesn't load: **DigitalOcean cloud firewall** (separate from `ufw`, which is inactive) likely needs **port 8080 opened** via DO dashboard → Networking → Firewalls.
- Still TODO before any real use (from the deploy brief): change the seeded Super Admin (`admin@shopos.test` / `password`), confirm `APP_DEBUG=false`, rotate shared secrets. A real domain would let both API + panel share port 80/443 by hostname (+ certbot HTTPS) instead of the :8080 split.

**CI/CD (added 2026-07-30, rewritten 2026-08-09):** GitHub Actions on push, one repo (`noumanafzal04/Shop-os`), two branches. Both workflows are now **two jobs**: a `gate` that must pass before `deploy` runs at all, and the SSH deploy itself. Both use `appleboy/ssh-action` with `script_stops: true`, and need repo secrets **DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY**.

- `backend` → `deploy-backend.yml`. Gate: PHP 8.4, `composer install`, `.env.example` + `key:generate`, `php artisan test` (phpunit pins sqlite `:memory:`, so no DB service). Deploy: fetch + `reset --hard`, `composer install --no-dev`, `migrate --force`, config/route/view cache, `chown` storage, `supervisorctl restart shopos-worker`, target `/var/www/shopos-api`.
- `admin-panel` → `deploy-frontend.yml`. Gate: Node 20, `npm ci`, `tsc --noEmit`, `eslint src`, `vitest run`, **and a full build** — a build that only fails on the droplet fails *after* the checkout has already moved to the new commit. Deploy: fetch + `reset --hard`, `npm install`, `npm run build`, assert `dist/index.html` is non-empty, then `cp -r dist/. /var/www/shopos-panel-live/`.

**Why `git reset --hard` and not `git pull`:** each droplet has an **untracked** `.github/workflows/*.yml` created by hand there, and the repo now tracks that same path — so `git pull` aborts every time with "untracked working tree files would be overwritten". Both scripts `rm -rf .github` first and then reset, which is deterministic and restores the tracked copy. `reset --hard` leaves untracked files alone, so the droplet's `.env` / `.env.production` survive.

**The old frontend deploy was a one-shot self-destruct** (fixed 2026-08-09): it ran `find /var/www/shopos-panel -mindepth 1 -not -name '.env.production' -not -path '*/.git*' -delete` against the **git checkout**, so run #1 deleted `package.json`, `src/` and `node_modules`, and run #2's `git pull` (which does not restore uncommitted deletions) left `npm install` with nothing to install. It also no longer matched reality — the server had already been split into checkout vs `-live` web root by hand.

**Known, accepted:** `cp -r dist/.` never removes superseded hashed assets from `-live`, so they accumulate. Deliberate over `rsync --delete`: deleting chunks a client is mid-session on breaks that client. Wants an occasional sweep, not a `--delete` on every deploy.

**Served over plain HTTP** (no domain/HTTPS yet) → browser **secure-context** APIs are unavailable. Hit this once already: `crypto.randomUUID` is undefined over HTTP and crashed the POS — fixed with a `src/common/uuid.ts` fallback (getRandomValues v4). Same class of issue will bite clipboard / service-worker (offline PWA) later; the real fix is a domain + certbot HTTPS.

Deploy brief details + full stack in the conversation; sizing rationale in [[shopos-payments-status]] is unrelated — this is infra only.
