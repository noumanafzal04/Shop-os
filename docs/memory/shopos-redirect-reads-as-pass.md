---
name: shopos-redirect-reads-as-pass
description: STANDING — RequireFeature redirects to the dashboard, so a walk of a gated screen measures the dashboard and passes
metadata:
  type: feedback
---

`RequireFeature` / `RequirePermission` in `panel/src/common/routing/guards.tsx`
do NOT render a refusal in place — they `<Navigate to="/tenant" replace />`.

So a browser test that opens a screen the signed-in shop's module does not
cover lands on the **dashboard** and then measures the dashboard. Every rule
passes. Found 2026-10-02: `/tenant/documents` and `/tenant/bank-offers` had
been in `chrome.spec.ts` at four device sizes each, green for months, about
the dashboard. `bank_offers` is false in EVERY trade's defaults, so that screen
had never been opened by a browser at all.

**Why the existing denominator missed it:** the size check beside it
(`renderedSize > 60 elements`) was written for a redirect to an *empty* page —
the till once ran fourteen times against one. A dashboard is not empty.

**How to apply:** any spec that navigates to a path must assert
`new URL(page.url()).pathname === path` BEFORE anything else. Done in
`chrome.spec.ts`, `trade.chrome.spec.ts` and `four-doors.spec.ts`. When adding
a screen to a walk, first check the fixture shop actually HAS the module —
`Modules::defaultsFor(<trade>)`. Features are platform-assigned and cannot be
switched on from the tenant API, the same wall `offline_selling` hits in
`shelf.setup.ts`.

Related: [[shopos-four-doors]], [[shopos-guards-share-a-blind-spot]],
[[shopos-detector-vs-rule]], [[shopos-screens-nobody-opened]]
