# The till reloads, and the offline module is behind a gate that needs the server

**Found 2026-08-18. The severe half is FIXED the same day; the rest is scoped
below.**

Offline selling is complete: a catalog on the device, a barcode index, a pricing
mirror proved against the server by shadow mode, an append-only outbox, refusals
worded for the counter. Phases 0–4 shipped.

And a till that **reloads while offline cannot ring anything.**

## The chain

`PosPage` disables Tender/Pay when there is no open shift:

```tsx
disabled={cart.length === 0 || !open}
```

`open` comes from `useCurrentSession()` — a plain `useQuery` against
`/pos/session`. There is no query persistence (`persistQueryClient` appears
nowhere), and the service worker's only runtime cache is product images. So the
shift lives **in memory and nowhere else**.

| Situation | What happens |
| --- | --- |
| Outage mid-shift, page stays mounted | **Sells.** The query keeps its last data. This is the case that was tested. |
| Page reloads while offline | `open` is null → **"Open a shift to sell."** Pay disabled. |
| Outage at opening time | No shift can be opened at all. |
| Shift ends while still offline | Drawer cannot be closed, cash cannot be counted, no Z-read. |

A tablet sleeping, a PWA relaunch, or a browser reclaiming memory all reload the
page. So does a power cut — **which is the example the Help Centre gives**:

> a till keeps trading through **a power cut** or a dead connection. Nothing for
> you to switch on at the counter — the POS notices and carries on.

After a power cut the tablet reboots. The page reloads. It cannot sell.

## It was designed, and the shelf for it was built

The offline plan's capability table:

> | Open / close a shift, count the drawer | ✅ (Z is provisional) |

and its store table:

> | `shift` | local shift + drawer movements | **push** |

`STORE.SHIFT` exists in `db/schema.ts`, is listed in `DURABLE_STORES` beside the
outbox — *"work that has not reached the server, never dropped"* — and has an
upgrade test proving its rows survive a schema migration.

**Nothing writes to it. Nothing reads it.** `/pos/session/open`, `/close` and
`/movements` are plain `apiPost` with no queue.

The store was protected against a migration that would never have anything to
destroy.

## Why the panel's own reachability rule missed it

`reachable.test.ts` catches *an export whose only caller is its own test*.
`STORE.SHIFT` is not an export — it is one key in an object literal that is used
constantly. The rule asks about symbols; this is a symbol that is referenced and
a **capability** that is not. Worth knowing before trusting the next clean sweep:
the guards find unreachable code, not unbuilt design.

## What was checked, so the count means something

Nine ✅ claims in that table, read against the code:

| Claim | Verdict |
| --- | --- |
| Ring a sale, print a receipt | holds — but behind the shift gate above |
| Barcode / scale barcode / PLU | holds (`findByCode` → `BARCODE_INDEX`) |
| Variants, packs, modifiers, weight items | holds (catalog projection) |
| Discount within the ceiling | holds |
| Attach a customer for attribution | holds (free text + cached group match) |
| **Open / close a shift, count the drawer** | **not implemented** |
| **Hold and recall a sale** | **not implemented** — `/pos/held` is server-only, no local store, and no refusal message either, so it fails with a generic error |
| Loyalty earn (server awards on sync) | holds; redeem is correctly refused |
| Coupon: unlimited-use rules | false in the SAFE direction — `canSellOffline` refuses every coupon, including unlimited-use |

Six hold. Two are false in the dangerous direction. One is false in the safe one.

Note what the open cart does NOT cover: `cartStorage.ts` parks the trolley in
localStorage so a stray F5 does not lose a customer. That is the CART. It is not
the shift, and it is not a held ticket.

## What a fix has to do

1. **A local shift record.** Written when a shift opens online, so a reload
   offline still knows which `cash_session_id` it is standing at, whether it is
   a practice shift, and the opening float. This is what `STORE.SHIFT` was
   created for.
2. **Queued open / close / movements**, append-only beside the outbox, with the
   same tenant fence and the same ordering guarantee — a close must never reach
   the server before the sales that belong inside it.
3. **A sync endpoint that accepts them**, validating the same way
   `PosSyncController` validates a sale.
4. **A decision about opening a shift with no server at all.** A client-minted
   session id has the same collision problem the offline receipt number solves
   with `OFF-…`, and the same answer is available.
5. **Z-read stays provisional offline**, as the plan already says.

## What shipped

**Step 1 is done: a reload no longer loses the shift.**
`modules/offline/shift/shiftMirror.ts` writes the session row into `STORE.SHIFT`
on every successful answer from `/pos/session`, and `useCurrentSession` hands it
back when the request meets silence. The till reboots and keeps selling.

Three rules make the fallback safe, each mutation-proved:

