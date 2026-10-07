---
name: shopos-sidebar-default-primary
description: USER DECISION 2026-10-07 — sidebar default is PRIMARY (shop, demo, admin console); Appearance order Primary · White · Tinted · Dark; one constant + server default
metadata:
  type: feedback
---

**The user's words (2026-10-07):** "Default sidebar and theme color primary rakhna hai. Admin side par sidebar color primary — admin ko humne appearance ka option nahi dia. Demo create ho to sidebar primary. Appearance canvas mein default sidebar primary, start mein; second mein white, aur baki."

**What it is now:**
- `DEFAULT_SIDEBAR = "primary"` and `SIDEBAR_CHOICES` (Primary, White, Tinted, Dark) in `panel/src/common/theme/tenantTheme.ts`; `'theme_sidebar' => 'primary'` in `ShopSettings::defaults()`.
- The platform console has NO Appearance and never calls applyTenantTheme — it is drawn entirely from `AppSidebar`'s own fallback. That fallback is the admin's sidebar.
- A demo stores no theme; it follows the default (test in `DemoShopTest`).

**How to apply:**
- Never write `"light"` as a sidebar fallback again: `defaultSidebar.test.ts` reads the four panel files and the server file and fails.
- A shop that saved Appearance once has `light` STORED (the canvas saves colour, tint and sidebar together) — it stays white until it presses Primary. My reading: do not migrate stored values without the user asking.
- 4 choices in the canvas's 3-col grid orphaned the last; `Choice` uses `grid-cols-4` at 4+ (both class names written out — never interpolate a Tailwind class).

Decision: `docs/decisions/shopos-the-menu-is-in-the-brand-colour.md`. Related: [[shopos-dashboard-rail-theme-oct06]], [[shopos-ui-direction-oct06]]
