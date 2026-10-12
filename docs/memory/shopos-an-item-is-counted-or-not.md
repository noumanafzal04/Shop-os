---
name: shopos-an-item-is-counted-or-not
description: FOUND + FIXED 2026-10-12 (on the copy stack, to land) — a new restaurant's FIRST dish was born stock-counted at 0 ("none left" at every table) because the item form sent its own default before /item-types arrived; and the edit form's "Track stock" switch saved nothing (server prohibited it). STANDING: a form default that waits on a request must be "unknown", never the dangerous value
metadata:
  type: project
---

**Found 2026-10-12** by walking a restaurant from an empty shop for the user's
"aik complete flow … hr page hr module hr modal" ask — on the 4th step (H4, an
order at a table). Decision doc: `docs/decisions/shopos-an-item-is-counted-or-not.md`.
Related: [[shopos-absent-field-is-a-branch]], [[shopos-switch-with-nothing-behind-it]],
[[shopos-food-journey-stage-h]].

**The two faults:**
1. `ProductFormPage` had `useState(true)` for track-stock, corrected by an
   effect once `useItemTypes()` answered. A dish created before that (first item
   of a new shop, nothing cached; slow line; `php artisan serve` is ONE thread
   and a second suite was queuing requests) went out as `track_inventory: true,
   stock_quantity: 0`. Proven by delaying `/item-types` 6 s.
2. On EDIT the switch flipped and saved nothing: the form never sent
   `track_inventory`, and `UpdateProductRequest` had it `prohibited`. No screen
   or endpoint could change it.

**The fix:** form state is `trackChoice: boolean | null` (null = nobody said →
NOT sent → `CreateProductAction`'s per-type default stands); edit sends it only
when moved, with `data-testid="counting-change"` saying what it will do before
Save. Server: `ChangeStockTrackingAction` (called by `UpdateProductAction`) —
start on anything a shelf holds; stop refused for a serial-tracked item, an item
with a dated lot still holding stock, or an ingredient of a dish (says how many).
A refusal undoes the WHOLE edit. The stock NUMBER is never touched by the
switch. MY decision (market standard: Shopify / Square / Loyverse let it be
toggled) — the user has not been asked; told in the reply.

**STANDING — a default that depends on a request is "unknown" until it
arrives.** Never initialise to the value that does harm and "fix it in an
effect". **Why:** the effect loses the race exactly when the app is new and
slow. **How to apply:** `T | null` state, derive what to show, send nothing
until chosen or known; make the server's default the safe one.

**Why tests missed it:** stage H2 checked name / price / station of a new dish,
never `track_inventory`; and a robot on a quiet machine never beats the item
types. H2 asserts it now; `e2e/food.first-dish.spec.ts` delays the request.
Also stale that day: H6 / J8 / J9 read the Settle sheet's "Tax (5%)" — it says
"Tax" since the sheet shows the till's own figure ([[shopos-what-the-screen-adds-up]]).

**A food journey cannot be resumed** once stage 21 has seated T2: H3 asserts
both tables are free. After a cut run, start a NEW restaurant
(`JOURNEY_RECORD=<name>` keeps a second record of the same trade — added to
`e2e/journey/kit.ts` that day).
