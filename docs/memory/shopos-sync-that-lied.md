---
name: shopos-sync-that-lied
description: FIXED — "Sync now" said "Up to date" beside a badge reading 4; a press was subject to the 10-min backoff, and success was read off the catalog PULL not the queue
metadata:
  type: project
---

Live-shop report: *"i sell 4 items and click sync, showing up to date and again
showing 4, but not sync."* Two compounding faults:

1. **The backoff applied to a human press.** `markRetry` caps at **10 minutes**
   and `dueRows` filters on `nextAttemptAt`. After a few failures a press found
   nothing DUE, sent nothing, returned instantly — and reported success.
   `dueRows(now, tenant, force)` now ignores the wait when a person asked, **on
   the first round only** (a row that fails inside this flush still earns its
   wait). Force skips the WAIT, never the **tenant fence** — test asserts it.

2. **The button reported the PULL, not the QUEUE.** `pullNow` swallows flush
   failures on purpose (a till must not stop learning its catalog because its
   queue won't go) and `useManualSync` read the resolved promise as success — so
   the catalog coming *down* was reported as sales having gone *up*. The
   `FlushResult` is returned now, the queue is asked afterwards, and the label
   is `Up to date` / `4 still to send` / `3 refused`.

**Why it matters:** the screen drew "Up to date" beside a badge reading 4. Both
from the same component, one false — and **the false one was the reassuring
one**.

Also added `OfflineReadyPanel` (Settings → POS → Lanes & PINs): what THIS device
holds — products, customers, and **codes separately**, because a till with a
full catalog and an empty barcode index can be searched and cannot be scanned.

See [[shopos-till-had-no-offline-shell]], [[shopos-sync-progress-pill]].
