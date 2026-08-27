# The one screen built to survive an outage had no offline shell

**2026-08-27 · panel · `ServiceWorkerHost`, `dueRows`, `useManualSync`**

Reported from the live shop at `panel.cartze.shop` after a real test:

> "i sell 4 items and click to syncing, its showing up to date and again
> showing 4 till but not sync"
> "jb net offline krdi wifi bnd krdia, products show ni hui sari"

Three separate defects. All three verified in a browser, none of them
theoretical.

## 1. The till never registered a service worker

`ServiceWorkerHost` was mounted in `AppLayout`. The **till, the floor, the tab
workspace and the kitchen board all render outside AppLayout** — so a cashier
who opened `/tenant/pos` directly, which is exactly how a till is opened,
registered no worker and precached nothing.

Measured, before:

```
on /tenant        → { regs: 1, caches: 1 }
on /tenant/pos    → { regs: 0, caches: 0, controlled: false }
offline reload    → net::ERR_INTERNET_DISCONNECTED
```

After the fix, straight to the till:

```
on /tenant/pos    → { regs: 1, caches: 1 }  → controlled after one reload
offline reload    → the shift, the products, the cart. Everything.
```

This is the **same class** as the `--pinned-bottom` bug fixed the same day:
something AppLayout provides that four full-screen pages never receive. It is
now mounted by the wrappers that cover every authenticated screen —
`TenantThemed` for the shop, `AdminShell` for the console — one each, because
`useRegisterSW` registers again on a second call.

**`offline-shift.spec.ts` — "a till that reboots into an outage" — had been
failing on exactly this, and an earlier session dismissed it as pre-existing
and environmental.** It passes now. A failing test that names the symptom
precisely is not noise; it was the only thing in the codebase that already knew.

## 2. "Sync now" reported success without looking at the queue

Two compounding faults.

**The backoff applied to a press.** `markRetry` sets an exponential wait capped
at ten minutes and `dueRows` filters on it. So a cashier who watched four sales
fail, pressed Sync, and was told "Up to date" was reading the literal truth
about a flush that found nothing DUE and sent nothing at all.

A press is not a poll. Somebody is standing there with the shop's money in the
queue. `dueRows(now, tenant, force)` ignores the wait when a person asked —
and **only on the first round**, so a row that fails inside this very flush
still earns its wait.

The tenant fence is *not* bypassed by force, and there is a test that says so:
skipping the wait is a convenience, skipping the fence would file one
business's takings in another's books.

**The button reported the pull, not the queue.** `pullNow` swallows a flush
failure on purpose — a till must not stop learning its catalog because its
queue will not go — and `useManualSync` read that resolved promise as success.
So the catalog coming *down* was being reported as the sales having gone *up*.

The flush result is now returned rather than discarded, the queue is asked
afterwards, and the control says what is true:

| | |
|---|---|
| `Up to date` | the queue is empty |
| `4 still to send` | it tried; four are still here |
| `3 refused` | pressing again cannot help — open the report |

The old screen drew "Up to date" beside a badge reading 4. Both came from the
same component, one of them was false, and **the false one was the reassuring
one**.

## 3. A shop could not ask whether a device was ready

The catalog has always synced on its own — on boot, on reconnect, every fifteen
minutes — and every bit of that is invisible. So the only way to find out
whether a device could trade through an outage was to have one, and a shop that
pulled the plug to test it drew the wrong conclusion about the whole feature.

`OfflineReadyPanel` (Settings → Point of Sale → Lanes & PINs) states what
**this device** holds: products, customers, and codes — with a button that runs
the same sync deliberately.

Codes are called out separately on purpose. A till with a full catalog and an
empty barcode index can be searched by hand and **cannot be scanned**, and
those are very different shops. Nothing on screen distinguished them before.

## What was checked and found NOT broken

Worth recording, because both were plausible and both were wrong.

- **HTTPS.** The user wrote `http://`, and a service worker needs a secure
  context — a tidy explanation for all of it. The server already redirects
  `http → https` and serves 200 on both hosts. Checked before it was asserted.
- **The barcode index.** `barcodeIndex: 1` against 31 catalog rows looked like a
  broken index. It is correct: exactly one product in that fixture shop has any
  code at all. Counting the catalog rows that carry a barcode, SKU or PLU gave
  1 — the index agreed with its input.

## Standing rule

**Whatever AppLayout provides, the four full-screen pages do not get.** The
till, the floor, the tab and the kitchen board render outside the shell. Before
adding anything to AppLayout, ask whether the till needs it too — and it
usually needs it most.

Related: [[shopos-full-screen-pinned-room]], [[shopos-offline-never-reachable]],
[[shopos-sync-progress-pill]], [[shopos-the-machine-slept]].
