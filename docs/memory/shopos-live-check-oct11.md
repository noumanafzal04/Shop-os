---
name: shopos-live-check-oct11
description: Live box read from outside 2026-10-11 — works; JS/CSS/JSON uncompressed (824 KB vs 225 KB), no cache headers, CORS *, APP_NAME old; nginx lines in docs/decisions/shopos-live-check-oct11.md; root welcome page fixed in code
metadata:
  type: project
---

**2026-10-11.** The "live check" half of the user's "Dono: local full + live
check". Read-only from outside + ONE public Try-demo (Mart). No sign-in.
Full write-up with the exact nginx lines: `docs/decisions/shopos-live-check-oct11.md`.

**Works:** landing (desktop + phone), sign-in, Try demo → shop in 2.1 s, till
opens stocked and Online, health 200, http→https, no `.env`/`.git` served.

**Server-side, for the USER to do (I cannot):**
- nginx sends JS/CSS/JSON uncompressed: 824 KB first visit, 225 KB gzipped.
  Ubuntu's nginx has `gzip on` with `gzip_types` commented out.
- No `Cache-Control` anywhere (hashed assets should be immutable; `index.html`
  / `sw.js` no-cache). `manifest.webmanifest` served as octet-stream.
- `.env`: `APP_NAME` still "ShopOS"; `CORS_ALLOWED_ORIGINS` unset (`*`); set
  `PANEL_URL`.
- No HSTS / nosniff.

**Fixed in code (pushed 2026-10-11, backend `4b42792`; takes effect when deployed):** `cartze.shop/` was Laravel's welcome page →
`routes/web.php` + `App\Support\FrontDoor` (redirect to PANEL_URL or first CORS
origin; else "this is the API"). `shopos:readiness` now also checks
`admin@trueserve.app`/`Admin@123`, APP_NAME vs `.env.example`, panel address;
`SuperAdminSeeder` no longer re-sets `admin@shopos.test` on production.

This is the outside half of [[shopos-do-vps-audit]] (still pending, needs the server).
Related: [[shopos-deployment]]
