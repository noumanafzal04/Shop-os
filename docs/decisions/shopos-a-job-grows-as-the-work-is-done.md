# A job grows as the work is done

**2026-10-07 · found by the workshop's journey, stage M**

## The fault

A job card is work taken in: a car on the ramp, eight shirts at a laundry.
Nobody knows the price when it arrives, parts and labour go on over hours, and
it becomes an invoice when the customer collects. The board said so ("the
parts and labour go on as you work"), the book-in sheet said so twice, and the
code said a job "accumulates lines over hours or days".

**Nothing did it.** There was no endpoint and no screen that could add a line
to a job card after it was written. A car booked in for a Rs 1,500 diagnostic
hour, given brake pads and two hours' labour, could be billed for Rs 1,500.
The rest went on a separate till sale with no car and no job behind it, or
was not charged. The same for the Jobs board every services shop uses.

## Now

`ChangeJobCardAction` — three doors, all for an OPEN JOB CARD only:

| | |
|---|---|
| `POST /sale-documents/{id}/items` | a part or labour goes on; the same item again joins its line |
| `PATCH …/items/{item}` | a different quantity, priced again at that quantity |
| `DELETE …/items/{item}` | a line comes off — not the last one (cancel the job instead) |

- Priced by `DocumentPricing` — extracted from `CreateSaleDocumentAction`, so
  the booking and the later lines are priced by one piece of code. The screen
  cannot name a price.
- The job's totals are worked out again each time; what is billed is the job
  card exactly as it stands (`ConvertSaleDocumentAction` was already right).
- A members' discount is taken of what the job comes to NOW; rupees knocked
  off by hand stay the same rupees.
- A job cannot shrink below an advance already paid on it.
- A quotation and a layaway do **not** grow: one is a price handed over on
  paper, the other is goods somebody has paid towards.
- Stock still moves when the job is BILLED, as before. A part on the ramp is
  on the shelf by count until then — unchanged, and worth knowing.

## And around it, from the same day

- **The job card's own page** opened as "Quotation", under "← Quotations &
  advances", with nothing about the car. It says Job card, links back to the
  board, and shows the car, what the customer said, the reading it came in on,
  when it was promised and where it is.
- **Five o'clock was ten at night.** The "Promised back" box sent a time with
  no zone; the server read it as UTC. `instantOf()` sends the moment.
- **The till had no way to put a sale on a car.** The vehicle box was written
  inside a wrapper that drew only for a loyalty member or a prescription — at
  a workshop, never. It is drawn whenever there is a bill.
- **A car could not be given an owner** from any screen: the list had the
  column, the server had the endpoint, the form had no field. The form has
  one. And an ownerless car takes the customer of the first job or sale that
  names one (`CustomerVehicle::adoptOwner`) — never replacing an owner already
  on record, because a fleet car's driver is not its owner.
- **A car booked in with no reading** could not be given one when it left:
  the handover box was drawn only if an arrival reading existed.

## Tests

Backend `AJobGrowsAsTheWorkIsDoneTest` (26). Panel `localInput.test.ts`.
Browser: journey stage M (10) and `e2e/trade.job-grows.spec.ts` (3,
re-runnable). Mutations in RUNS.md.
