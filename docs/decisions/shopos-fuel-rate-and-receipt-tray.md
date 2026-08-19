# Two things a forecourt loses money on quietly

**2026-08-19** · backend `ChangeFuelPriceAction`, `ReceiptController` · sweep `docs/qa/sweep/phase_q.py`

Phase Q drove three things nothing had ever touched — the reprint tray, the
tanker and the rate notification. Two of them were broken.

---

## 1 · Tomorrow's rate priced tonight's petrol

A price notification is the government changing what fuel costs, and it takes
effect at **midnight**. Every station enters it when the fax comes, which is
hours before it applies — the request that carries the field says exactly this
where `effective_at` is declared:

> *Notifications usually take effect at midnight, so the rate may be logged
> before it applies.*

`ChangeFuelPriceAction` ignored it:

```php
'effective_at' => $data['effective_at'] ?? now(),
…
$product->update(['price' => $newPrice]);   // unconditional
```

So a station that entered tomorrow's rate at 8pm repriced its pumps at 8pm.
**Every litre sold that night went out at the wrong rate** — on the one night of
the month when a forecourt is busiest — and nothing anywhere errored. If the
rate went up, customers were overcharged; if down, the station ate it.

### The fix

Recording a rate and applying it are two different events, so they get two
timestamps: `effective_at` is when the government says it starts, `applied_at`
is when this system moved the price. A future rate is recorded and left alone.

`fuel:apply-rates` moves prices that have fallen due, scheduled every five
minutes beside `reservations:expire`. At worst the forecourt keeps last night's
rate for five minutes after midnight — a great deal better than charging
tomorrow's for four hours before it.

Three tests, two of them red on revert: tomorrow's rate does not move the pumps
tonight (and a litre sold tonight is still tonight's price); the rate does reach
the pumps once due; and the command is **idempotent**, so a rate somebody has
since corrected by hand is not silently reinstated every five minutes for ever.

---

## 2 · A reprinted receipt never left the tray

The reprint tray is *"every failed print with no later successful one for the
same sale"* — the only thing standing between a receipt that never came out and
an argument at the counter. It compared clock time:

```php
->whereColumn('later.printed_at', '>', 'receipt_prints.printed_at')
```

`printed_at` is a **second-precision** timestamp. A reprint that follows a
failure inside the same second — a till retrying, a fallback to the second
printer — **ties** rather than exceeds it, so the receipt stayed in the tray
after it had come out. For ever.

A tray that never empties buries the one receipt that really is missing under
fifty that were sorted out hours ago, which is the same as having no tray.

### The fix

`copy_no` — the sequence itself, monotonic per sale, assigned by `nextCopyNo`,
with no precision to lose. The subquery is already scoped to one sale, which is
exactly where copy numbers count.

### The test that was written around the bug

`test_a_later_good_print_clears_the_tray_by_itself` had this line before the
retry:

```php
$this->travel(1)->seconds();
```

That one line was the difference between a passing test and a working feature.
**Nothing arranges a spare second at a counter.** It is gone, and the test now
fails against the old query.

---

## What the sweep got wrong first

Four findings, and two of them were the harness:

- **The catalog export "contained none of the shop's products".** The file opens
  with a **BOM**, deliberately — without it Excel reads Pakistani product names
  as mojibake. `csv.DictReader` keys the first column `"﻿Name"`, so every
  lookup for `Name` missed.
- **`api.py` truncated the body to 400 characters.** That field is a preview,
  for putting in a finding without printing a megabyte; a check that read it as
  the response saw a header row and reported an empty catalog. It now keeps
  both.
- **The print trail is `orderBy('copy_no')` ASCENDING**, so row zero is the
  ORIGINAL. Reading it as "the latest print" meant the check marked the original
  failed, reprinted, and then looked at the original again to see whether the
  reprint had worked.

## Related

- `shopos-which-day-is-open.md` — the same week's find, same shape.
- `shopos-detector-vs-rule.md` — a guard blind to its own subject. The
  `travel(1)->seconds()` is the purest example this repo has.
