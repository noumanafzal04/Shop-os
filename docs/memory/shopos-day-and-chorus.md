---
name: shopos-day-and-chorus
description: STANDING method — run a whole shop day, then ask every screen the same question and measure against the test's OWN books; found 2 bugs on its first run
metadata:
  type: feedback
---

**Run a DAY, then ask every screen the same question.** Not a deeper test of a
module — a whole day (buy → sell on three tenders → refund → khata → pay the
supplier → pay a bill → count the drawer → close the day), followed by a chorus:
the questions a shopkeeper asks at ten at night, put to every surface that can
answer them.

Two rules make it work:

- **The expectation is the test's own.** A chorus alone catches disagreement,
  not a shared mistake — four screens reading one broken query agree perfectly.
  So the day keeps its own books as it goes and the screens are measured against
  that.
- **Collect failures, don't throw.** *Which* screens disagree is the finding.

**Why:** the supplier Pay bug was a COVERED branch with an unasserted
consequence — see [[shopos-outcome-not-coverage]]. Coverage does not find this
class; running the day and asking does.

**Found on the first run** (`tests/Feature/ADayInTheShopTest.php`, mart):

1. **A field offered by four doors and filled by one.** `cash_session_id` — the
   till sends it; Sales → New Sale, the returns desk (no field at all) and
   dine-in settle / quote→invoice do not. So a day traded from any other screen
   closed off reading **0** and the drawer expected **100** instead of **850**.
   Money LEAVING the drawer had resolved itself server-side all along
   (`RecordCashMovementAction`); money arriving did not. Fixed:
   `BooksDrawer::tillFor()`, fenced off the practice till (a real sale must
   never inherit `is_training`) and off the sync path (a replayed sale names its
   own shift).
2. **A refunded item took the whole ticket off the sales report.** 13 queries
   asked "which sales count?" and answered `Completed` only, so 2,250 read as
   **1,250** — neither gross nor net. Fixed: `App\Support\Takings`.

**How to apply:** when adding a surface, ask what QUESTION it answers and who
else answers it. When a payload field is optional, grep who actually fills it —
"offered by four, filled by one" is a whole bug class. Revenue stays GROSS with
refunds as a separately-dated line: a Thursday return cannot rewrite a Monday
that is closed and banked.

Related: [[shopos-pay-the-door-nobody-tested]], [[shopos-low-stock-one-rule]],
[[shopos-ceiling-follows-the-bill]], [[shopos-promise-in-another-file]].
Plan + remaining chunks: `docs/qa/TRADE-DAY-PLAN.md`.
