---
name: shopos-offline-slip-numbers
description: "FIXED — an offline slip number could deadlock a till for ever; device segment is now server-ALLOCATED, counter is high-water seeded, and a repeated label never costs a sale"
metadata:
  type: project
---

**2026-08-20.** The offline slip is `OFF-<lane>-<device>-<counter>`. The device
segment lived in localStorage and the counter in IndexedDB — **two layers that
do not fail together** — and the segment was just the first 4 chars of the
browser's own random UUID, unchecked against any other till.

Two ways to deadlock:
1. **Evict IndexedDB, keep localStorage** → counter restarts at 1 under the same
   segment → every slip after that is one the shop already has.
2. **4 chars = 65,536 values.** Fifty tills ≈ 1-in-50 chance two share a segment
   and print identical numbers for different customers.

Either way the server's `sales_tenant_offline_number_unique` refused the insert,
it was caught as "unexpected, retry later", and the till offered the same number
every few minutes **for ever** behind *"It is still safe on the till."* It was
safe and it could not leave.

**Fixed, all three, and the slip's SHAPE never changed** (4 chars in, 4 out):
- **A label may never cost a sale.** `op` is already the idempotency key and is
  checked first — if that is new, the sale is new. Filed as `…-D2` with a
  violation telling the shop two customers may hold the same printed number. The
  printed number stays the STEM so `Sale::search`'s LIKE still finds it.
- **`sales.offline_seq`** — the sequence as a NUMBER beside the label, because
  the label now has a `-D2` form a SQL string-parse would misread. Catalog pull
  answers `offline_sequence` per device; `nextSequence()` takes
  `max(local, server) + 1`.
- **`pos_devices.code`** — 4 chars, unique per tenant, allocated once at
  registration, never changed under a till that has already printed it.
  Alphabet omits `O 0 I 1 S 5` (people read it down a phone for refunds);
  random not sequential (a sequential code reveals how many tills a shop runs).
  A till that never reached the server still slices its own id.

**How to apply:** an identifier that must be unique across devices must be
ALLOCATED by the thing that can see all of them, never hashed locally and hoped
over. And a uniqueness constraint on a LABEL must never be allowed to refuse the
money the label is attached to.

**A test that lied:** `test_a_tills_code_never_changes_under_it` passed with the
allocation deleted — `assertSame(null, null)` is true. **Two nulls agreeing is
not a test.**

Related: [[shopos-offline-in-a-browser]], [[shopos-slip-number-lookup]],
[[shopos-fuel-rate-and-receipt-tray]], [[shopos-detector-vs-rule]]
