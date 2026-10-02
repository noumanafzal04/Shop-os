---
name: shopos-four-doors
description: the CRUD sweep (panel/e2e/four-doors.spec.ts); a static URL scanner cannot answer this and was deleted
metadata:
  type: project
---

2026-10-02. "Can a shopkeeper see / add / change / remove one?" per managing
screen. `panel/e2e/four-doors.spec.ts`, its own `doors` Playwright project
(runs ONCE — this is not a screen-size question).

**A static scanner cannot answer it.** One was written and deleted: a hook
writes `apiPut(\`${basePath}/${id}\`)` where `basePath` is a *function
parameter* (`useStaffModule` serves both the shop and the admin console). No
text matcher resolves that, so every well-factored module was invisible and
"two findings" was measured against nothing.

**Vocabulary, not verbs.** Stocktake says "+ Start a count", categories say
"Rename", disposals say "Write off stock" — all correct for their subject. The
regex must be as wide as the product's own language. The guard against widening
it to meaninglessness: every word must be a verb that MAKES something. "Export",
"print", "filter", "settle" are controls on these screens and none belong.

**UNJUDGED is counted, not printed.** Edit/Remove live on a row, so an empty
list cannot be asked. That is asserted at the end with a ratchet of **0** —
`shelf.setup.ts` creates a collection rather than the allowance being raised.

A path the spec invents is a finding about the spec (`/tenant/registers` does
not exist — `RegistersPanel` lives inside Shop Settings).

Related: [[shopos-redirect-reads-as-pass]], [[shopos-rider-holds-cash]],
[[shopos-loss-with-no-price]], [[shopos-outcome-not-coverage]]
