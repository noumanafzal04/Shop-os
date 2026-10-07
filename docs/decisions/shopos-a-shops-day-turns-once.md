# A shop's day turns once — at five in the morning, or the hour it chooses

**2026-10-07 · decided on the owner's word: "khud se perfect banao jo best solution"**

## The question

"Shop ka din kab khatam ho? Reports abhi subah 5 baje (UTC midnight) par din
kaat-ti hain."

## What was wrong

"Today" was worked out in two ways that disagreed for five hours of every
night, and nobody had chosen either:

| Where | Its day | Because |
|---|---|---|
| Dashboard, every report, cashbook, ledger | 05:00 → 05:00 (Karachi) | a UTC day, which is what a database does when nobody says otherwise |
| The till's trading day | midnight → midnight | written from the shop's local calendar date |
| Every "Today" button in the panel | midnight → midnight | the device's date |
| The kitchen board | 05:00, written into `ServiceDay` | chosen, but on its own |

So a restaurant still serving at half past one pressed "Today" on its sales
list and was shown **nothing** — the panel asked for a date the server said
had not begun — while the dashboard beside it kept adding to the evening. A
shift opened after midnight started a **second** trading day beside the
evening's, which the dashboard then reported as "yesterday was never closed".

## The rule

`App\Support\ShopDay`. A shop's day turns at an HOUR, on its own clock, and
everything asks there.

- **Five in the morning** unless the shop says otherwise. Not midnight: a
  karahi house takes money until two, and "today's sales" read at half past
  one should be the evening. Five is after any night's last sale and before
  any morning's first.
- **A shop can choose**: Settings → Tax & Delivery → Your trading day.
  Midnight, or any hour to eight (`day_turns_at`, null = the usual).
- **Nothing any shop has been shown moves.** Unset, the day is cut exactly
  where it always was — midnight UTC — which in Pakistan IS five in the
  morning. A flat "5" would have moved every shop not on Pakistan's clock on
  the day this shipped. (`AShopsDayTurnsOnceTest` walks three days in quarter
  hours and requires every moment to keep its date.)
- A sale at one in the morning belongs to the evening before on every
  figure; its receipt still prints one in the morning, because that is when
  it happened (`ShopTime`).

The panel has the same arithmetic (`common/shopDay.ts`), told the rule by the
shop's settings, so "Today" asks for the day the server will answer with.

## The till's day

`BusinessDay::tradingDateAt()` — one answer for a shift that is opening and
for a sale arriving late from an offline till.

It is the shop's business date, with one exception: **a day that has been
closed off is over**. What is rung after that, once the calendar has moved
on, is the next day's.

| When | The evening's day | A shift opened now trades under |
|---|---|---|
| 01:00 | still open | yesterday — the evening goes on |
| 01:00 | closed at 00:05 | today — a new day has begun (a petrol pump, a 24-hour chemist) |
| 15:00 | closed at 14:00 | today, which is closed: refused, and it can be opened again |

## Two kinds of date

Only a MOMENT is moved by the hour a shop cashes up. A date somebody can read
off a box is a date on a calendar, and is compared with the date on the
shop's WALL (`ShopDay::calendarToday`) — which it was not: it was compared
with the server's, so in the small hours

- a strip that expired on the 6th was still sold at four on the 7th;
- a quotation valid until the 6th had not lapsed;
- rent due on the 7th was on the "due" list's wrong side, and a bill dated
  the 7th was refused as a date in the future.

`TheDateOnTheShopsWallTest`.

## Deliberately not moved

Named so that nobody "fixes" them: the platform console's own figures and
its commission invoices (the platform's clock, not a shop's); a rider's
earnings (a rider works for several shops); `Retention` (a horizon in
months); a plan's entitlement dates; warranty days; the nightly expiry
notifier and the two `ProductBatch` window scopes (windows of weeks, where
five hours is not a decision).

## Tests

`AShopsDayTurnsOnceTest` (12), `OneNightIsOneDayTest` (3 — one night rung
through the real doors, then every screen asked which day it was; and the
same night for a shop on midnight), `TheDateOnTheShopsWallTest` (3),
`PosSyncTest` (+3, rewritten to the rule). Panel: `shopDay.test.ts` (16),
`dateRanges.test.ts` (+4), `useShopDay.test.tsx` (5).

Mutations: 46 + 11 on the server, 26 on the panel — all caught, after five
survivors on the first pass each got a case of its own (a midnight shop's
second shift, the activity trail, another branch's close, the kitchen's
turn, a day dated ahead of the dashboard's).

One test in the suite had been failing every night between midnight and five
without anybody seeing it: "a future-dated expense is refused" posted the
server's tomorrow, which is the shop's today.
