---
name: shopos-dashboard-rail-theme-oct06
description: 2026-10-06 night: dashboard says ONE status line + 4 action tiles + filled sales card; rail in 3 sections, solid active row, "black line" = scroller on a dark/primary rail; theme remembered per device (shopos-theme); NO shop card in the rail
metadata:
  type: project
---

Asked for with a reference product's screenshots ([[shopos-ui-direction-oct06]]). All pushed (panel `04e9b82`, `fceb850`).

**Dashboard** — `modules/dashboard/components/shop/status.ts`: the hero says the most pressing TRUE thing (pass → unaccepted orders → unclosed day → kitchen → floor → out of stock → low stock → "everything is moving", which needs ≥1 sale). `QuickActions show="top|rest"`: four ranked tiles under the hero; with no prop it renders ALL (that is what `offeredIsReachable` renders). `MetricTile featured`: today's sales filled, week as bars. Hero shows the tenant's `logo_url` when set. `formatDelta`: ≥ +1000% reads "43×".

**Rail** — `NavItem.section` (Daily work / Manage / Your shop); `navSections.test.ts` holds each part in one piece for every trade × view. Active row = solid `--rail-primary`. The user's "right side black vertical line" was the nav scroller's `gray-700` thumb (and the submenu's `gray-800` guide) on a rail carrying `dark` — the PRIMARY rail does. Fixed with `.rail-scroll` / `.rail-guide` in index.css. Opened group scrolls into view.

**User correction, same day:** I added a shop card (logo + name) to the rail; the user said "no need tenant shop logo on side bar, make this within dashboard banner". Removed from the rail; the logo lives in the dashboard hero. Don't put shop identity in the rail again.

**Theme flash** — `common/theme/rememberedTheme.ts`: `bootTheme()` in main.tsx before render applies dark mode + the remembered colours, ONLY for the signed-in shop's own tenant id and roles shop_owner/staff. `useTenantTheme` leaves the page alone until settings arrive. New key `shopos-theme` must be listed in `brandName.test.ts` ADDRESSES (that guard caught it).

Related: [[shopos-work-screen-rail]], [[shopos-dashboards-redesign-pending]]
