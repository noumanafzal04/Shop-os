---
name: shopos-failed-is-not-empty
description: STANDING — a list has THREE non-answers (refused 403 / FAILED / empty) and screens drew the last for all; till said "No products match." over a 429. loadFailure() + <CouldNotLoad> beside deniedReason() + <NoAccess>
metadata:
  type: feedback
---

**What happened (2026-10-10):** the till's product request was answered 429
(the API's own limit) and the till said "No products match." over a full
shelf. A 403 has had its own words (`deniedReason` + `<NoAccess>`) since the
cashier who thought the shop had no products; any OTHER failure — 429, 5xx, no
answer — fell through to the screen's empty state. And `queryClient` never
retries a 4xx and does not refetch on focus, so it stayed that way until
somebody typed in the search box.

**Fix:** `common/api/denied.ts` → `loadFailure(error)` (null for no error and
for a 403; else the server's own message, or "The server did not answer.");
`common/ui/CouldNotLoad.tsx` (what, why, Try again → `query.refetch()`). On
the till in BOTH views (tiles and rows each had their own empty state), only
while `connected`. `e2e/till-list-failed.spec.ts`.

**How to apply:** any screen rendering a list from a query asks, in order:
`deniedReason(error)` → `<NoAccess>`; `loadFailure(error)` → `<CouldNotLoad>`;
only then its own "nothing here".

**Sweep, part 1 DONE + PUSHED 2026-10-10 (panel `66c0b74`):** all 24 TABLE
lists go through `<TableEmpty from={query} what="the … list">`, which now
draws all three (only when `query.data === undefined`). A NEW LIST MUST PASS
`from` + `what` — `components/ui/table/emptyIsNotFailed.test.ts` fails
otherwise, and fails if `from` is not the query in the `x.isLoading ?` above
it. `MoneyEntryTable` takes `asked` + `what`. `e2e/list-failed.spec.ts` (14
shop lists, reads only, `--no-deps`). Also: failure box clamped inside the
card on a phone; FilterBar says "Counting…" only while loading.

**Part 2 DONE + PUSHED 2026-10-10 (panel `9cde147`):** 62 non-table lists wrapped in `<ListEmpty from what>` (`common/ui/ListEmpty.tsx`). Guard also fails for any `) : rows.length === 0 ? (` under an `x.isLoading ?` / `x.isPending ?` that does not open with `<ListEmpty>`/`<TableEmpty>` or is told another query; exemptions named in the test with a reason. Billing page draws NO cards when its summary request fails (`noFigures`). `e2e/admin-list-failed.spec.ts`. Kitchen's "Nothing waiting ✓" was the sharpest case. Done by SCRIPT (anchored on the condition line, bottom-up per file) then tsc — 0 type errors on 54 sites, because every `from` had to be a query result to compile.

My interpretation: this is the same class as [[shopos-read-vs-manage]] /
[[shopos-half-a-rule]] — a rule applied to one of three cases.
