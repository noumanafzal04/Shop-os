---
name: shopos-ui-conventions
description: "Admin/tenant panel UI standards the user wants — toasts for feedback, modals for add/create/edit forms, one shared confirm-delete modal component, clean & user-friendly"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-25T00:48:17.436Z
---

Standing UI conventions for the admin & tenant React panels (stated 2026-07-23, apply to ALL new admin UI going forward).

- **Toaster messages** for action feedback (success/error) — not inline banners for transient results.
- **Modals for forms**: add / create / edit happen in a modal dialog, not a separate full page (unless a page already exists for it).
- **One shared confirm-delete component**: a common reusable delete-confirmation modal used everywhere something is deleted — don't hand-roll a new confirm dialog per feature.
- **Clean, neat, user-friendly** design overall.
- **Field validation inline, action results as toast** (stated 2026-07-24): validation errors show under the input; success/general failure is a toast.
- **Charts**: use a proper chart library (user suggested Recharts / Ant-Design-style components) for dashboards instead of hand-rolled visuals.
- **Notifications & deep links**: ONE landing/redirect page that routes a notification tap to the right screen — don't build per-notification pages.
- **"UI neatness with perfection"** (stated 2026-07-25): polish is a requirement, not a nice-to-have — spacing, alignment, states all deliberate.
- **Modal backdrop = light & instant** (stated 2026-07-25): user flagged the TailAdmin default (`bg-gray-400/50 backdrop-blur-[32px]`) as too heavy/slow. Now `bg-gray-900/30 dark:bg-black/50`, NO heavy blur. Never re-add big backdrop-blur values.

**Why:** consistency across the panel + less bespoke UI per feature; the user explicitly asked for these as defaults.
**How to apply:** when building any admin/tenant CRUD screen (plans editor, extend-limits, business types, branches, etc.), reach for the existing TailAdmin Modal + a shared ConfirmDialog + the toast system rather than inventing per-screen patterns. Relates to [[shopos-plans-and-flow]] (next up: plans editor + extend-limits UI) and [[shopos-mobile-design]] (flat green+ink theme, no shadows).
