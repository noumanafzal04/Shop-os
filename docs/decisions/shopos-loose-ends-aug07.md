---
name: shopos-loose-ends-aug07
description: 2026-08-07 — all 4 small defects from the Aug-06 audit cleared; nothing known outstanding except deployment + training mode
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T12:33:23.169Z
---

The smaller loose ends from the 2026-08-06 audit are all fixed and pushed
(backend 1279 green, panel 109).

- **`layaway_cancellation_fee_percent`** was inert — in settings and in the
  panel's types, read by nothing. Now has a Shop Settings field and pre-fills
  the cancel dialog. **Suggestion, never application:** the server still
  defaults to full refund when no split is stated.
- **Three dead endpoints wired.** `/auth/sessions` → Signed-in devices in Shop
  Settings (current device never revocable). `/restaurant/reports/waiters` →
  *Sections* button on the dine-in floor (tips shown apart from sales, never
  added in). `/restaurant/tables/reorder` → move buttons in Edit floor mode,
  not drag; the whole id order is sent because index = position.
- **`auto_workshop`** was under both `services` and `automotive` with identical
  labels but silently different capability. Relabelled "Auto Workshop (labour
  only)", not removed — a fit-only mechanic is a real trade.
- **ShopSetupPage** called a Finance Manager tenant a "shop" four times; now
  reads `useCapabilities().sells`. City stays required — only framing was wrong.

**Why it matters:** these were all "exists but does nothing" defects, the kind
a green test suite never catches. The reusable check that found them: dump
`route:list --json` and regex every tenant route against the whole panel source
— but match template literals too, or you get false positives.

**Superseded on remaining work** by [[shopos-web-completion]] — a later sweep
found 4 more inert settings, and the web list is now waiter scoping + training
mode, with deployment/CI-CD still the only hard launch blocker. See also
[[shopos-audit-aug06]], [[shopos-relief-cover]], [[shopos-deployment]],
[[shopos-docs-discipline]].
