---
name: shopos-do-vps-audit
description: PENDING (user, 2026-10-09) — ChatGPT's DigitalOcean VPS + database audit brief (2GB/1vCPU, 5 shops, ~5,000 products); user asked to KEEP IT IN MEMORY; audit is read-only, report first, no blind changes
metadata:
  type: project
---

**2026-10-09, user pasted a ChatGPT brief and said "ye b memory main rkh lo".**
Not started. Do it only when the user asks.

**Target:** DigitalOcean Basic droplet, **2 GB RAM / 1 vCPU / ~50 GB SSD (~$12/mo)**,
for **5 shops, ≤1,000 products each (~5,000 total)**. Laravel + React panel +
MySQL + Redis (only if the app needs it) + queue workers + Supervisor + Nginx +
cron + PWA/POS. (Today's staging box is smaller: [[shopos-deployment]] — $6 / 1 GB.)

**The brief's rule: AUDIT FIRST, from the real repo, no blind changes.** Verify
(not from docs): Laravel/PHP versions, DB driver, Redis use (cache / queue /
session / rate limit / locks / idempotency), queue + scheduler, storage, tenancy
and branch scoping, jobs, reports, imports/exports, uploads; frontend build
memory and whether the panel can be built in CI instead of on the VPS.

**Sections it wants covered:** DB size + growth per table (sales, sale items,
inventory movements, audit logs, HR, orders, KOT…); index audit (each proposed
index must name the query, why the current one is not enough, benefit, write
cost — tenant-safe AND fast); query audit (N+1, unpaginated, counts, reports
scanning whole tables; EXPLAIN where possible); reports that should become
summaries/cached/background; MySQL / PHP-FPM / OPcache / Redis / Supervisor
config sized for 2 GB (MySQL must not take all RAM); cron overlap; storage
(product images off the VPS disk → object storage); backups (daily, retention,
**a backup never restored is not a backup**); security (SSH keys, firewall,
fail2ban, HTTPS, MySQL/Redis not public, debug off); deploy (backend steps;
panel built in CI, only `dist` shipped); monitoring + upgrade triggers; scaling
path 5 → 10 → 20 → 50 → 100+ shops.

**Deliverable — a report with A–H:** A current architecture · B "can it run on
2 GB/1 vCPU for 5 shops?" YES / YES-with-changes / NO, with why · C database
health · D RAM budget per process · E required changes P0/P1/P2 · F exact
configs (Nginx, PHP-FPM, MySQL, Redis, Supervisor, cron, firewall, SSL, backups)
· G when to move 2GB→4GB→bigger→separate DB→multiple app servers · H cost.

**Constraints that already bind this work:** NOTHING on live (the user deploys);
never query the user's `shopos` dev DB directly without asking — size estimates
come from the schema, or ask first; write the report as a file in `docs/`, not
an Artifact ([[no-claude-artifacts]]).

Related: [[shopos-deployment]], [[shopos-cicd-and-mobile]], [[shopos-import-engine-v2]]
