---
name: shopos-who-owes-the-platform
description: BUILT + PUSHED 2026-10-10 — admin Commission screen: paginated list, BOTH piles as money (unbilled + billed-unpaid), 4 server-counted tiles, filter kit in the URL, invoice for a chosen period with a preview
metadata:
  type: project
---

**User asked (2026-10-09):** "Commission screen UI b… filters ko b dekha kro".

**Shipped** — backend `f8ebc16`, panel `5dbff03`, docs `ac705ed`. Decision:
`docs/decisions/shopos-who-owes-the-platform.md`.

- `GET /admin/commission` paginated (25): `search`, `standing`
  (unbilled|invoiced|clear), `rate` (own|platform), `sort`. Rows:
  `outstanding_amount`, `unpaid_amount`, `owed`. `meta.summary` = the tiles.
  3 queries at any size (was 2 per shop, no pages).
- Real defect under the look: unpaid INVOICES were a count, not money, so the
  shop owing most could sort last.
- Shop panel: invoice period is chosen (shared DateRangeFilter) and
  `invoice-would-bill` says orders + amount BEFORE raising.
- "Filters everywhere": surveyed — every other admin list already uses the kit.

**Things that bit (mine):**
- `check-circle.svg` has a hard-coded green fill → blank square on a green
  `StatTile` chip. Use `CheckLineIcon` (stroke currentColor) in filled chips.
- A status clause that is implied by another (`status='paid'` beside
  `paid_at >= …`) is an untestable condition — the mutation run found it; removed.
- A browser spec that writes (raise invoice) needs the mutation runner to UNDO
  what a stopped run left (`tidy()` voids unpaid invoices on Sweep/QA shops),
  and to treat a SKIPPED test as "proves nothing", not as caught/survived.
- Query-count tests: call once first — PlatformSettings is read from the DB the
  first time and from cache after (9 vs 8).

Related: [[shopos-one-filter-bar]], [[shopos-page-two]], [[shopos-queue-oct09]]
