---
name: shopos-button-submit-default
description: FIXED — the shared <Button> had no type, so inside a form it SUBMITTED; "+ Add variant" created the product with zero variants and the variant editor had never worked once
metadata:
  type: project
---

`src/components/ui/button/Button.tsx` passed `type={type}` with **no default**.
The HTML default for a button inside a form is `submit`. Three buttons in
`ProductFormPage` sat inside `<form onSubmit>` without one:

| button | what pressing it actually did |
|---|---|
| **+ Add variant** | queued the row, then submitted → product created with **zero variants**, drawer closed. Reopening = edit mode, where the section was hidden |
| **+ Group** | same, for modifier groups |
| **Save modifiers** | fired its own mutation AND created the product |

**So the variant editor had never worked, once.** Every variant in the system
came in through the API — including the e2e fixture, which POSTs to `/products`
directly, which is why no test saw it.

**Why the default was backwards:** of **305 `<Button>` usages, exactly ONE** asked
for `type="submit"`. Every other one relied on not being inside a form. So
`Button` now defaults to `"button"` and the nine real submits say so.

**The rule that sorted them, and it is clean:** a `<Button>` with its own
`onClick` is never the form's submit; a bare one inside a form always is. 22 bare
buttons across 10 files, and that rule classified every one.

**How to apply:** a shared control whose default silently submits its surrounding
form is a trap that fires once per form somebody writes. Prefer the inert default
and make the loud thing explicit. And when a whole section of a form has no test,
ask whether anything has ever *used* it — the fixture going round the UI is the
tell.

Related: [[shopos-size-picker-gap]], [[shopos-reachability-rule]],
[[shopos-screen-testing]] (only a browser has an opinion about submit).
