---
name: shopos-slip-number-lookup
description: offline sales printed an OFF- slip that NO search matched — customer holding it could not be found, so could not be refunded; Help Centre had promised it worked
metadata:
  type: project
---

**Fixed 2026-08-18.** An offline till prints `OFF-LANE1-A3F2-000042` because it
must not mint an invoice number it could collide on. The server keeps BOTH
numbers on sync — `receiptNumber.ts` says why: *"the slip in the customer's bag
is the only reference they have."*

**All three lookups searched `invoice_number`, `customer_name`, `customer_phone`
and never `offline_number`**: sales ledger, its CSV export, and the ⌘K palette
(`GlobalSearchService::sales`). A return is `POST /sales/{id}/returns` and the id
comes from that search — so **a customer who bought during an outage could not be
found, refunded, returned or reprinted.** For as long as offline selling existed.

**The worst part:** the Help Centre already told shopkeepers *"BOTH are
searchable, so a customer holding the slip can always be found."* Written when
the design was decided, never true.

> **Documented as working is the most expensive way for a feature not to exist.**
> Nobody goes looking, because the docs say it works. Worse than
> [[shopos-reachability-rule]]'s "built but unreachable".

Fix = `Sale::scopeMatchingSearch()` — ONE clause, shared by all three, because
the export's job is to be the same rows as the screen and two copies of a rule do
not stay one rule (same day, same lesson as [[shopos-sync-progress-pill]]).

**Found ≠ recognised:** the slip travels back to the row (ledger row, sale
detail, palette subtitle via `saleSubtitle()`, CSV column) so whoever typed it can
confirm it is their sale before a refund.

`isOfflineNumber` stays exempt on purpose — every surface reads the FIELD, none
judges a string. Don't invent a caller to empty a list.

Full reasoning: `docs/decisions/shopos-slip-number-lookup.md`.
