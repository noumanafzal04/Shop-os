# Work taken in is a job — not a quotation, and not a car

**2026-10-08 · found by the services journey, stage O**

## The faults

The Jobs board was the workshop's board with the nouns changed. Stage M made
a job grow; stage O took eight shirts in at a laundry counter and found the
rest of the job was still a quotation or a car underneath.

| What a laundry met | Why |
|---|---|
| **No way to take an advance from the job.** The server took one (`RecordDepositAction` allows a job card) and the Help said so; the page offered "Take instalment" to a layaway only, and drew "Advance paid" and the balance for a layaway only — an advance taken on a job was nowhere on it | the page asked the KIND, not whether money was held |
| **The slip printed as a quotation**: "Valid until", the shop's quotation terms, nothing the customer asked for, a "Total" as if final | `show.blade.php` knew two kinds |
| **A cashier could hand back a job's advance.** Cancelling returns the advance; only a layaway asked for refund permission | the guard read `isLayaway()` |
| The cancel sheet said "the goods go back on the shelf" and offered the layaway's cancellation fee | one sheet, one kind |
| The sheet asked what is "wrong" with eight shirts, said "parts and labour go on", searched "a part or a labour item"; refusals said "this layaway" | car and layaway words in shared code |
| **Eight shirts could only be taken in as one**, then pressed up with "+" seven times, a server trip each; 3.5 litres of oil could not be said at all | quantity 1 hard-coded; − and + only |
| A full board had no way to find one customer's work | a workshop reads its board by plate; a laundry has eighty slips |

## Now

- **Money on a job is drawn when it is there.** `takesAdvance = layaway || job`
  (the button: "Take an advance"); `holdsMoney = layaway || (job && deposit_paid > 0)`
  (Advance paid, Balance due, Payments received). The collect sheet treats a
  job settled by its advance as paid in full.
- **The slip is a Job Card.** The car and its reading for a workshop; "Customer
  said" / "Instructions"; promised back; "Total so far" while open; the advance
  and the balance; "this is the job so far, not the final bill". A job card
  is written with no quotation terms (`CreateSaleDocumentAction`).
- **Refund authority is asked of the money, not the kind**
  (`SaleDocumentController::cancel`): any document holding an advance needs
  `sales.refund` to cancel. A quotation never holds one.
- **The board's own words** (`workshop/words.ts`): `asks`, `said`, `goesOn`,
  `findItem`, `addLine`, `opensWith`, `confirm`, `find` — vocabulary, never
  behaviour. The cancel sheet knows a job (no shelf, no layaway fee).
- **Quantity is typed.** "How many" on the take-in sheet; a box on every open
  job line (Enter or leaving it commits; − and + stay). The server still judges
  it — half a part sold by the piece is refused — and a refusal puts the real
  figure back in the box.
- **Find on the board** (`workshop/find.ts`): slip number, name, phone, plate;
  case, spaces and dashes ignored.

## Not changed

- An advance can never be more than the job comes to so far — the part goes on
  first, then the money for it is taken. Kept: a job can never be billed below
  what was paid, and this is the same rule from the other side.
- A part on a job still leaves the shelf when the job is billed, not when it
  goes on (stage M's open decision for the owner).
- Staff commission (`/tenant/hrm/commission`) is an honest "not built yet"
  screen; a salon's per-stylist pay is not here.

## Tests

Backend `AJobGrowsAsTheWorkIsDoneTest` +10 (slip ×5, advance ceiling, billed
job, refund authority ×3); mutations 3/3 + slip 15/15. Panel `words.test.ts`
(+2), `find.test.ts` (5); mutations 3/3 + 3/3. Journey stage O 9/9.
Re-runnable `e2e/trade.work-taken-in.spec.ts` (trade-services); the auto
`trade.job-grows.spec.ts` now types a quantity and has half a part refused.
