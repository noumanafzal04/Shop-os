# The estimate that hid the work

**2026-08-21.** Ten defects, found by finishing the verification lane that died
mid-run yesterday. The one worth reading this for is not a defect at all — it is
how close a wrong measurement came to burying an afternoon's work under a number
nobody would ever start.

---

## The number that was wrong in the expensive direction

For four days the accessibility backlog was recorded as:

> **245 form fields still have no accessible name.** Recorded with the number
> because a count is auditable and "we should improve accessibility" is not.

That was written approvingly, and the reasoning behind it stands: a count beats
a sentiment. The count was still wrong, and wrong in the way that does the most
damage. It came from a static grep — `<Input>` usages with no `id` — which
counts every field in every file, whether or not it is ever on screen at the
same time, and cannot see a name that is established at runtime.

Asking a browser instead, across the fourteen screens the layout suite already
walks:

```
   34 of 367 visible controls have no accessible name
   ── of which 24 were TWO buttons in the shared header,
      counted once per screen
```

Two `aria-label`s took the total from 34 to 10. Three more took it to zero.

245 reads as a migration. 34 reads as an afternoon. **The estimate was the only
thing standing between the two**, and it had been standing there for four days
with a number on it that made it look responsible.

The lesson is not "measure things", which everybody already agrees with. It is
that a measurement taken at the wrong layer can be precise, auditable, quotable
and still fund exactly the wrong decision. A static count of *code* answered a
question about *code*. Nobody was ever going to ask "how many `<Input>` tags
lack an `id`" — the question was "what does a cashier using a screen reader
hear", and only the thing that computes accessible names can answer it.

### What actually fixed 465 call sites

Not 465 edits. The labels were already on the screen:

```
   <Label>   rendered   327 times
   htmlFor   passed       5 times
```

So the fields were not unlabelled. They were labelled and *unattached* — a
shopkeeper sees "Credit limit" above a box; a reader hears "edit text, blank",
with the answer rendered two centimetres above it and outside the accessibility
tree. `src/common/a11y/useFieldName.ts` joins them at runtime by walking up from
the control to the label already sitting over it, the same argument the shared
Modal settled for dialog names: take it from what the component already renders,
because every call site already renders one.

Its load-bearing property is that **it gives up rather than guesses**. Two
controls under one label, a label already spoken for, a label below the field, a
label wrapping its own input — every ambiguity ends with no name. A field
announced as "Opening float" that actually holds the closing count is not an
improvement on an unnamed field; it is a field that lies, and it lies to the one
person with no way to check it.

The one deliberate compromise is marked as one. Twenty-seven search boxes have
no label because the placeholder *is* the affordance, so the placeholder is
promoted to a real `aria-label` — which answers the original objection
mechanically rather than dodging it, since an attribute does not clear when you
type. Those are stamped `data-name-from-placeholder` and the browser rule counts
them **separately**, with their own line in the output. Folding them into the
pass column would have made the total read zero while twenty-seven fields
answered to something nobody chose as a name.

---

## The scanner with the bug it was written to find

`docs/qa/unreachable-pages.py` exists because a list that can only ever show
page one has shipped nine times in this codebase. It judges a panel folder by
the API calls in the folder's own source — deliberately, so that
`components/ui`, which every screen imports a Button from, is not credited with
listing the tenant directory.

`src/modules/workshop/` contains no API call at all. The bay board fetches
`documentService.list(...)`, and `documentService` lives in `modules/documents`.
So the folder produced an empty list of endpoints, hit `continue`, and **was
never judged** — while the credit for `/sale-documents` went to
`modules/documents`, which passes on its search box.

Behind that blind spot:

```ts
documentService.list({ kind: "job_card", status: "open", page: 1 })
```

Page one, pagination discarded, 25 newest-first, then bucketed client-side into
three columns. A workshop with 26 open jobs loses the *oldest* car — the one the
board itself colours amber as overdue. And because the fetch is not per stage,
if the 25 newest all happen to be `received`, the Ready column renders "Nothing
here." while finished cars wait for collection. The board's whole job is
answering *"is my car ready?"* and it answered *"nothing is."*

A pager would be the wrong fix; page two of a kanban splits its own stages. The
other boards in this app agree — the kitchen board and the dine-in floor both
return unpaginated, because a working surface is not a list you browse. So the
board drains its pages, and the scanner learned a third honest verdict beside
"pages" and "search only": **`drains all`**.

Two follow-ons, both recorded rather than glossed:

- The scanner now folds in a service a folder imports *and calls* — narrow
  enough that a Button still does not qualify.
