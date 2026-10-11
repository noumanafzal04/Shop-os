---
name: shopos-console-a-to-z
description: 2026-10-10 admin A–Z walk — every console screen one h1 via kit PageHeader (held by admin-console.spec); deleted shops out of the tenant list; "not priced yet" not "paid"; shop page gets 4 tiles + sticky jump-menu (NOT tabs)
metadata:
  type: project
---

**User (2026-10-09):** test every admin page through the UI, fix in code, make
it attractive for a CEO presentation; "tenant edit screen b dekh lena".

**Found:** all 15 screens loaded clean — the fault was inconsistency (8 with no
h1, three header styles) and three real defects under it:
1. the tenant list mixed in every DELETED shop (panel sent `with_deleted` always)
   → "All 71" beside a dashboard saying 44. Now `?only_deleted=1` behind a
   Deleted box.
2. a shop on NO plan was labelled "paid" (server bucket = "not behind") →
   `admin/paymentChip.ts` says "not priced yet". Bucket counts unchanged.
3. a shop's page was 4 screens with no top → `shopAtAGlance.ts` (4 tiles) +
   sticky "On this page" nav scrolling to section ids.

**Decisions to keep:**
- Shop page is NOT tabs: `journey/11` and three specs read Modules/Usage on the
  one page, and a journey cannot be re-run to prove a change. Anchors instead.
- New console screen → kit `PageHeader` + add `{path,name,title}` to
  `SCREENS` in `e2e/admin-console.spec.ts` (asserts exactly one h1 = title).
- Shared `StaffPage` gets its header via a render prop, not by importing the
  console kit into the shop side.

**Bit me (specs):**
- A checkbox whose `checked` comes from the URL: `.check()` fails ("did not
  change its state") — `.click()` then `toBeChecked()`.
- Measuring where a smooth scroll LANDS: poll until two reads agree; mid-scroll
  the section is still on its way.
- `getByText("52 tenants")` matched the filter bar AND the pager — `exact: true`.
- "in N days" by `Math.ceil(hours/24)` calls 6pm today "tomorrow"; diff the
  calendar days.

Related: [[shopos-queue-oct09]], [[shopos-admin-keeps-a-demo]], [[shopos-ui-conventions]]

**PUSHED 2026-10-10:** backend `2d603af`, panel `f0c8fcb`, docs `03ea7d7`. Backend 3,479 exit 0; vitest 193 files / 2,250; build 0; admin e2e 30/30 twice; mutations 23/23. No migration. The flaky admin-customers failure was the rate limit — [[shopos-one-admin-240-a-minute]].
