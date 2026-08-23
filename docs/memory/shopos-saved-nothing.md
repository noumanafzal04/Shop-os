---
name: shopos-saved-nothing
description: FIXED — the product form's "Saved with warning" banner was shown by a refusal that saved NOTHING; a whole shop's prices were uneditable and every attempt said it worked
metadata:
  type: project
---

`ProductFormPage.submit()` refused an online item with no description by calling
`setWarnings([...])` and `return`ing — **no request at all** — and the banner that
renders `warnings` is titled, hard-coded, **"Saved with warning"**.

So the message contradicted its own title: *saved*, and in the same breath *add a
description before saving*. A shopkeeper corrects a price, reads that it saved,
closes the drawer, and the edit is gone.

**Blast radius, measured:** the demo shop it was reported on had 4 products, all
4 visible online, all 4 with no description — **not one price in the shop could
be corrected**, and every attempt reported success.

Two fixes, because there were two faults:

1. A refusal is its own state now, rendered `variant="error"` titled **"Not
   saved"**, ending "Nothing has been saved yet."
2. **On EDIT it is no longer a refusal.** The item is already online without a
   description; blocking the save does not take it off the marketplace, it only
   stops the shop fixing anything else. Create still blocks — there the red
   asterisk promises a refusal, and the asterisk now appears only where that is
   true.

The rule itself is legitimate: the server **declares** it (`online_required`) and
does not enforce it on write, so the panel is honouring a server rule rather than
inventing one — worth keeping straight, they look identical from inside the form.

Held by `e2e/online-description.spec.ts`, which states its precondition out loud
so it cannot pass vacuously on a shop with no marketplace module.

**The shape:** one banner, two meanings, and only one of them true. See
[[shopos-promise-in-another-file]], [[shopos-detector-vs-rule]].
