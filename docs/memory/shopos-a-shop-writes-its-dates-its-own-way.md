---
name: shopos-a-shop-writes-its-dates-its-own-way
description: BUILT 2026-10-12, NOT pushed — one date format per shop (4 codes, default "12 Oct 2026" unpadded), one DateField (typed + calendar) behind the shared Input for type="date" only; STANDING never format a date the browser's way; where it lives and what is still the browser's
metadata:
  type: project
---

**USER, 2026-10-12 (testing by hand):** "date picker b to hona chaye? or sth khud
b type kr sky" → "date ka format setting main hona chahye for international?" →
"currency and date format business tab man any chahye… shop setting k pehle tab
main" → "check kr lena uski type date arhi hai shared main? baki input ko khrab
na krdy". BUILT. Decision doc: `docs/decisions/shopos-a-shop-writes-its-dates-its-own-way.md`.
**Not committed, not pushed** ([[shopos-resume-here]]). Sister of
[[shopos-a-shop-trades-in-its-own-money]].

**How it works (so the next change does not undo it):**
- The list is `backend/app/Support/DateFormats.php`: `dmy_text` (default,
  "12 Oct 2026" / "5 Oct 2026" — the day is NEVER padded in words), `dmy`
  12/10/2026, `mdy` 10/12/2026, `ymd` 2026-10-12. Only the CODE is stored
  (`tenants.settings.date_format`). Not locked — it changes how a day is
  written, not what day it is. Clock stays 12-hour.
- Papers: `ShopTime::show()` swaps the date part of a paper's format for the
  shop's (`DateFormats::localise`); `ShopTime::day()` for a calendar day (expiry,
  due date) — never zone-moved. See [[shopos-paper-reads-shops-clock]].
- Panel: `src/common/format/date.ts` is the ONE place a date is written
  (`shopDate`, `shopShortDate`, `shopDateTime`, `timeOf`, `spokenDate`,
  `isoDay`, `typedDayIn`…). Format is module-level, set by
  `layout/WrittenTheShopsWay` round the outlet in BOTH layouts, remembered in
  storage key `shopos-dates`. Pages are NOT drawn until the format is known
  (`useDateFormatIsKnown`, 2 s give-up) — a remount on arrival threw away a
  sheet the owner had just opened.
- Field: `components/form/DateField.tsx`; shared `Input` hands over ONLY
  `type="date"` (held by `InputField.test.tsx`). Value stays ISO, so no caller
  changed and `.fill("2026-08-12")` still works in specs.
- Panel = server by fixture `tests/fixtures/date-format.json` (regenerate:
  `SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=DateFormatFixturesTest`,
  then `cp` to `panel/src/common/format/fixtures/`).
- Settings: Currency + Dates cards are on the **Business** tab (first), saved by
  that tab's "Save profile" (it saves profile AND preferences now).

**STANDING: never format a date the browser's way** — no `toLocaleDateString`,
`toLocaleTimeString`, `new Date(x).toLocaleString`, `Intl.DateTimeFormat`, raw
`<input type="date">`. Guards: `panel/src/common/format/noOwnDateFormat.test.ts`
and `AShopWritesItsDatesItsOwnWayTest` (no Blade view formats a date itself).
**Why:** 77 places asked the browser, and the 12th of October read "10/12/2026"
on the owner's laptop. **How to apply:** a new row that shows a date uses
`shopDate`; a new paper uses `ShopTime::show`/`day`.

**A spec must not ask the browser either.** Two specs named a calendar cell with
`toLocaleDateString(undefined, …)` — the same call as the fault, so they agreed
with it by construction ([[shopos-detector-vs-rule]]). They write "12 October
2026" themselves now.

**Still the browser's (told to the user, not asked for yet):** 3
`datetime-local` boxes (job "Promised back", fuel delivery "When", landing
enquiry) and 7 `time` boxes. Customer marketplace + admin console write the
default format (not inside one shop's settings).
