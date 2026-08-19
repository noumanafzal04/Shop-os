# Offline selling, in a real browser, for the first time

**2026-08-19** · panel `e2e/selling.spec.ts`, `PosPage.tsx`, `useKeepInSync.ts`, `TillLock.tsx`

## What had never happened

Two thousand backend tests ring sales over HTTP. A thousand panel tests exercise
the pieces in jsdom. Between them, **no sale had ever been rung through the
actual screen**, and **no offline sale had ever been rung at all** — because
jsdom reports `navigator.onLine === true` and nothing can change it. Every
offline test in this repo had exercised the offline path *while the app believed
it was online*.

`context.setOffline(true)` is the only thing in this project that can put the app
in the state the whole offline module exists for. Two specs now do it.

## Five defects, and every one of them is about what the cashier is told

### 1 · A sale that could not be rung said nothing at all

The tender panel rendered an error only for `checkout.error instanceof ApiError`.
The offline path is *entirely* other than the server — pricing the cart from the
till's own catalog, writing the outbox, issuing a slip — and `OfflineRefused
extends Error`, not `ApiError`.

So when the fixture shop turned out not to be granted offline selling, pressing
**Complete sale** did this: nothing. No spinner, no message, no sale. A dead
button, on the one screen where somebody is standing at a counter with a
customer waiting. It took a source probe to discover the till had a perfectly
good sentence ready — *"This shop's tills aren't set up to sell without a
connection yet. Take cash at the counter and ring it once you are back online"* —
that nobody could see.

Now every failure is shown, and a **refusal** is titled as one: "Can't ring this
offline". A refusal is not a failure, and telling a cashier to "try again" about
a sale the till has decided it cannot ring is worse than saying nothing.

### 2 · The queue drained and the pill said it hadn't

Measured, in the browser: the line comes back, the row goes `pending → acked`
with invoice `INV-000918` **eight seconds later** — and the pill reads **"1 still
to send"** a minute after that, and for the rest of the shift.

`pendingCount()` was correct. It was simply never called again. The count was
read on `[enabled, connected]`, and neither of those moves when a flush
finishes — the till was already connected; that is *why* the flush ran. So the
last number read was the one from before the sales went.

What the shop watches: "Sending 1 of 1" → "1 still to send". The one moment this
badge exists for — a day's takings going up after an outage — ends with it
reporting that they did not.

Fixed by recounting on the `syncing` transition, which is the thing that means
the queue moved, and nothing else: an idle till still does not re-read IndexedDB
every quarter hour for an answer that cannot have changed.

### 3 · A till that could lock itself out of its own shop

Unlocking is `POST /pos/till/unlock`, and the roster beside it is a plain query.
Both HTTP, neither with an offline path — and there is no PIN on the device to
check one against, deliberately, because a PIN mirrored into IndexedDB is a PIN
anybody holding the tablet can read.

So a till that locked during an outage could not be opened until the line came
back. A working till, offline selling switched on, a queue of customers, and no
way in — the exact failure offline selling exists to prevent, caused by a
convenience. Worse, the escape hatch underneath the keypad signs the till **out**,
through the same server, and would have closed the last door behind them.

The rule now: **a lock nobody can open is not security, it is a shutter.**

- the idle lock does not fire while the line is down
- the hand-over button is disabled and says why
- a till already locked when the line went is told *which door is shut*, instead
  of answering "Couldn't unlock. Try again." to every PIN typed at it
- the sign-out escape is shut while offline, and says why

### 4 · A dropped line could sign the till out

Found because a 1.5-hour suite run ended with the till sitting on the **Sign In**
page. The refresh was:

```ts
} catch {
  clear(); // refresh token dead → hard logout
}
```

A bare `catch`, and a comment asserting a cause the code never checked. Every
way a request can fail landed there — a dropped line, a timeout, a 502 while the
API restarted, a rate limit — and every one of them signed the shop out.

On a till that is the worst outcome in this application. Sales rung during an
outage live in IndexedDB and can only be sent **with a token**; sign the till out
and the queue is stranded behind a login screen that also needs the server. The
shop is left holding a day's takings it cannot deliver, on a device that looks
as though it has been wiped.

**Only the server may end a session.** `clear()` now runs on 401 and 403 — an
actual answer, saying this refresh token is no good — and on nothing else.

### 5 · A phone never said it was offline

The connection pill was `hidden … sm:flex`, and a phone is below `sm`. It is the
only thing on the till that reflects whether the shop is reaching its server, so
a phone selling through a power cut looked exactly like a phone selling normally
— sales piling up on the device with nothing saying so. Proven in a browser: the
offline sale went through on a phone and **not one visible word** on the screen
mentioned it. The pill is drawn at every width now; its labels are short and the
bar it sits in wraps.

## What the tests did to themselves, again

- **`before.length + 1` against a paged endpoint.** `/sales` returns fifty rows.
  Once a shop has fifty sales the length never changes, so the check read "the
  queue never drained" for ever, about a queue that drained in eight seconds.
  Compare the *numbers*, not the count of them.
- **A leaf-only text detector.** The offline-indicator check skipped any element
  with an element child. The pill is `<button><span dot/>Offline</button>` — one
  child — so the rule reported that the till said nothing about being offline
  while the word "Offline" sat on screen in red. Ask each element what **it**
  says, via its own text nodes.
- **`offline_selling` is a platform GRANT, not a shop setting** — a plan limit on
  the tenant, published on the catalog envelope beside `offline_days`, not inside
  `settings`. A fixture that assumed otherwise would have tested the refusal
  while claiming to test offline selling. `shelf.setup.ts` now asserts the grant
  and prints the one command that gives it.
- **And the one worth keeping:** `useKeepInSync.test.tsx` mocked
  `pendingCount: async () => 0`. A constant. **A stale count was unobservable by
  construction** — the test could not have failed however long the badge lied.
  The mock is a `vi.fn` now and the staleness is the assertion.

## What is pinned

- `e2e/selling.spec.ts` — a cash sale that must exist **on the server**, with the
  shelf moving by the number of lines; an offline sale that must **not** be on
  the server while the line is down and must arrive when it returns; and the
  badge clearing after it.
- `useKeepInSync.test.tsx` — the count is re-read when a flush finishes, and not
  on a quiet heartbeat.
- `TillLock.test.tsx` — the first test this component has ever had.
- `posChrome.test.ts` — the idle lock is gated on the connection.

Every one proven red on revert.


## And one thing NOT fixed, because it is a decision

The server refused a queued sale with `Duplicate entry
'<tenant>-OFF-TILL-001D-000001'`, and the till retried it for ever behind *"This
sale could not be recorded. It is still safe on the till."* It is safe, and it
can never leave.

The slip is `OFF-<register>-<4 chars of device id>-<counter>`. The **device id
lives in localStorage and the counter in IndexedDB** — different layers, with
different eviction behaviour, and this codebase already warns about eviction. If
IndexedDB goes and localStorage stays, the counter restarts at 1 under the same
device segment and every offline sale after that collides with one already
recorded. Separately, `DEVICE_SEGMENT = 4` is 65,536 values: two tills in one
tenant can share a segment and deadlock each other from their first sale.

Left alone deliberately. The slip is printed, handed to a customer, and is the
handle a refund is found by — changing its shape, or re-numbering a queued row,
both reach well outside this module. Written up in `docs/qa/FINDINGS.md` with
three options.
