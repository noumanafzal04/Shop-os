# A shop writes its dates its own way — and types them

**2026-10-12.** The owner's words, testing by hand: *"date picker humne use ni
kia kahin — date picker b to hona chaye? or sth khud b type kr sky"*, then
*"date ka format setting main hona chahye for international?"*, then *"currency
and date format business tab man any chahye… shop setting k pehle tab main"*,
and *"check kr lena uski type date arhi hai shared main? baki input ko khrab
na krdy."* Built and tested; **not pushed** until they say.

## What was there

- **Every date box was the browser's** (`<input type="date">`, 34 of them through
  the shared `Input`). It looked different on every machine, wrote the date in
  the *laptop's* order, and on the owner's laptop the twelfth of October was
  `10/12/2026`.
- **Seventy-seven places asked the browser how to write a date**
  (`toLocaleDateString()` and relations). The same sale read "10/12/2026" on
  one till and "12/10/2026" on the next.
- There was **no setting**. Papers printed `d M Y` — fixed, and padded
  ("05 Oct 2026").

## The decision

**One format per shop, chosen from a list of four, and one date field.**

| Code | Reads | Default |
|---|---|---|
| `dmy_text` | 12 Oct 2026 · 5 Oct 2026 | yes — cannot be misread in any country |
| `dmy` | 12/10/2026 | |
| `mdy` | 10/12/2026 | |
| `ymd` | 2026-10-12 | |

- **`App\Support\DateFormats`** is the one list. The **code** is stored
  (`tenants.settings.date_format`); a pattern is never saved.
- **The day is not padded in words** ("5 Oct 2026", "From 1 Aug"). Padded read
  badly in sentences and broke twenty existing tests that were right. Papers
  changed with it: a receipt now prints "6 Oct 2026 · 12:47 PM".
- **Unlike the currency, it is not locked.** A date format changes how a day is
  *written*, never what day it *is* — nothing on the books moves.
- **The clock is not part of it.** Times stay 12-hour (`h:i A`) everywhere.

## Where it is chosen

Settings → **Business** (the first tab), left column, under the shop's
profile: the **Currency** card and the **Dates** card. Both moved there from
Tax — "which money and which calendar" is about the business, not about tax.
That tab's bar saves both the profile and the preferences (`Save profile`).

## How a date gets written

**Server** — papers follow the shop:
- `ShopTime::show($moment, $format, $tenant)` swaps the date part of a paper's
  format (`d M Y`, `j M Y`, `d M`, `j M`) for the shop's (`DateFormats::localise`).
- `ShopTime::day($date, $tenant)` writes a **calendar day** (an expiry, a due
  date) and never moves it across a time zone.
- Guard: `AShopWritesItsDatesItsOwnWayTest` fails a Blade view that formats a
  date itself.

**Panel** — `src/common/format/date.ts` is the one place a date is written:
`shopDate`, `shopShortDate`, `shopDateTime`, `shopShortDateTime`, `timeOf`,
`monthName`, `monthYear`, `weekdayOf`, `spokenDate`, `isoDay`, `typedDayIn`.
- The shop's format is a module-level value, set during render by
  `layout/WrittenTheShopsWay` (wrapped round the page outlet in both layouts)
  and remembered on the device in `shopos-dates`, so a reload writes dates
  right before the settings have answered.
- **A page is not drawn until the format is known** (`useDateFormatIsKnown`:
  the settings answered, or failed, or are paused offline, or the device
  remembers; gives up after two seconds). The first version redrew the page
  when the settings arrived and threw away a sheet the owner had just opened.
- Panel and server are held to one answer by a **server-made fixture**
  (`backend/tests/fixtures/date-format.json` → `panel/src/common/format/fixtures/`).
  Regenerate: `SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=DateFormatFixturesTest`, then copy.
- Guard: `noOwnDateFormat.test.ts` fails on `toLocaleDateString`,
  `toLocaleTimeString`, `new Date(x).toLocaleString`, `Intl.DateTimeFormat`
  and a raw `<input type="date">`.

## The date field

`components/form/DateField.tsx`. The shared `Input` hands over **only**
`type="date"`; every other input is untouched (`InputField.test.tsx`, 24
cases, is what holds that).

- **Typed or picked.** The box takes the shop's order, and also what cannot be
  misread whatever the order: `2026-08-12`, `12 Aug`, `Aug 12 2026`, `today`,
  `tomorrow`, `yesterday`. A two-digit year is this century; no year is this year.
- **The value stays ISO** (`2026-08-12`) — callers and the server see exactly
  what the browser's box gave them. No caller changed.
- A date that is not a date (31 Feb), or outside `min`/`max`, is **refused in
  words** when the box is left, and the box goes back to what it held.
- The calendar opens in a portal (it is not clipped by a sheet), names each
  day in words for a screen reader, takes the arrow keys, and Escape closes
  the calendar without closing the sheet under it.

## What is still the browser's

- **3 `datetime-local` boxes** (job "Promised back", fuel delivery "When",
  the landing enquiry form) and **7 `time` boxes**. They work; they are not yet
  the shop's own field. A date-and-time field is the next step if wanted.
- The marketplace (customer side) writes dates in the default format — a
  customer is not inside one shop's settings.

## What the tests missed, and why

Two browser specs found a calendar cell by asking **the browser** to name the
day (`toLocaleDateString(undefined, …)`) — the same call the app made, so the
check agreed with the fault by construction. They now write the name
themselves ("12 October 2026"). A third padded the printed day itself and
would have failed on the 1st–9th of any month.

## Tested

- Backend: `DateFormatFixturesTest` (4), `AShopWritesItsDatesItsOwnWayTest` (8);
  whole suite 3,704 tests, 3,682 passed, 22 skipped.
- Panel: `date.test.ts`, `InputField.test.tsx` (24), `noOwnDateFormat.test.ts`;
  whole suite 245 files, 2,979 passed; `npm run build` 0.
- Browser: `e2e/date-format.spec.ts` (4 × desktop, phone) — the owner picks a
  format and the list, the sheet and the typed box follow; a typed date, a
  picked date, a date that is not one, a date past the limit.
