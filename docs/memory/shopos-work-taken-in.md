---
name: shopos-work-taken-in
description: 2026-10-08 stage O services (laundry) 9/9; job had no advance button + slip printed as Quotation + cashier could refund a job's advance + 8 shirts only as 1 + no find on board
metadata:
  type: project
---

**Stage O** `panel/e2e/journey/26-services-the-work-taken-in.spec.ts`
(JOURNEY_TRADE=services): services carded, walk-in at the till, 8 shirts taken
in on the Jobs board, found by phone, advance, grows, slip, board, billed with
advance as a `deposit` tender, a job cancelled with its advance split. 9/9.
Re-runnable: `e2e/trade.work-taken-in.spec.ts` (trade-services, clears its own
customer's open jobs; sets the e2e shop's layaway fee to 10% so "no layaway fee
on a job" can fail).

**Faults (findings 82–89), all found by READING the screens as a laundry before
the stage ran — it then passed first time:**
- A job could not take an advance from its page; an advance was drawn nowhere
  on a job (page asked the KIND; now `takesAdvance` / `holdsMoney`).
- Slip printed as a Quotation (valid until, quotation terms) → Job Card.
- Cancel refund-permission guard read `isLayaway()` → a cashier could pay out a
  job's advance. Now asked of `deposit_paid > 0`. ([[shopos-half-a-rule]])
- Car/layaway words on the services board, cancel sheet and deposit refusals →
  `workshop/words.ts` grew 8 words (vocabulary only).
- Quantity hard-coded 1 at take-in, only −/+ on lines → "How many" + typed
  `LineQuantity` (refusal puts the real figure back).
- No find on the board → `workshop/find.ts` (number/name/phone/plate, dashes ignored).

**Kept on purpose:** an advance can't exceed the job so far (part goes on
first). Commission screen is an honest "not built yet".

**How to apply:** a "find" that leaves the card visible proves nothing — assert
the REST of the board stood aside (count) AND that there was more than one to
begin with: "count is 1" on a board of one survived the mutation (15/15 after
another customer's job was kept on the board). A dead guard line showed up as an
equivalent mutant in `find.ts` and was deleted rather than tested.

Related: [[shopos-job-grows]], [[shopos-the-journey]], [[shopos-import-engine-v2]]