- It still credits an escape hatch to a **folder**, not to a **list**. Workshop
  came back "search only" the first time it was ever judged, on the strength of
  a product lookup inside the book-in modal — a search over a different list
  entirely. Proper per-list attribution needs a unit smaller than the folder.
  Written into the file's docstring as a known limit, because a scanner whose
  limits are stated can be trusted about the rest.

Same class, found by the same reasoning ten minutes later: the combo and recipe
pickers are a plain `<select>` fed by `useProducts({ page: 1 })`, and the
products endpoint pages at **fifteen**. A restaurant writing a burger recipe
could choose from fifteen possible ingredients. There was no search box, no
pager, and nothing on screen saying a catalogue of four hundred existed — and it
was invisible to the page-two scanner too, because a `<select>` full of
`<option>`s is not a table with a missing pager.

---

## Six more, in the order they hurt

### "Everyone" reached every role but one

`SendAnnouncement` resolved its audience with:

```php
'all' => [UserRole::ShopOwner, UserRole::Customer],
```

`UserRole::Staff` appears in no branch. The admin's dropdown labels that option
**"Everyone"**, and the migration promises "all tenant owners, all customers, or
everyone". So "Scheduled maintenance Sunday 2am — the till will be offline"
reached every owner and not one cashier: the people the message is *about* were
the only role it could not reach.

Staff are addressable — `/notifications` sits behind no role gate and the bell
renders for every signed-in role. There was a bell, and nothing could ever be
put in it.

`tenants` was deliberately left owners-only and **relabelled** from "All shops"
to "Shop owners", which was the same class of lie in the other direction.
Widening both would have fixed one label by deleting the admin's only way to
write to owners alone about billing. And the picker now reads its options from
the same map the list badge does, because the two had already drifted.

### An alert with nowhere to go, in a file that said where

```php
$type === 'stock.low' => 'inventory',
```

An exact-equality test standing in for a family. `stock.expiry.approaching` and
`stock.expiry.expired` matched nothing and shipped with `data.link` null.

`NotifyExpiringStock`'s own docblock has always said the expired alert *"Links
to Disposals, which knows the difference between binned and returned-to-
supplier."* The requirement was written down, in the file that raises the alert,
and never implemented. **Third time this month a comment has stood in for the
code** — and a comment is worse than silence here, because it reads as done.

The replacement test does not name four types and pass; it enumerates every type
the app emits and asserts none of them is homeless. The old one could not have
failed for the expiry alerts, because it did not know they existed.

### The panel threw away a link the phone was already using

`NotificationDropdown`'s entire click handler:

```ts
const onItem = (n: AppNotification) => {
  if (!n.read_at) markRead.mutate(n.id);
};
```

`data.link` has always been on the wire, and `shopos-mobile` consumes it. So the
backend contract was real and only the panel ignored it: "Low stock — Panadol is
down to 3" went grey when pressed, and finding the product stayed the owner's
problem.

The resolver refuses two kinds of destination rather than following them:
a screen that does not exist (`announcements/{id}` has no tenant-side route),
and a screen this person may not open (low stock points at Inventory, behind
`inventory.manage` — sending a cashier there means telling them to go somewhere
and having a guard turn them away). Where nothing resolves, the row is not a
link and shows no chevron. Same rule as the field namer: **a wrong destination
is worse than none.**

Two of the six mapped branches — `review.*` and `subscription.*` — have no
producer anywhere. Recorded, not deleted: nothing notifies about a new review
yet, and that is a gap in the product, not dead code.

### The drawer was right and the headline read zero

`deposits_held` summed layaways. `RecordDepositAction` admits a layaway **and a
job card**, refusing only quotations — so a workshop taking Rs 2,000 against a
gearbox job is doing something the API explicitly supports.

The direction of the error is the point. `RecordDepositAction` writes a
`deposit_in` cash movement whatever the kind, so the till reconciled and the
cash was really there — and the one line whose job is to say *"this money in
your drawer is not yours"* read zero. A shop that trusts that line banks a
customer's advance as its own takings.

Widening it carelessly would have broken the neighbour: `balance_outstanding`
was `committed - $held`, and `$held` was layaway-only, so it was accidentally
right. The layaway trio — value, paid, still to collect — is one sentence about
the back room and now computes from layaway deposits explicitly.

### A car in the bay with fifteen days to live

```php
$defaultDays = $isLayaway ? layaway_days : quotation_valid_days;
```

A two-way ternary over three kinds. A job card fell into the else and took the
quotation's window — from a setting the shop is told governs *"how long a quoted
price is honoured"*. Fifteen days after booking in a gearbox rebuild, the job
card printed "Expired on", joined the lapsed-document chase list, and counted
towards `overdue` on the counter's summary.

