---
name: shopos-landing-real-screens
description: Landing shows REAL screenshots: hero = dashboard ONLY (window tilted like a laptop + same screen on a phone); POS has its own "At the counter" section; taken from restaurant@loadtest.test (renamed "Zaiqa Grill House" at the user's word)
metadata:
  type: project
---

**2026-10-06.** The user asked for real screenshots with good data on the landing page ("90% zoom … jispe perfect aye"), from `restaurant@loadtest.test`.

**What exists now:** `panel/src/modules/landing/components/ProductShots.tsx` exports `ProductShot({ shot: "dashboard" | "pos", first? })` — a window leaning back (`perspective` on the parent, `rotateX(11deg)`, hinged at the bottom), fading out over its last seventh, with an upright phone in front showing the SAME screen. Hero = `shot="dashboard" first`. A new dark section `#counter` ("At the counter") after the offline argument = `shot="pos"`. The owner's-day phone uses `dashboard-phone.webp`. Files in `panel/public/landing/` (six webp, 42–120 KB); retake with `panel/scripts/landing-shots.mjs`. Drawn mocks `AppWindowMock` / `DashboardMock` / `dashboardData` are deleted (`TillMock` stays — TradeSwitcher uses it).

**The user sent the hero back four times in one evening — keep these as decided:**
1. "hero section now not looks good" — my picture sat in a `.settles` scroll-reveal and at 1366×768 never crossed its threshold: an empty dark band under the buttons. **Nothing above the fold goes in a scroll-reveal.** Also: thin window bar, soft bottom.
2. "POS ke sath POS mobile ki lagao" — the phone shows the SAME screen as the window, not the other one.
3. "tilt … jaise laptop hota" — the window leans back; the phone stays upright.
4. "hero main dashboard ki hi lagayen gy image" — NO tabs in the hero; dashboard only. POS lives in its own section.

**Changed in the user's DEV database at their word, through the app's API (stays changed):** tenant "Karahi House" → **"Zaiqa Grill House"**; its owner's display name → "Ahmed Raza"; 9 expenses dated 30 Sep–6 Oct. Its logo is the True Serve app icon.

**Done to the page only, at capture:** appearance handle hidden; " #n" load-test serials stripped from text nodes.

**How to apply:** check any landing change at 1366×768 FIRST (the common laptop here), from the top of the page, before judging it scrolled into place. `ProductShots.test.tsx` only guarantees the files it names exist.

Related: [[shopos-the-front-door]], [[shopos-dark-shop-lit-counter]], [[shopos-ui-direction-oct06]]
