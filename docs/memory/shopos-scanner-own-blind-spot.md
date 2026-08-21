---
name: shopos-scanner-own-blind-spot
description: FIXED — unreachable-pages.py never judged modules/workshop (it fetches via another folder's service), hiding a real page-one bay board; also the combo/recipe picker offered 15 of the catalogue
metadata:
  type: project
---

`docs/qa/unreachable-pages.py` judges a panel folder by the API calls in **its
own source** — deliberately, so `components/ui` isn't credited with every list
that imports a Button from it. `src/modules/workshop/` contains no API call at
all: the bay board fetches `documentService.list(...)` from `modules/documents`.
So it produced no endpoints, hit `continue`, and **had never been judged**.

Behind that blind spot: `page: 1`, pagination discarded, 25 newest-first, bucketed
client-side into three columns. A workshop with 26 open jobs lost the OLDEST car —
the one the board itself colours amber as overdue — and if the 25 newest were all
`received`, the Ready column said "Nothing here." while finished cars waited to be
collected. The board exists to answer "is my car ready?" and answered "nothing
is."

Ten minutes later, same reasoning: the combo and recipe pickers are a plain
`<select>` fed by `useProducts({ page: 1 })` against an endpoint that pages at
**fifteen**. A restaurant writing a burger recipe could pick from 15 possible
ingredients. Invisible to the page-two scanner too — a `<select>` full of
`<option>`s is not a table with a missing pager.

**Why:** third time a detector has been blind to its own subject. A board is not a
list you browse, so the fix is to DRAIN the pages (the kitchen board and dine-in
floor are unpaginated by design), and the scanner learned a third verdict,
`drains all`.

**How to apply:** the residual is written into the script's docstring, not fixed —
the escape hatch is credited to a FOLDER, not a LIST, so a folder with a search
box over list A passes for list B. Workshop's first-ever verdict was "search
only" on a product lookup in the book-in modal. Don't trust a per-folder verdict
about a specific list.

Related: [[shopos-detector-vs-rule]], [[shopos-page-two]],
[[shopos-reachability-rule]], [[shopos-estimate-at-wrong-layer]].