A job card now gets no default expiry at all. Deliberately not a new
`job_card_days` setting: nobody asked for a job to expire, and the honest default
for a window nobody defined is no window. An explicitly passed `expires_at` is
still honoured — this removes a guess, not a feature.

What it never affected is whether the job could be billed:
`ConvertSaleDocumentAction` only refuses a lapsed *quotation*, so an "expired"
job card always converted. The damage was to what the shop was told.

### Four buckets, one platform, and a comment that swore they added up

```php
// Mutually exclusive buckets (no double counting):
```

They were not. `suspended` is a **status** question sitting among three **date**
questions, and `SuspendTenantAction` only writes `status` — it never clears
`subscription_ends_at`. One suspended shop with a live date counted as both
`active` and `suspended`. Meanwhile every shop with a null end date sat behind
`whereNotNull` and was in no bucket at all.

Two errors in opposite directions, which is what let it survive: they partly
cancel, and the dashboard stayed plausible.

`Tenant::scopePaymentStatus` has had this right the whole time — suspended
answered first and excluded from everything else, a null end date read as "owes
nothing". One question, two implementations in one codebase, one of them
correct. The test no longer asserts 1/1/1; it asserts the buckets sum to the
number of shops, which is the only property that makes a partition mean
anything.

### A ledger that outlived the name on it

`DeleteTenantAction` soft-deletes and promises in as many words that "reports,
invoices and history survive for auditing". They survived anonymously: the
default `belongsTo` carries the soft-delete scope, so the moment a shop closed,
every payment it had ever made rendered with a blank name. The rows were all
there and nothing on them said whose they were — and the one time anybody reads
this ledger is after the shop has gone. `withTrashed()`, plus a panel type that
admits the null it was already being handed.

---

## And one that no screen reader was needed to find

`components/form/switch/Switch.tsx` was a `<label>` with an `onClick` wrapped
round two decorative divs. No `<input>`, no `role`, no `tabIndex`. Not merely
unnamed — **unreachable by keyboard entirely.** Its one real use is the Active
switch on a till register, so a shop working without a mouse could not take a
lane out of service. There was no key sequence that reached the control.

Alongside it: the POS tender selector carried its selection in hue alone (same
border width, same icon, no state on the control — four buttons a reader
announces identically, in front of the step that decides how the sale posts);
five till modals rendered **two** close buttons in the same corner, the shared
named one and a hand-rolled anonymous one; and the dish-modifier sheet was the
one overlay in the till never announced as a dialog.

---

## Method note: the lane that lied, and why it ran again

Yesterday's verification workflow lost 23 of 25 agents to a session limit, and
the script reported all 22 unverified claims as **refuted** — because a dead
agent returns `null` and `!verdict?.real` is true for `null`. Two verdicts where
three were needed, which is the same shape as `HARNESS_NO_TOKEN` faking 96 bugs
the week before.

Re-run with three agents told explicitly to answer CONFIRMED / REFUTED /
**COULD_NOT_CHECK**, and to treat absence of evidence as the third. The result
argues for itself: **eleven confirmed, two refuted, and the two refutations were
mine.**

- *Announcement re-send has no dedupe* — wrong on three layers: a per-recipient
  dedupe key, a `unique(user_id, dedupe_key)` index, a `QueryException` catch for
  the race, and a passing `test_resend_is_idempotent`. **Do not raise again.**
- *There is no workshop job preset* — the label is missing and the consequence
  is not. The whole workshop surface sits behind `sales.manage`, which the
  `cashier` preset carries, and `StaffPresets::for()` offers it to any
  automotive tenant with POS. No "job offered that isn't doable" violation.

Both were plausible, both were mine, and one round of adversarial reading killed
them for the price of not spending a day each. That is the argument for the lane,
and it is why a lane that cannot distinguish "refuted" from "not checked" is
worse than no lane at all.

---

## Gates

```
backend    2140 tests / 9039 assertions
panel      1042 tests / 83 files
browser    Playwright, 4 viewports
a11y       0 of 367 visible controls unnamed  (7 named by their own placeholder)
scanners   unreachable-pages 0 of 27 stuck · --prove passes
```

Every fix mutation-tested: reverting it turns the test red with a message that
names the real defect, not an assertion number.

## Still open

- Nine legacy business codes never driven outside-in.
- `review.*` and `subscription.*` deep-link branches have no producer — a gap in
  the product, not dead code.
- Per-list attribution in `unreachable-pages.py`.
- Nothing notifies tenant STAFF operationally: `notifyTenantOwners` is
  owners-only by construction, so a cashier's bell only ever carries a platform
  announcement. Raised as a design question, not changed — whether a cashier
  should be told about low stock is the shop's call, not this file's.
- The two-week offline shadow run, and deployment/HTTPS.
