# Who changed what

**2026-08-21.** The audit trail recorded who may **do** things, and said nothing
about what those things are **worth**.

Eight sensitive actions, driven through the API as a shop owner, each one proven
to have changed something before its absence from the trail was allowed to mean
anything:

| act | recorded? |
|---|---|
| the discount ceiling on a cashier's discretion | **yes** |
| a staff permission granted | **yes** |
| a member of staff suspended | **yes** |
| a customer's credit limit, Rs 5,000 → Rs 90,000 | **no** |
| a tax rate, which re-rates every product on it | **no** |
| a customer group's discount, every member at once | **no** |
| a coupon — money off every bill that quotes it | **no** |
| a product's price | **no** |

Every line in the second half is a **money authority**. Every line in the first
half is proof the shop already believed such things were worth recording.

> **A trail that records permissions and not the money those permissions move is
> a trail about the door, not the room.**

`TaxGroup`'s own docblock states the consequence and has since the day it was
written: *"edit the rate once and **every product on it re-rates**."* Nothing
recorded who edited it, and the difference between the old rate and the new one
is money owed to FBR.

## And nobody in the shop could read any of it

The only way in was `GET /admin/audit-logs`, behind `role:super_admin`. A shop
owner saw **eight rows** on their dashboard, with nothing to filter, no date
range and no way to ask a question — while the Help Centre told them, correctly,
that the log records who entered a figure and when.

> **A record that nobody named in it can read is not accountability. It is a
> promise about a filing cabinet in somebody else's office.**

Seven "built but unreachable" findings preceded this one; the difference here is
that the thing out of reach was the shop's own history.

## The fix

### Whole model, or one field

`Auditable` gained `auditOnly()` — an allowlist. Some models are worth recording
in one respect only, and auditing them entire would be worse than not auditing
them at all: a customer record changes every time somebody corrects a phone
number at the counter.

When it is set:

- an **update** that touches none of those fields writes nothing;
- a **create** is recorded only if one of them arrives with a value — *a
  customer given a Rs 90,000 limit on day one is the same act as raising it to
  Rs 90,000 on day two, and the log has to hold both*;
- a **delete** is always recorded — losing the row is losing the field.

A method, not a property: PHP refuses to compose a trait whose property a class
redeclares with a different default, which is exactly what overriding means.

### What is now audited

| model | scope | why |
|---|---|---|
| `Customer` | `credit_limit` only | how much this person may walk out with unpaid — the same class of act as granting a permission |
| `TaxGroup` | whole | one edit re-rates every product on it, and the difference is owed to FBR |
| `CustomerGroup` | whole | one edit changes the price for every member, and nobody at the counter sees it happen |
| `Coupon` | whole | a money instrument, and **deliberately outside the discount ceiling** — so the ceiling's own trail says nothing about it |

All four are low-volume. That is not a coincidence; it is the selection rule.

### The shop can read its own trail

`GET /audit-logs`, tenant-scoped, with filters for what / who / when, behind
`Permissions::READS_AUDIT` = `settings.manage` **or** `reports.view`.

An ANY-of set, not a single manage permission — the `*.manage` bug class again
([[shopos-read-vs-manage]]): the person most often being **asked about** is the
one holding `settings.manage`, and a trail only they can open is not a trail.
Same marker as `SUPERVISES_TILLS` and `READS_COST`. A cashier holds neither.

The scoping `where` is explicit and commented, because `AuditLog` carries a
`tenant_id` and is deliberately **not** tenant-scoped as a model — the platform
reads across every shop, so a read that forgets to say which shop it wants is
the worst possible bug in this particular table.

The screen speaks shop words. `TaxGroup` is a class name; **"Tax rate"** is the
thing that changed, and a shopkeeper looking for who moved it from 17% to 5% is
not searching for a model.

## What was deliberately NOT audited

- **Product prices.** A shop importing five thousand rows would bury its own
  trail in one afternoon, and *a record nobody can read to the bottom of
  protects nobody*. "Who repriced this" is a real question and it needs a
  different shape — a price history on the product — not a bigger list. Said
  out loud in the Help Centre rather than left to be discovered.
- **Supplier and branch contact details.** Not money authorities, and
  `suppliers` already carries `created_by` / `updated_by`.

## What a values-less row still means

One subtle regression, caught before it shipped. Moving the exclusion filter
earlier meant that an update whose **only** changed field is excluded —
`password` — would write nothing, where before it wrote a row with empty values.

That row is the signal. Losing "somebody's password changed" to a refactor about
credit limits would have been a security regression bought with a tidier
function. The allowlist swallows a values-less change; nothing else does, and a
test pins it in both directions.

## How it was found

The same method as [[shopos-other-half-of-a-date]] and
[[shopos-ceiling-follows-the-bill]]: **list what each path does, and read the
difference.** Here the list was written by driving eight acts through the API
and diffing the trail before and after.

**The probe was wrong twice before it was right**, both times in ways that
would have produced a confident wrong answer:

1. It read `tenant_id` off `/auth/me`, which returns a nested `tenant` object.
   The filter then became `?tenant_id=None` — a non-empty string — so the API
   filtered on a tenant literally called "None" and returned **zero rows**. A
   probe reporting "nothing is recorded" while looking at the wrong shop.
2. It keyed the trail on `(entity, event, entity_id)`. A **second** "User
   updated" for the same user is the same tuple as the first, so it vanished
   into the set — and the probe reported that a permission change left no
   record, having just watched it leave one. Keyed on the audit row's own id
   now.

> **Suspect the detector before the code.** Third time this week.

## Phase T

Sweep phase T asks it of every shop with a till: is a money authority recorded,
is a walk-in customer *not* recorded, and can the shop read its own trail — and
not a cashier, and never another shop.

**Two shops, always.** `AuditLog` is not tenant-scoped as a model, so one
`where` in one controller is the whole boundary, and a run with one shop cannot
see that boundary at all.

Four mutations (40–43): the trail forgets, the trail names nobody, two shops are
handed the same row, and the cashier's 403 reads as an answer.

## `Report.expect` reads a list as ALTERNATIVES — twice now

Phase S hit it yesterday and phase T hit it today, so the API was the problem,
not the callers. `expect(got, want)` treats a collection `want` as *"any one of
these will do"*, which turns a comparison of ORDER into nonsense and makes an
**empty** `want` unsatisfiable — a check that can only ever query.

Two rules added, both about the caller rather than the product:

- an empty `want` is always a caller bug, and says so in the row;
- when **both** sides are collections the caller means **equality** — "is this
  list one of the acceptable values" would need a list of lists, which nothing
  here does.

Related: [[shopos-read-vs-manage]], [[shopos-security-pass]],
[[shopos-other-half-of-a-date]], [[shopos-ceiling-follows-the-bill]],
[[shopos-sold-out-and-reachability]], [[shopos-detector-vs-rule]]
