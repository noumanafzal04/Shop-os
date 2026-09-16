# `theme/` — one decision outstanding

Phase 0 brings `mobile/src/theme/` across whole: tokens, the two brand
scales, `ThemeProvider`, `useColors`.

**Which palette Partner wears is not decided** — see
`docs/DECISIONS.md` #4. It is deliberately not blocking: every screen reads
`useColors()`, nothing hard-codes a hex, and `screenConsistency.test.ts`
in the customer app exists to keep it that way. Changing the answer later
is one line in the provider.
