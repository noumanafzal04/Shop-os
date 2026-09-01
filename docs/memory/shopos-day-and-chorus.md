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

**Then the doors.** F1 was found through the front door; a `Sale` row is made by
SIX paths. Same cash through each, reading the X-read: the counter, a quotation
turned into an invoice and an exchange with a top-up all moved the drawer by
**0**; a settled dine-in tab closed the whole day off at **0** (a restaurant
trades off its floor, so that is its entire day).

The fifth door CHANGED the fix. Resolving for every sale attaches a completing
ONLINE order — COD becomes a `cash` tender — to whichever drawer is open. Same
bug pointed the other way and worse: the drawer expects money that never crossed
it and the cashier counts SHORT. Fenced to counter channels. **A rule that only
ever adds is not a rule.**

**And then the fence was half a rule too.** Fencing to `channel != online` was
wrong in one direction: `channel` says where the ORDER came from, not where the
MONEY was taken. A reserved item collected in person and a pickup order paid at
the till are both `online` and both cross the counter —
`ReservationService::complete` is documented "customer arrived". A Rs 5,000
reservation collected in cash would still have left the drawer short. Fixed with
`collected_at_the_counter`, driven by `fulfillment_type`; the channel guess is
only the fallback.

**A shared rule can still leave half the job.** Giving `margins`/`topProducts`
the shared `Takings::COUNTED` stopped them dropping a whole ticket and left them
counting the RETURNED unit as sold — profit −74 on 9 units where the day earned
176 on 8. The P&L and a per-item margin table have opposite refund models ON
PURPOSE (gross + a dated refund line vs netted at line level, because one is
keyed by the day the money moved and the other by the day the goods were sold).
Different arithmetic, same answer.

**How to apply:** when adding a surface, ask what QUESTION it answers and who
else answers it. When you fix "X never happens", also ask where X must NEVER
happen — and put both signs in the test. When a payload field is optional, grep who actually fills it —
"offered by four, filled by one" is a whole bug class. Revenue stays GROSS with
refunds as a separately-dated line: a Thursday return cannot rewrite a Monday
that is closed and banked.

Related: [[shopos-pay-the-door-nobody-tested]], [[shopos-low-stock-one-rule]],
[[shopos-ceiling-follows-the-bill]], [[shopos-promise-in-another-file]].
Plan + remaining chunks: `docs/qa/TRADE-DAY-PLAN.md`.
