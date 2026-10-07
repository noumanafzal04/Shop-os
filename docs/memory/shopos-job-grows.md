---
name: shopos-job-grows
description: 2026-10-07 journey stage M (auto, 10/10): a job card could NOT take lines after booking (billed for its first line only); till's vehicle box unreachable; promised 5pm stored as 10pm; cars had no owner field
metadata:
  type: project
---

**Stage M** `panel/e2e/journey/24-auto-the-car-and-the-job.spec.ts` (JOURNEY_TRADE=automotive): tyre DOT age, car + owner, trade-in tender, bay board, job grows, billed at handover reading. 10/10. Findings 65–72 in `docs/qa/journey/RUNS.md`.

**Faults a workshop would have met (all fixed):**
- **A job card could not grow.** Board, book-in sheet and code comments all said "parts and labour go on as you work"; no endpoint, no screen. `ChangeJobCardAction` + `POST/PATCH/DELETE /sale-documents/{id}/items`; `DocumentPricing` extracted so booking and later lines share one pricer. Job cards ONLY (a quotation/layaway is a price already given). Affects services' Jobs board too. [[shopos-promise-in-another-file]]
- Job card page said "Quotation", showed nothing about the car → knows `job_card` now.
- **Till's vehicle box was inside a wrapper drawn only for loyalty/Rx** → unreachable at a workshop. [[shopos-half-a-rule]]
- "Promised back" (`datetime-local`) sent zone-less → stored as UTC (5pm → 10pm PKT). `common/time/localInput.ts instantOf()`. Any new `datetime-local` must go through it. [[shopos-today-in-utc]]
- Vehicle form had no owner field (`linkCustomer` had no caller); ownerless car now adopts the customer of its first job/sale (`CustomerVehicle::adoptOwner`, never overwrites — fleets).
- Handover odometer box only drawn if an arrival reading existed.

**How to apply:**
- Re-runnable: `e2e/trade.job-grows.spec.ts` (trade-automotive): one fixed car `E2E-JOB-1`, booked, grown, billed each run; heals by cancelling leftover open jobs.
- Plates are stored WITHOUT separators (`LEA-4291` → `LEA4291`); assert on the stored form.
- NOT changed: a part on a job stays on the shelf by count until billed (stock moves at billing). Owner's decision if they want reservation.

**Next:** petroleum, services (Jobs board = same job card), online, finance.

Related: [[shopos-auto-depth]], [[shopos-unit-sold-by-number]], [[shopos-the-journey]]
