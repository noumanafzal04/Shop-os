---
name: shopos-landing-real-screens
description: Landing hero now shows REAL screenshots (Dashboard / POS tabs, phone variants); taken from restaurant@loadtest.test, which the user had me rename to "Zaiqa Grill House"; retake with panel/scripts/landing-shots.mjs
metadata:
  type: project
---

**2026-10-06, user:** take good screenshots with good data, primary colour, "90% zoom … jispe perfect aye", from `restaurant@loadtest.test`, and put them on the landing page. Earlier the same day: landing gets **Dashboard and POS** screens — NOT kitchen/dine-in.

**What exists:** `panel/src/modules/landing/components/ProductShots.tsx` (one window, two tabs; `<picture>` with a phone source below `sm`), `panel/public/landing/{dashboard,pos}{,-1280,-phone}.webp`, and the "owner's day" phone frame uses `dashboard-phone.webp`. The drawn mocks `AppWindowMock` / `DashboardMock` / `dashboardData` are deleted (`TillMock` stays — TradeSwitcher uses it). 1600×1000 @2x = "90% zoom" of a 1440 screen.

**Changed in the user's DEV database at their word, through the app's API (stays changed):** tenant "Karahi House" → **"Zaiqa Grill House"**; its owner's display name → "Ahmed Raza"; 9 expenses dated 30 Sep–6 Oct. Password for that account is the usual `password`. Its logo is the True Serve app icon.

**Done to the page only, at capture:** appearance handle hidden; " #n" load-test serials stripped from text nodes.

**How to apply:** when the dashboard or the till changes shape, retake (script header explains) — nothing fails if nobody does. `ProductShots.test.tsx` only guarantees the files it names exist.

Related: [[shopos-the-front-door]], [[shopos-dark-shop-lit-counter]], [[shopos-ui-direction-oct06]]
