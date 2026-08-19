---
name: shopos-fuel-rate-and-receipt-tray
description: "FIXED — tomorrow's fuel rate repriced the pumps tonight; a reprinted receipt never left the tray (second-precision timestamp tie)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-19T06:36:55.752Z
---

**Two bugs found by QA sweep phase Q (2026-08-19), both fixed.**

**1 · Tomorrow's rate priced tonight's petrol.** `ChangeFuelPriceAction` wrote
`$product->update(['price' => ...])` unconditionally, ignoring `effective_at` —
whose own docblock says notifications take effect at midnight and are logged
before they apply. A station entering the rate at 8pm sold the whole night at
it. Fixed: new `applied_at` column; a future rate is recorded and left alone;
`fuel:apply-rates` (scheduled every 5 min beside `reservations:expire`) applies
due rates. **Idempotent** — otherwise a hand-corrected price is reinstated every
five minutes for ever.

**2 · A reprinted receipt never left the tray.** The tray query compared
`printed_at`, a **second-precision** timestamp: a reprint inside the same second
(till retry, fallback printer) TIES rather than exceeds, so `>` never matched.
Fixed by keying on `copy_no` — the sequence itself, monotonic per sale.

**Why:** the receipt test was **written around the bug**. It carried
`$this->travel(1)->seconds()` before the retry — one line that was the whole
difference between a passing test and a working feature. Nothing arranges a
spare second at a counter.

**How to apply:**
- When ordering events, use the SEQUENCE column (`copy_no`), never a timestamp
  whose precision you did not choose.
- Before believing a green test, look for a contrivance in its setup — a
  `travel()`, a sleep, a hand-picked id — that the real world does not supply.
- Harness lessons: `api.py`'s `raw` is a 400-char PREVIEW, not the body (use
  `text`); the CSV export carries a **BOM** on purpose (Excel), so strip it
  before `DictReader`; a mutation that only WATCHES is not a mutation; and a
  mutation aimed at a phase whose prerequisites were not run comes back UNCLEAR,
  which is the denominator working.

Related: [[shopos-which-day-is-open]], [[shopos-detector-vs-rule]], [[shopos-qa-sweep]], [[shopos-unit11-status]]
