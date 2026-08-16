# Who sold it, as opposed to who rang it

**Decided and shipped 2026-08-16.** Found by reading the RETAIL trade during the
business-type audit; recorded in `docs/audit-2026-08-12/VERIFIED.md` as item 17.

## The problem

`ReportService::staffPerformance` groups completed sales by `created_by` and the
panel titled the result **"Staff performance"**.

Those are two different claims. The service's own docblock was accurate —
*"grouped by the staff who rang them up"* — and the screen over it was not.

In a one-person shop the till operator and the seller are the same person and
the report was right. On a showroom floor they are not: three or four salesmen
work the customers, one cashier rings everything at the counter, and the report
credited the cashier with the entire month while the men who did the work
appeared nowhere.

Same family as the forecourt's `unbilled_litres` (audit item 14) — a figure
computed perfectly and owed by nobody — but worse, because **a wrong name on a
performance report reads as a judgement about a person.**

## The decision

`sales.served_by` — nullable, `nullOnDelete`, indexed `['tenant_id','served_by']`.

The report now answers both questions and labels each one:

| Section | What it counts |
|---|---|
| Who sold it | `served_by`. Present only where the shop names sellers. |
| Who rang it up | `created_by`. Unchanged — it was never wrong, only mislabelled. |
| Unattributed | Rung while `served_by` was in use, with nobody named. |

## The invariant

**It is never inferred.** Nothing in a sale can tell you who walked the customer
round the shop, so an unattributed sale stays unattributed.

*Falling back to the cashier is the defect itself.* A test asserts the cashier
never appears as a seller for a sale nobody was named on.

For the same reason the POS box is **not pre-filled with the signed-in user**.
Pre-filling would put the cashier's name on a colleague's sale by default while
looking like the cashier had chosen it — the original lie, with consent implied.

## Off by default, and absent rather than disabled

`pos_ask_who_served`, shipping `false`.

Most shops on this platform are one counter and one person. A picker on every
sale, in a shop where the answer never varies, is a slower till bought with
nothing. Where it is off, the till renders no control and the report grows no
second table.

This is a shop-SHAPE question, not a trade one: an electronics showroom and a
tyre shop both want it, a kiryana and a bakery never will, and both pairs cross
trade boundaries. So it is a setting, not a `business_type` gate.

## Where the seller list comes from — worth not re-deriving

`GET /pos/sellers`, plus the identical list inside the catalog the offline till
already caches. **Not `/staff`.**

A cashier holds `sales.manage` and not `staff.manage`. Gating a NAME LIST behind
the permission that EDITS people is this codebase's documented `*.manage`
mistake — a write permission fencing a read (see
`docs/decisions/shopos-read-vs-manage.md`).

One private method (`PosCatalogController::sellerList`) feeds both surfaces, so
the online counter and the cached offline one can never come to disagree about
who works here. A test asserts the two lists are identical.

## Not built

**No commission or targets.** Attribution is the prerequisite and a decision the
owner has not asked for; a commission engine invented on top of a column shipped
the same day would be guessing at rates, splits and claw-backs nobody specified.

**No split credit between two salesmen.** One sale, one seller. Percentage
splits are how attribution turns into arithmetic nobody trusts.

Related: [[shopos-read-vs-manage]], [[shopos-retail-depth]], [[shopos-no-roles]].
