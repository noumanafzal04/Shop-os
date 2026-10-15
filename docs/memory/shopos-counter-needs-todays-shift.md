---
name: shopos-counter-needs-todays-shift
description: STANDING (user 2026-10-15): with pos_require_shift on, EVERY counter sale and every CASH advance needs the taker's own shift opened TODAY — one rule, BooksDrawer::mustBeOpenToday; screens say so before the press
metadata:
  type: project
---

"Require open shift" means TODAY's shift, at every door that takes money at the counter: till, tab settle, New Sale (walk_in/pos), exchange, quotation/layaway billed, and a cash advance (layaway / job card, opening or instalment). Server: `BooksDrawer::mustBeOpenToday($sessionId, $tenant, $doing)` → 409 SHIFT_REQUIRED / SHIFT_FROM_AN_EARLIER_DAY. Not refused: phone/online orders, offline replays (trusted), card/bank/wallet advances, shops with the setting off.

**Why:** the user found the till selling with the setting on — Zari's shifts were open since 13 Oct and took the 14th's and 15th's sales into the 13th's drawer and day; four other screens never read the setting.

**How to apply:** a new way of taking counter money calls `mustBeOpenToday` (server) and `useCounterShift` / `useCashNeedsShift` + `ShiftNeeded` (panel). A walk that closes a shift must COUNT it to what is expected — my script closed a drawer at 0 (that is how L5 was found). See [[shopos-what-the-screen-adds-up]], [[shopos-shop-day]].
