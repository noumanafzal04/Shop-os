---
name: shopos-who-changed-what
description: "FIXED 2026-08-21: the audit trail recorded who may DO things and not what those things are WORTH — a credit limit raised 5k→90k left no row; and the shop could not read its own history (super_admin only). Auditable::auditOnly() + GET /audit-logs + READS_AUDIT"
metadata:
  node_type: memory
  type: project
---

**2026-08-21.** Eight sensitive acts driven through the API as a shop owner,
each **proven to have changed something first**. Three left a record.

| act | recorded? |
|---|---|
| discount ceiling · staff permission · suspension | **yes** |
| credit limit Rs 5,000 → 90,000 | no |
| tax rate (re-rates every product on it) | no |
| customer group discount (every member at once) | no |
| coupon (money off every bill quoting it) | no |
| product price | no |

> **A trail that records permissions and not the money those permissions move
> is a trail about the door, not the room.**

`TaxGroup`'s own docblock says *"edit the rate once and every product on it
re-rates"* — and the difference is owed to FBR, with nobody's name on it.

**And nobody in the shop could read it.** Only `/admin/audit-logs`, behind
`role:super_admin`. An owner got 8 dashboard rows, no filter, no dates — while
the Help Centre said the log records who entered a figure. *A record that
nobody named in it can read is not accountability; it is a promise about a
filing cabinet in somebody else's office.* **8th "built but unreachable"**, and
the first where the unreachable thing was the shop's own history.

## The fix

- **`Auditable::auditOnly()`** — an allowlist, so a model can be audited in ONE
  respect. A METHOD not a property (PHP refuses a trait property redeclared
  with a different default). Update touching none of them → nothing. CREATE
  counts if one arrives with a value (**a limit given on day one is the same
  act as raising it on day two**). DELETE always.
- `Customer` → `credit_limit` only. `TaxGroup`, `CustomerGroup`, `Coupon` →
  whole. **All four low-volume — that is the selection rule, not a coincidence.**
- **`GET /audit-logs`** tenant-scoped (explicit `where`: AuditLog is NOT
  tenant-scoped as a model, the platform reads across shops) + Activity screen
  in **shop words** ("Tax rate", not `TaxGroup`).
- `READS_AUDIT = settings.manage OR reports.view` — ANY-of, per
  [[shopos-read-vs-manage]]: **the person most often being ASKED about is the
  one holding settings.manage.**

**NOT audited on purpose:** product prices (a 5,000-row import buries the trail
in an afternoon — "who repriced this" needs a price HISTORY, not a bigger list),
supplier/branch contact details (not authorities; already have
created_by/updated_by). Both stated in the Help Centre.

**Regression caught pre-ship:** moving the exclude filter earlier meant a
`password`-only update wrote NOTHING, where it used to write a row with empty
values. **That row is the signal.** Only the allowlist may swallow a
values-less change.

## The probe was wrong twice, each time confidently

1. Read `tenant_id` off `/auth/me` — it is nested under `tenant`. Filter became
   the literal string `None` → **0 rows**, i.e. "nothing is recorded" while
   looking at the wrong shop.
2. Keyed the trail on `(entity, event, entity_id)` — a SECOND "User updated"
   for the same user is the same tuple, so it deduped away and the probe said a
   permission change left no record **having just watched one appear.**

> **Suspect the detector before the code.** Third time this week.

## Phase T + a harness fix

Phase T "who changed what", **always two shops** (one `where` in one controller
is the entire wall). 4 mutations (40–43).

**`Report.expect` reads a collection `want` as ALTERNATIVES** — phase S hit it
one day, phase T the next, so the API was the problem. Empty `want` is now
flagged as a caller bug; both-sides-collections compares for EQUALITY.

Related: [[shopos-read-vs-manage]], [[shopos-security-pass]],
[[shopos-other-half-of-a-date]], [[shopos-ceiling-follows-the-bill]],
[[shopos-sold-out-and-reachability]], [[shopos-detector-vs-rule]]

**2026-08-24 follow-up — two gaps in what shipped:**
- Activity could filter to a KIND (`type=Product`) but not to one RECORD, so an
  item's older price changes meant paging every product change in the shop. The
  server took `?record=` from day one and nothing passed it. Fixed: Activity
  reads it from the URL, says so with a removable chip, and `PriceHistory` links
  in. The summary panel's page-one cap is registered in
  `unreachable-pages.py` under `A_SUMMARY_WITH_THE_REST_ELSEWHERE` — the rule
  for that dict is: name the screen showing the rest, and go USE it first.
- The trail **never named WHICH one**. Rows read `Product · Changed · price 180
  → 210`. `subjectName()` existed; the panel's `AuditLog` interface did not
  declare `subject`. A writer with no reader, in the same commit as the thing
  that needed it. See [[shopos-measurement-that-lied]] for the stale
  `vite preview` (`reuseExistingServer: true`) that made the first e2e run lie
  about this.
