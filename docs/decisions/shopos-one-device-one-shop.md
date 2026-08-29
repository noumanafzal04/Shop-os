# One device, one shop's shelf

**2026-08-29.** The user said they thought they had seen another tenant's
products on the POS screen. They had.

## The hole

IndexedDB is scoped to the **origin**, not the tenant. One browser used by two
shops has ONE database. The outbox has always known this — `belongsHere` checks
every queued sale against the shop that is signed in, because posting shop A's
takings under shop B's token moves money between two businesses with no way to
unpick it.

The **catalog** had no such rule. Its rows carry no tenant at all. `clearCaches()`
was written for exactly this case — its own docblock says *"when a till is handed
to a different shop"* — and **nothing ever called it**. Logout clears the auth
store and the query cache and does not touch IndexedDB.

## Proof, on production

Two throwaway demo shops through the public front door, and the page asserted to
be signed in as the pharmacy before anything else was believed:

```
pharmacy's own   Brufen 400mg, Cough Syrup, ORS Sachet, Panadol, Surgical Mask
the mart's       Cooking Oil, Milk, Rice, Sugar, Tea        ← leaked
```

## The fix: a stamp, not a wipe on logout

Logout is not the only door. A token expires, a tab is closed, a tablet is handed
over and somebody signs straight in as another shop. A wipe wired to the sign-out
button covers the one path a person takes deliberately and misses every path they
take by accident — and the accidental ones are the ones nobody is watching.

`SyncMeta.tenantId` + `ensureDatabaseBelongsTo()`, checked at the moment of USE:
on every pull, and again at sign-in (the earliest moment there is).

Two things it must **not** do, both mutation-proven:

- **Clear the durable stores.** Outbox, shift queue and receipt counter hold work
  that never reached the server, plus slip numbers already given out. They have
  their own fence and must survive a handover.
- **Treat an unstamped database as a stranger.** Every till in the field is
  unstamped the day this ships; reading that as "somebody else's" would empty all
  of them for a handover none of them had.

And the half that would have been missed: `SYNC_META` is deliberately *not* a
cache store, so clearing the catalogue while leaving the cursors would send the
next pull asking for a **delta against the other shop's position** — a till
reporting a healthy sync while holding an empty shelf.

## Two of my own test bugs, in one session

Worth more than the fix, because both produced confident wrong answers.

1. **`hasText` locators re-evaluate on every access.** A badge located by
   `/still to send/` stops matching the instant its label changes — so the spec
   could never observe either of the two states it existed to check. It reported
   a product bug that did not exist.
2. **`addInitScript` runs on every navigation.** It kept restoring shop one's
   token before shop two's page loaded, so the first leak "proof" could not have
   observed what it reported. The bug turned out to be real; **that run was not
   evidence of it.**

**STANDING:** in any two-tenant test, assert which tenant the page is signed in
as *before* believing anything the test says about what it holds.

Related: [Measurement That Lied](shopos-measurement-that-lied.md),
[Promise In Another File](shopos-promise-in-another-file.md),
[Half The Sync](shopos-half-the-sync.md).
