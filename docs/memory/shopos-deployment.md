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

**Frontend** — cloned `admin-panel` branch, **built on the droplet** (plan changed from build-on-Mac; worked despite 1 GB + swap). `npm run build` output → `/var/www/shopos-panel`, Nginx serves on **port 8080** (80 is taken by the API; no domain yet to split by hostname).

**Pending / gotchas:**
- Not yet confirmed the panel loads at `http://159.223.78.102:8080/` (ran `curl -I`, result unseen).
- If it doesn't load: **DigitalOcean cloud firewall** (separate from `ufw`, which is inactive) likely needs **port 8080 opened** via DO dashboard → Networking → Firewalls.
- Still TODO before any real use (from the deploy brief): change the seeded Super Admin (`admin@shopos.test` / `password`), confirm `APP_DEBUG=false`, rotate shared secrets. A real domain would let both API + panel share port 80/443 by hostname (+ certbot HTTPS) instead of the :8080 split.

**CI/CD (added 2026-07-30):** GitHub Actions auto-deploy on push, one repo (`noumanafzal04/Shop-os`) two branches. `backend` → `.github/workflows/deploy-backend.yml` (SSH: git pull + `composer install --no-dev` + `migrate --force` + config/route/view cache + `supervisorctl restart shopos-worker`, target `/var/www/shopos-api`). `admin-panel` → `.github/workflows/deploy-frontend.yml` (SSH: git pull + npm install + build, then `find -delete` the web root except `.env.production`/`.git` and copy `dist/*` in, target `/var/www/shopos-panel`). Both use `appleboy/ssh-action` and need repo secrets **DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY**.

**Two deploy gotchas (both real):**
1. Each droplet has an **untracked** `.github/workflows/*.yml` (created by hand there). The pushed commit adds that same path as tracked, so the deploy's first `git pull` **aborts** ("untracked working tree files would be overwritten"). Fix: `rm -f /var/www/shopos-api/.github/workflows/deploy-backend.yml` and `rm -f /var/www/shopos-panel/.github/workflows/deploy-frontend.yml`, then re-run.
2. Frontend `find -delete` wipes the source tree (package.json/node_modules/src) on run #1, so run #2's `git pull`/`npm install` **fail**. Needs a `git reset --hard && git clean` at the top, or build-to-separate-webroot. Not yet fixed.

**Served over plain HTTP** (no domain/HTTPS yet) → browser **secure-context** APIs are unavailable. Hit this once already: `crypto.randomUUID` is undefined over HTTP and crashed the POS — fixed with a `src/common/uuid.ts` fallback (getRandomValues v4). Same class of issue will bite clipboard / service-worker (offline PWA) later; the real fix is a domain + certbot HTTPS.

Deploy brief details + full stack in the conversation; sizing rationale in [[shopos-payments-status]] is unrelated — this is infra only.
