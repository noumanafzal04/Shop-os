# One filter bar, one modal shell, one trade profile

`2026-08-08`

Three pieces of drift got collapsed into three shared things. All of it is panel
side; none of it changes an API.

## 1. `FilterTabs` — the one topic bar

Five screens each drew their own row of tabs, and they had drifted apart: two
gap sizes, two padding sizes, two different active colours (`text-brand-500` on
one, `text-brand-600 dark:text-brand-400` on another), and a dark-mode hover on
some but not others.

`src/components/ui/tabs/FilterTabs.tsx` is now the single treatment — a
segmented track with the active topic filled in the tenant's brand colour.
Adopted by Settings, Expenses, Expense Reports, Pharmacy and Warranty.

**The rule worth keeping:** the *underline* style is now reserved for a SECOND
level of tabs inside one topic (Settings → Point of Sale). Two levels of
navigation on one screen must not read as the same control. That reasoning is in
the component's docblock so it survives the next redesign.

## 2. `ModalForm` — and the centring bug underneath it

The reported symptom was the staff form "overlapping" on a laptop screen. The
cause was in the shared `Modal`, not in any page:

```
fixed inset-0 flex items-center justify-center overflow-y-auto
```

`items-center` and `overflow-y-auto` on the SAME element is the classic trap. A
modal taller than the window gets centred, which pushes its top edge above the
scroll container's origin — and nothing scrolls above origin. The head of the
form was unreachable. Centring now happens on an inner `min-h-full` wrapper, so
short content still sits in the middle and tall content scrolls from its true
top. Click-to-dismiss moved onto that wrapper, which now covers the scrim.

That fixed reachability for all 45 modals. On top of it, `ModalForm` (pinned
header / scrolling body / pinned footer at `max-h-[85vh]`) took the 16 forms long
enough to bury their own save button. Two small confirm dialogs were left alone
on purpose: a three-line prompt does not want a bordered header and footer.

## 3. `trade.ts` — the dashboard finally reads its business type

`Capabilities.businessType` had been computed, typed and covered by tests since
the dashboard shipped, and **read by nothing**. Every panel was gated on modules
alone.

Modules answer "does this shop have stock?". They cannot answer "of the four
stock figures, which one does this shopkeeper open the app to check?" — and on
the three trades that pay the bills that distinction is the whole point. A
medical store and a grocery both hold the inventory module, both carry dated
batches, and both got the same sixth tile: Low Stock. But a grocer reorders when
a shelf runs low, while a pharmacist's job is the strip that goes out of date on
the shelf — stock already owned, already paid for, about to become waste. Same
module, opposite question.

`tradeProfile()` carries only the differences that are real; a trade that asks
the same question as everyone else takes the default, because inventing a
vocabulary per trade is how a product ends up with eight words for "sale". The
focus list is a preference chain, not a single choice, so a shop missing the
preferred module still gets a sensible tile instead of a blank.

## Settings, while we were in there

- Two columns, full width, and the till got its own second row of tabs (Counter
  / Lanes & PINs / Quotes & advances / Kitchen) — it was four screens of scroll.
- Every save toasts. Dirty state is tracked by the editing, **not** by comparing
  against the server: the server hands back `5.00` for a `5` you typed, and a
  page that calls that a change never stops saying "unsaved".
- All 48 keys the page writes were confirmed to have a validation rule. Three
  were saved and read by nobody, now wired: `barcode_show_name` and
  `barcode_show_price` seed the label fields (a shop that turned price off still
  printed it), and `pos_default_payment` opens the till on the configured tender
  instead of always cash.

## Addendum — the dashboard's trade DATA

`2026-08-08`, same day. The trade profile above only re-ordered figures the
payload already carried. The figures a trade actually opens the app for were not
in it at all, so `DashboardService` gained two blocks. Both are null for a shop
that is not that trade — absent, never empty, the rule the rest of the payload
already follows.

**`floor`** (dine-in module on). Tables, occupied, open tabs, and the pass split
in two: `kot_waiting` (fired, still cooking) against `kot_ready` (under the lamp,
waiting to be run). The split is the point — food still cooking is under control,
food on the pass is what goes cold, so only the second turns red.

The whole block is the only thing on this dashboard that is NOT a "today"
figure. It is the state of this minute, because that is the only question a
restaurant has at eight in the evening.

Two things checked before writing the query, both of which would have shipped a
500:

- `dining_tables`, `restaurant_tickets` and `kitchen_tickets` carry **no
  `branch_id`**. The floor is not branch-scoped and cannot be; filtering it by
  branch would not narrow the answer, it would throw.
- Occupancy is derived from an open ticket, never from a column on the table —
  matching `DiningTable::isOccupied`, so the dashboard and the floor plan cannot
  disagree about whether table 4 is free.

**`dispensing`** (resolved type `pharmacy`, so legacy `clinic` resolves in).
Today's Rx sales, Rx takings and distinct prescribers, keyed off a non-empty
`prescription_number`. A medical store's day is two businesses sharing a
counter, and the dashboard counted them as one — so the single figure a
pharmacist would be asked to produce existed nowhere in the product. A blank
string is not a script: that is what an untouched form field submits, and
counting it would inflate exactly the number that must not be inflated.

`BusinessTypes::primary()` takes a `string`, and a tenant an admin has not typed
yet has a NULL `business_type`. The null is answered at the call site rather
than by widening a signature every caller relies on. Ten existing tests caught
this — worth remembering that a type gate on the dashboard runs for every tenant
including the half-configured ones.