- **Only silence falls back.** `ApiError.status === 0` is the client's own
  discriminator for "we never reached the server". A **401 must not** produce a
  remembered shift — that is a signed-out till being handed a drawer — and a
  **500** is a broken server, which is a different conversation from a dead
  line. Both still fail loudly.
- **A closed shift is not a shift.** The mirror is cleared when the server says
  none is open AND when it hands back a closed one. Remembering a counted drawer
  is how a till goes on ringing into it.
- **Tenant-fenced, in both directions.** IndexedDB is per-origin, so one laptop
  with two shops has one database. Shop B must not be offered shop A's drawer —
  and mirroring for shop B must not DELETE shop A's row, which is a bug the
  tests caught after it was written.

A **cover is deliberately not mirrored.** It is a live arrangement only the
server can start or end; a remembered one would leave a reliever holding
somebody else's drawer after a reload with no way to hand it back.

## What was owed — closed 2026-08-21

**Three of the five were already built and this document did not know it.**
`shiftQueue.ts`, `offlineShift.ts`, `flushShifts.ts` and
`PosShiftSyncController` all shipped in the days after it was written, wired
into `usePos` and `pullNow`, with 13 backend tests green. The list below is what
was true on the morning of the 21st, checked rather than remembered.

> **A "still owed" list is a claim, and a claim goes stale.** Read the code
> before believing your own notes — twice this week a document has been more
> pessimistic than the repository.

1. ~~**Queued open / close / movements.**~~ Built. The flush order is the
   designed part: `open`, then the sales, then `movement` and `close`, so a
   close can never overtake the sales that belong inside it.
2. ~~**A sync endpoint that accepts them.**~~ Built — `POST /pos/sync/shifts`.
3. ~~**Opening a shift with no server at all.**~~ Built. `openShiftOffline`
   mints a local session shaped exactly like the server's, stamped with
   `shopNow()` — this device's clock with its measured drift applied, because a
   tablet three days slow would file a day's takings into a day already banked.
4. **Hold / recall offline** — was still server-only and still silent. **Now
   refused in words** (below).
5. **Z-read provisional offline** — the plan always said it and the till never
   did. **Now said on the close screen** (below).

## And none of it had ever run in a browser

That is the part that mattered. jsdom reports `navigator.onLine === true` no
matter what, so every offline unit test in the suite is an online test wearing
an offline test's name — a distinction that has cost this repo five bugs once
already. `e2e/offline-shift.spec.ts` drives the whole loop the way a shop does
after a power cut: reboot with no line, open a drawer, sell, count it out, and
only then ask the SERVER what it thinks happened.

**It passes on all four viewports** — and finding that out cost four fixes.

### The shared `Modal` had no `role="dialog"`

Every modal in the app was an anonymous div. A screen reader announced nothing
when one opened; nothing said the page behind was inert; the close button was an
icon with no accessible name, announced as "button". It also made the app
untestable by role — **a browser test asking for the dialog it had just opened
waited five minutes and timed out, which is how this was found.**

### A notice raised in the Cart was invisible on a phone

The till's one way of speaking lived inside the **Products** pane. A phone shows
one pane at a time, so every notice raised while the cashier was in the Cart —
the Hold refusal above, anything a cart action says — rendered into a pane they
were not looking at. Not hidden by a breakpoint, not missing: **somewhere else**,
which from the counter is the same thing.

Drawn once per layout now, with CSS choosing, and carrying `data-pos-notice` so
a test can ask for the one actually on screen. Found by the 390-point project
and by nothing else: on every wider screen both panes are visible at once and
the strip has always been fine.

### Ten identical boxes, all called "0"

The close-drawer grid is one input per denomination, and every one of them was
announced as its placeholder. The row is legible only to somebody who can see
the figure printed to its left — on the screen where a shop counts its own cash.
Each carries `aria-label="How many 500 notes"` now.

### "No held sales" is a false statement offline

The worse of the two hold bugs. A shop may have ten parked tickets; a cashier
told there are none rings one again from scratch. The list is the server's — the
till says that now, rather than answering a question it cannot answer. Pressing
Hold refuses in words rather than failing in silence, and refuses with words
rather than a dead button, **because a disabled control on a touch screen tells
nobody why.**

## Still not built, deliberately

**Holding a ticket offline.** A held ticket is site-wide and claiming one is a
locked server step precisely so two lanes cannot ring the same basket. Offline,
two devices could each hold and each claim. That is a design question with money
in it, not a missing feature, and it is not being answered by accident.

> A capability is not shipped until something a person touches can reach it. The
> gate in front of this one needed the server it was built to do without — and
> then, once the gate was gone, nobody had walked through it in a browser.
