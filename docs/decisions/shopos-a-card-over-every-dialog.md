# The install card sat on every dialog in the shop

**2026-08-24 · panel**

## What it cost

On a tablet or a phone, the PWA install card — *"Put CartZe on this iPad"* —
was drawn at `z-[999998]`. Every dialog in the app sits far below that:

| layer | what |
|---|---|
| `99999` | the shared `Modal`, the header, the sidebar, the till |
| `100000` | toasts, the product form, **`TillLock`** |
| `999998` / `999999` | **the install card, the update card** |

The cards are `fixed inset-x-3 bottom-3` — the bottom strip. In a dialog, that
strip is where **Save and Cancel** live.

So a shopkeeper on an iPad opened *Add item*, filled the form in, and could
press neither button. Not a rare corner: the card shows until it is dismissed,
which is exactly the first days of a new shop.

## The fix already existed, one layer up

`AppLayout` sets `--pinned-bottom` from whatever is fixed to the bottom and pads
the page content by it — and the comment beside it describes this **same bug**
happening before, to the "Shop street address" field.

A dialog renders outside that container. **The rule was applied to the page and
not to the dialogs**, which is the shape this codebase keeps meeting: one rule,
several paths, and the copy that drifts is the one nobody wrote.

`UpdatePrompt`'s own docblock claimed the property it did not have:

> nothing here can swallow a tap meant for the cart

## Below the modal layer, not padded around

Both cards moved to `z-[99998]` — above all page content, below every dialog.

A modal's backdrop then covers the card while a dialog is open, which is the
right answer on its own terms: **an install suggestion is ambient, and a dialog
is a task somebody is in.** Padding the dialog instead would have kept a banner
floating over a form for no reason.

## The rule that kept shouting after the fix

`chrome.spec` has a second rule — *"the page still runs under a pinned card"* —
and it went on reporting the footer after the z-index was corrected. It tested
only whether the two boxes share space, never who was in front.

Overlap is not the same as hidden. It now asks `elementFromPoint` at the centre
of the overlap, the same question the covered-control rule asks, and a card the
user's own content is drawn over is no longer a card in the way.

## A wrong cause, written down confidently

The first fix attempted was `min-h-0` on the form's scroll pane, with a comment
explaining that the pane "grew past the dialog and pushed the footer off". Then
the boxes were measured:

```
dialog 1080   form 974   pane 897 (scrollHeight 897)   footer 1003 → 1080
```

The pane fitted. The footer was inside the viewport. **The diagnosis was
invented and the comment stated it as fact.** The class was kept — the guard is
right and free — and the comment now says what it actually does and what it did
not do.

A comment claiming the wrong cause is worse than no comment: the next person
reads it and stops looking.
