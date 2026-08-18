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

## What is still owed

2. **Queued open / close / movements**, append-only beside the outbox, same
   tenant fence, and a close that can never reach the server before the sales
   that belong inside it.
3. **A sync endpoint that accepts them**, validated the way `PosSyncController`
   validates a sale.
4. **Opening a shift with no server at all.** A client-minted session id has the
   same collision problem the offline receipt number solves with `OFF-…`, and
   the same answer is available.
5. **Hold / recall offline** — still server-only, and still without even a
   refusal message.
6. **Z-read stays provisional offline**, as the plan already says.

The Help Centre now says what is true rather than what was intended: the shift
survives a restart, and a shift is still **opened and closed with a connection**.

> A capability is not shipped until something a person touches can reach it. The
> gate in front of this one needed the server it was built to do without.
