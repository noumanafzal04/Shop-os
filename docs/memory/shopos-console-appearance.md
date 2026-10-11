---
name: shopos-console-appearance
description: BUILT + PUSHED 2026-10-10 — the admin console has Appearance (same canvas as a shop); platform-wide look in PlatformSettings; only super admin changes it; ThemeCustomizer split into AppearanceCanvas + sources
metadata:
  type: project
---

**User (2026-10-09):** "admin side ko primary rkho sidebar or color theme… or
khud b change kr sky" — reverses the 2026-10-07 "admin ko appearance ka option
nahi dia" ([[shopos-sidebar-default-primary]] — default still PRIMARY).

**Shipped** — backend `db0b0bb`, panel `0512221`, docs `a8f1a4f`. Decision:
`docs/decisions/shopos-the-console-has-an-appearance.md`.

- `GET /admin/appearance` (any platform role), `PUT` (`role:super_admin`).
  `PlatformSettings`: `console_theme_primary` (null = house), `_tint`, `_sidebar`.
  Reset = `PlatformSettings::forget()` (row removed; column is json NOT NULL).
- Theme keys are NOT in `PlatformSettings::rules()` (commission screen's);
  own `appearanceRules()`.
- Panel: `AppearanceCanvas` (takes `AppearanceSource`) in
  `components/theme/ThemeCustomizer.tsx`; shop wrapper `ThemeCustomizer`;
  `admin/components/ConsoleAppearance.tsx`; `useConsoleTheme()` in `AdminShell`.
- `rememberedTheme.ts`: `PLATFORM_LOOK = "platform"`; single remembered slot
  shared with shops (a device used for both waits for a request after switching).
- It is the PLATFORM's look (one, for everybody) — my reading of "khud change
  kr sky"; not per-person. Light/dark stays per device.

**Bit me:** two guards (`e2e/savesSayWhenTheyFail.guard.ts`,
`common/ui/mutationFeedback.test.ts`) read TEXT: `mutate(x, on)` hides the
`onError` from both. Spell `{ onSuccess: on.onSuccess, onError: on.onError }`
at the call, and keep `.mutate(` out of a `.tsx` that cannot itself say the
outcome (put it in the hook `.ts`).

Related: [[shopos-dashboard-rail-theme-oct06]], [[shopos-queue-oct09]]
