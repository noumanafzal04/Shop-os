---
name: shopos-screens-nobody-opened
description: chrome.spec walked 14 of 48 shop screens — 32 had NEVER been opened by a browser; walking 20 more found a modal-blind rule and 8 unnamed controls incl. two money boxes
metadata:
  type: project
---

Measured 2026-08-24: `chrome.spec.ts` walked **14 of the shop's 48 screens**.
The other 32 had never been opened by a browser at all — not a lower standard,
**none**. Every layout and a11y rule the suite enforces had run zero times
against two thirds of the product.

**Why it matters:** that is how the kitchen board spent six days showing dockets
for cancelled tabs ([[shopos-docket-outlived-tab]]). The screens nobody looks at
are the ones nothing is measured against.

**How to apply:**
- The walk now holds 34 screens (every one the MART fixture reaches).
  `src/test/routes.ts::TENANT_ROUTES` is the authoritative list to diff against
  — App.tsx's own `path="/tenant…"` grep returns 7 because nested routes drop
  the prefix. See [[shopos-measurement-that-lied]].
- **A modal is supposed to cover the page.** `/tenant/products/new` IS a dialog
  (`aria-modal="true"`, a drawer over the catalogue). The covered-control rule
  now judges only what is INSIDE an open modal — but still judges that, proved
  by planting a cover over the dialog's own Close button.
- 8 controls announced as "edit text, blank": activity's 2 filters + 2 dates,
  the orders filter, the documents filter, and **NewSalePage's Discount and
  Amount paid** — two money boxes labelled by a `<span>`, not a `<label>`. Same
  shape as [[shopos-label-not-attached]]; that pass fixed what it could see, and
  these screens were in nothing's field of view.
- Standing figure: **0 of 758 controls across 34 screens** (was 0 of 346 / 14).

**Still uncovered:** the trade-gated screens — forecourt, dispensary, workshop,
bay board, vehicles, warranty, riders, portfolio, reservations. Each needs a
fixture shop of that trade, the same fix as the `restaurant` project.
`/tenant/setup` is excluded on purpose: a walk must not change what it walks.

Doc: `docs/decisions/shopos-thirty-two-screens-nobody-opened.md`.
