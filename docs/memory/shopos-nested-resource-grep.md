---
name: shopos-nested-resource-grep
description: STANDING — a NESTED resource has no route line of its own, so `grep <thing> routes/api.php` returns silence that reads like proof it was never built
metadata:
  type: feedback
---

Asked "what is the main thing still pending", I answered **"a size cannot be
edited, renamed, re-priced or deleted — no route"** and offered to build it.

All of it was already built, and had been for some time:

- `SyncProductVariantsAction` — edit, add, retire, at-least-one-sellable guard
- `UpdateProductRequest` — full `variants.*` rules
- `UpdateProductAction` — calls the sync inside the same transaction
- `ProductFormPage` — hydrates sizes on edit and posts them back
- `ProductVariantEditTest` — **8 tests, 27 assertions, green on the spot**

**Why: I read a silence as an answer.**

```bash
$ grep -n "variant" routes/api.php     # only the two sold-out lines
```

A size is edited **as part of its parent** — `PUT /products/{id}` carrying a
`variants` array. A nested resource has no route line naming it, so that grep
**could not have found it however complete the feature was**. Zero hits meant
"wrong instrument", not "not built".

**Then a second wrong source agreed with the first.** `HANDOVER.md` still said
"Not done, and it matters… that is the next thing to build" in a dated entry
written before the work. Two sources agreeing felt like corroboration; they were
one stale claim and one blind grep, and neither had looked at the code.

**How to apply:** before reporting anything as missing, open the path that would
USE it — the request rules, the action, the form's submit — not the route table.
`ls tests/ | grep -i <thing>` costs one command and would have ended this in
seconds: the test file was sitting there, named exactly what I said did not
exist. And treat a dated HANDOVER entry as *what was true that day*, never as
current state — same lesson as [[shopos-qa-sweep-aug09]].

See [[shopos-measurement-that-lied]], [[shopos-promise-in-another-file]],
[[shopos-failed-check-is-not-a-verdict]].
