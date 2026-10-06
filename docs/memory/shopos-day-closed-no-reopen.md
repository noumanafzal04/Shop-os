---
name: shopos-day-closed-no-reopen
description: OPEN decision — a business day closed off cannot be reopened and takes no more shifts that date; with require-shift on, no sales until tomorrow
metadata:
  type: project
---

`CloseBusinessDayAction::open()` refuses a shift on a trading date already closed (409 `BUSINESS_DAY_CLOSED`, "Trading on <date> has already been closed off"). There is no reopen route. With `pos_require_shift` on, the till cannot sell again until the next local date.

**Why it came up:** 2026-10-06 the journey run from stage 01 in one sitting — stage 08 closes the day, stage 12 then could not open a shift. The product was right; the "Close off the day" sheet only said the figures freeze.

**Done:** the close sheet now says "No shift can be opened again today…" (`data-testid="close-day-consequence"`, DayPage) and Help says close off when the shop is SHUT.

**Open for the user:** an owner-only "reopen today" (only while nothing is banked against the day; logged to the activity trail). Do not build without asking — frozen day figures are a deliberate rule ([[shopos-which-day-is-open]]).

**How to apply:** journey stage 12's two close-shift cases `test.skip` when `record().dayClosedOn === today`; a same-day full run is 103/105 by design.
