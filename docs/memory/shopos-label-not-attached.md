---
name: shopos-label-not-attached
description: the panel rendered <Label> 327 times and htmlFor 5 times — fields were labelled and UNATTACHED; fixed at runtime by walking up to the label, and it gives up rather than guesses
metadata:
  type: project
---

Not "the fields have no labels". `<Label>` is rendered **327** times, `htmlFor`
passed **5**. A shopkeeper sees "Credit limit" above a box; a reader hears "edit
text, blank", with the answer two centimetres above it and outside the
accessibility tree.

`src/common/a11y/useFieldName.ts` joins them at runtime — the control walks up to
the label already sitting over it — wired into `InputField`, `Select` and
`TextArea`. Same argument the shared Modal settled for dialog names: take it from
what the component already renders, because every call site already renders one.
No 465-file sed. `aria-labelledby`, not `htmlFor`, so nothing about click
behaviour moves.

**Why it gives up:** two controls under one label, a label already spoken for, a
label below the field, a label wrapping its own input — every ambiguity ends with
NO name. A field announced as "Opening float" that holds the closing count is not
better than an unnamed one; it lies to the one person who cannot check it.

**How to apply:** the 27 label-less search boxes promote their placeholder to a
real `aria-label` (an attribute doesn't clear when you type, which was the actual
objection to placeholders) — stamped `data-name-from-placeholder` and counted
SEPARATELY by the browser rule. Never fold a second-best category into the pass
column; the total would read zero while 27 fields answer to something nobody
chose as a name.

Measured every run by `everythingHasAName` in `e2e/rules.ts`: **0 of 367**.

Related: [[shopos-estimate-at-wrong-layer]], [[shopos-screen-testing]].
