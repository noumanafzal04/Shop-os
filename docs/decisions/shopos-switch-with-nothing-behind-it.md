# A switch with nothing on the other end

**2026-08-27 · panel + backend · `pos_require_shift`, `--pinned-bottom`**

## The report

> "required open shift toggle / like check all toggles are properly integrated
> on their places"

Fifty preferences are written by the Settings page. Counting *files that
mention a key* is not evidence a key is READ — the migration mentions it, the
validator mentions it, the allow-list mentions it. So each was traced to an
actual reader.

Forty-nine had one. `pos_require_shift` had none in the panel.

## What it did

The setting is real and the server honours it: `cash_session_id` is `nullable`,
and `SaleController::store` refuses a shiftless counter sale only when the shop
has asked for that. The intent is written down in the test that pins the
default:

> *"Shift discipline is opt-in: enforcing it by default would stop a
> one-person shop from selling the day the check went live."*

The till read none of it:

```ts
const canRing = activeSessionId !== null;
```

So shift discipline was **always on at the counter**, whatever the shop had
chosen. Three consequences, in rising order of seriousness:

1. Turning the switch off changed nothing anybody could observe.
2. The message under a disabled Tender button — "Open a shift to sell." —
   asserted a shop rule that shop had never set.
3. **A one-person shop that had never opened a drawer could not ring a single
   sale.** Precisely the outcome the default exists to prevent.

Verified in a browser, both directions, on a shop with no open shift:

| `pos_require_shift` | before | after |
|---|---|---|
| off (the default) | Tender disabled, "Open a shift to sell." | cart fills, **Tender enabled** |
| on | Tender disabled | Tender disabled, "…this shop requires one." |

## The shape of the bug

A rule enforced in one place and re-derived — differently — in another. The
server asked "does this shop want shifts?"; the till asked "is there a drawer?"
Both are reasonable questions. Only one of them is the setting.

The fix is not "read the flag in PosPage". It is `canRingASale(session,
requireShift)` in `posService`, with `whyCannotRing` beside it, so the gate and
the sentence under the button cannot drift — which is how a disabled button
came to be labelled with a rule nobody had turned on.

## The second one, found on the way

`useReservesBottomRoom` already existed: the PWA install prompt is
`fixed bottom-3` at `z-[99998]`, so AppLayout pads by `--pinned-bottom` and the
page ends above the card instead of behind it.

Four pages run OUTSIDE AppLayout — the till, the floor, the tab workspace and
the kitchen board. None of them subtracted it. On a page with ordinary scroll
that costs a flick; on a page that is **exactly `h-dvh`** there is no flick, so
whatever the layout pins to its own bottom is under the card permanently. On
the dine-in tab that was "Running total" and the Fire-to-kitchen and Settle
buttons — the two things a waiter is on that screen to press.

`HelpCenterPage`, also full-screen, had it right. The same rule applied to one
half of the screens it belongs to.

`FULL_SCREEN_PAGE` is now the one spelling, and `fullScreenPage.test.ts` reads
the ROUTER for the list rather than holding its own copy.

## Two detectors that were wrong first

Worth recording, because both failed in the direction that looks like success.

**The full-screen guard found zero pages.** `App.tsx` mounts `AppLayout`
**twice** — once at `/admin`, once at `/tenant` — and `indexOf` found the admin
one, so "routes before the shell" was a slice containing no tenant routes at
all. The guard passed, having examined nothing. Only its denominator
(`expect(fullScreenComponents().length).toBeGreaterThanOrEqual(4)`) caught it.

**`everyScreenIsWalked` reported the wrong screens.** Adding the tab workspace
to the restaurant walk meant `SCREENS` entries carry `path: (id) => …` instead
of a string literal. The guard's regex read literals only — so it did not
report the tab as unwalked, it reported **the floor and the kitchen board** as
unwalked, because the whole array stopped matching. A parser that silently
stops reading is the failure this codebase keeps meeting; it failed loudly this
time only because those two were already covered.

## Standing rules

**A count of files mentioning a setting is not a count of readers.** Trace each
one to the code that branches on it.

**Where a rule is enforced server-side and mirrored client-side, the client
reads the setting — it does not re-derive the rule.** The mirror and the fence
must be able to disagree only about latency, never about policy.

**A page outside the shell still has to reserve room for what is pinned to the
viewport.** `h-dvh` has no scroll room to recover with.

Related: [[shopos-promise-in-another-file]], [[shopos-guards-share-a-blind-spot]],
[[shopos-half-a-rule]], [[shopos-detector-vs-rule]].
