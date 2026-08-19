# The slip number that could deadlock a till

**2026-08-20** · backend `PosSyncController`, `PosDeviceController`, `PosCatalogController`; panel `receiptNumber.ts`

## What happened

The browser suite hit it: a queued sale refused by the server with

```
Duplicate entry '<tenant>-OFF-TILL-001D-000001'
for key 'sales_tenant_offline_number_unique'
```

and the till retried that same number every few minutes, for ever, behind the
words *"This sale could not be recorded. It is still safe on the till."*

It was safe. It could not leave. **That is money stranded on a device.**

## Why it could happen at all

The slip is `OFF-<lane>-<device>-<counter>`, and the two halves that make it
unique come from two places that do not fail together:

| part | lives in | survives |
|---|---|---|
| device segment | localStorage | eviction of IndexedDB |
| counter | IndexedDB (`receiptCounter`) | — |

**One.** A browser can evict IndexedDB and keep localStorage. This codebase
already warns about eviction — `StorageWarning`, `persist.ts`. The counter then
restarts at 1 under the same device segment, and every slip minted after that is
one the shop already has.

**Two.** The device segment was **the first four characters of the random UUID
the browser minted for itself**, with nothing anywhere checking whether another
till had them. Four characters is 65,536 values. A shop running fifty tills had
roughly a one-in-fifty chance that two shared a segment — and from their first
sale each, they printed identical slip numbers for different customers.

A hash where an allocation belongs.

## What was done — all three, and the shape never changed

Four characters in the device segment before, four after. Only the guarantee
behind them is different.

### C · A label may never cost a sale

The operation id is already the idempotency key, and it is checked before
anything else. **If that is new, the sale is new.** Refusing to record real money
because a label repeats is the wrong way round.

`PosSyncController` now files the sale under a disambiguated label — `…-D2` —
and tells the shop:

> The slip number OFF-… had already been recorded, so this sale was filed as
> OFF-…-D2. A till mints these itself, and this one restarted its counter —
> most likely its saved data was cleared. Two customers may be holding slips
> printed with the same number.

The printed number stays the **stem**, so `Sale::search`'s LIKE still finds the
sale from what is on the customer's slip. Two customers with one number is a
mess; a lost sale is worse, and a silent one is worse still.

### B · The counter cannot go backwards

New `sales.offline_seq` — the sequence as a **number**, beside the label rather
than inside it. The label now has a `-D2` form, and a SQL parse of the string
would read that wrong. Same lesson as the receipt tray: order by the sequence
column, never by a rendering of it.

The catalog pull — the one call a till makes while it still has a line — answers
`offline_sequence` for the asking device, and `nextSequence()` takes
`max(local, server) + 1`. A stale answer can never pull the counter back; a
server too old to send one changes nothing.

### A · The device segment is allocated

New `pos_devices.code`: four characters, **unique per tenant**, handed out once
at registration and never changed under a till that has already printed it — a
till that took a new code on its next boot would leave the shop with two runs of
numbers for one device.

Two deliberate choices in how it is minted:

- **The alphabet omits `O 0 I 1 S 5`.** Somebody reads this code down a phone
  when they ring up about a refund.
- **Random, not sequential.** A sequential code lets anyone holding one slip work
  out how many tills the shop runs, and a gap in the run looks like a missing
  till rather than a retired one.

A till that has never once reached the server still slices its own id — a tablet
unboxed during an outage. Its numbers are no worse than they always were, and it
takes an allocated code the first time it gets a line.

## Proven

Every part red on revert:

- `PosSyncTest` — the second sale is refused over a repeated label; the shop is
  never told
- `PosDeviceTest` — no code allocated; a code containing the characters people
  misread
- `receiptNumber.test.ts` — a wiped counter restarts at 1; the slip carries a
  guessed segment

And one test that was lying: `test_a_tills_code_never_changes_under_it` passed
with the allocation deleted, because `assertSame(null, null)` is true. It asserts
`assertNotNull` first now. **Two nulls agreeing is not a test.**
