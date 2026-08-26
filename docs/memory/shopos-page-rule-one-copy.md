---
name: shopos-page-rule-one-copy
description: STANDING — the pager broke because a filter-reset also swallowed the page; two copies of one rule, the newer missing the older's fix
metadata:
  type: feedback
---

The admin tenant list's Next/Previous did nothing. `<Pager onPage>` was routed
into the same `patch()` the filters used, which ends with `next.delete("page")`
— correct for a filter (page 4 of a different filter usually does not exist),
fatal for the pager: it set the page and dropped it in the same call. Nothing
threw; the URL was rewritten to what it already was and the list redrew
identically.

The marketplace's `patch`, written weeks earlier, had the missing line:
`if (!("page" in next)) merged.delete("page")`.

**Why:** two implementations of one rule, and the NEWER one lacking the fix the
older one already carried. That is the recurring shape here — same as
[[shopos-promise-in-another-file]] and the sales list/export filter chain.

**How to apply:**
- URL filter state → `nextParams` / `useUrlFilters`
  (`src/common/hooks/useUrlFilters.ts`). Never write the page rule again.
- `src/components/ui/pager/reach.test.ts` has an axis that fails if a screen
  using `useSearchParams` + `<Pager>` clears `"page"` itself. It found a third
  copy (MarketShopPage) on its first run.
- Page one is spelled as the ABSENCE of the parameter.
- Also watch the mount case: a debounced-search effect that unconditionally
  clears `page` sends a `?page=3` deep link to page one. Compare against the
  URL and return early when nothing changed.
- Verify pagination in a BROWSER. Next/Prev/deep-link/filter-resets-page — four
  checks, and jsdom sees none of them.

Related: [[shopos-one-filter-bar]], [[shopos-page-two]], [[shopos-screen-testing]].
