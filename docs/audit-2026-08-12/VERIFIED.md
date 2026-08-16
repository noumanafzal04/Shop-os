# Verified issue list — 2026-08-12

> **Status 2026-08-15:** items 2, 3, 4 and 9 are **FIXED**. What is left is one
> owner chore (1), the two P2 builds (5, 6), two deployment chores (7, 8 — also
> the owner's), and **three new P2s found and FIXED the same day (10, 11, 12)**.

Every line below was read in the source, not grepped for. Findings that did not
survive that reading are in the CLOSED section at the bottom, with the reason —
so the next audit does not spend a second pass on them.

Services **appointment booking is permanently out of scope** (owner's decision,
reconfirmed 2026-08-12). It is not a gap and must never be re-raised.

---

## P0 — live exposure, owner's hands

### 1. The seeded super-admin password is published

`database/seeders/SuperAdminSeeder.php:18` sets `'password' => 'password'`, and
`HANDOVER.md` names the account `admin@shopos.test`. The repo is public and the
staging droplet answers on both the API and the panel. Anyone who reads the repo
can sign in as super admin.

Fix: change the password on staging, then decide repo visibility. Nothing to
build.

---

## P1 — should be fixed

### 2. ✅ FIXED — nothing stopped the next product field from being dropped

`CreateProductAction::execute` names every column by hand
(`CreateProductAction.php:51-102`) while `UpdateProductAction` fills the model
wholesale. A field the request validates but the insert omits vanishes on
create and saves on edit — it looks like it works.

Today the diff is **clean**: all 42 `StoreProductRequest` fields are written
(scalars in the insert, nested ones via the `Sync*` actions, `collection_ids`
via `sync()`, `opening_batch_number`/`expiry_date` into the batch, all six
variant sub-fields). The three that were lost this way — `drug_schedule`,
`tax_group_id`, `kitchen_station` — are already fixed at lines 78-80.

What is missing is the fence. Create-time assertions exist for `drug_schedule`
only (`PharmacyTenantWalkthroughTest:93`); `tax_group_id` and `kitchen_station`
have none anywhere.

**Fixed 2026-08-13** — `tests/Feature/ProductCreateParityTest.php`, 5 tests.
It works in two halves that need each other: one compares the request's own rule
keys against a declared list, so a NEW rule fails the suite until somebody says
where the field lands; the other POSTs a maximal payload and reads every field
back out of the database, so being named in that list is not a promise but an
assertion. Values are picked to differ from the column defaults (`is_active` and
`visible_in_marketplace` default true and are sent false, `sold_by` defaults to
'unit' and is sent 'weight'), or a dropped field would match by accident.

Mutation-checked both ways: deleting `kitchen_station` from the insert fails the
round trip; adding a new rule to the request fails the fence with a message
naming the two things you may do about it.

### 3. ✅ FIXED — a product could not be switched off

`is_active` is the only API field with no control in the product form —
`ProductFormPage.tsx` never mentions it. `ProductsPage.tsx:336` renders an
Active/Inactive badge, so the state is visible, but the row's only action is
Delete.

So a shop that stops stocking an item must either delete it — breaking the link
from its sales history — or re-import a CSV, which is the one place `is_active`
can be set (the import help text names it as a boolean column).

**Fixed 2026-08-13** — a "Still selling this" toggle at the foot of the product
form's Codes & packs tab, deliberately outside the goods-only block above it,
because a service gets discontinued the same as a tin of paint does. Retiring an
item takes it off the till and the storefront while its sales history keeps
pointing at it, which deleting does not.

Help Centre updated in the same pass, including the reason to prefer it over
Delete for anything ever sold.

### 4. ✅ DONE — the security pass

**Run 2026-08-15 — `docs/decisions/security-pass.md`.** Backend and panel, with
the denominator for every surface beside the findings.

Four fixes, in descending order of what they cost a real shop:

1. **Anyone could lock a shop out of its own till.** The failed-attempt lock was
   checked before the password was, and the guard is shared by both login paths
   — so five wrong guesses against a known email took the shop off its POS,
   password and one-time code alike, for fifteen minutes, from anywhere,
   repeatable. The lock now refuses a wrong password and never a right one; an
   attacker still gets five guesses, the owner always gets in.
2. **Changing somebody's password bypassed the escalation guard.** A manager who
   could not tick a permission box could set that person's password and sign in
   as them. Email and phone were the same door. Now: you may only take over an
   account you could have created.
3. **A barcode's own characters reached the markup** in `code128Svg` — not
   reachable today (no caller), escaped anyway, because its sibling is rendered
   through `dangerouslySetInnerHTML`.
4. **`vehicle_id` was not tenant-scoped.** Explicitly NOT an exposure — every
   read goes through the tenant scope — but it let a sale store a pointer that
   resolves to nothing.

Found sound and recorded so nobody audits them twice: route authorization
(185/209 gated, the other 24 role-gated or self-service), the customer surface
(all three controllers re-scope by `customer_id`), route-model binding, raw SQL,
privilege escalation on create AND update, token abilities and refresh rotation,
uploads, receipt privacy, cost-price fencing, password hashes.

Accepted and written down rather than fixed: tokens in `localStorage` (the
ordinary SPA trade-off; moving off it is httpOnly cookies plus CSRF everywhere),
and the unauthenticated banner-click counter.

Not covered: infrastructure (no domain, no TLS yet — nothing to audit) and
dependency CVEs, which want their own pass with its own remediation budget.

---

## P2 — worth doing, not urgent

### 5. ✅ FIXED — automotive had no job card

`job_card` / `jobcard` / `work_order` / `repair_order` return zero hits across
backend, panel and migrations.

What exists covers the ends: `CustomerVehicle` is the car's record, and
`SaleDocument::KIND_QUOTATION` converts to a Sale, which is estimate → invoice.
What is missing is the middle — the car is in the bay, parts and labour are
accumulating, and there is no bill yet. That state is the whole of a workshop's
day and there is nowhere to record it.

**Fixed 2026-08-16.** A third `kind` of `sale_documents`, not a new table: a job
card accumulates priced lines, takes an advance and becomes a sale, which is
exactly what a quotation and a layaway already do through numbering, line
storage, deposits and `ConvertSaleDocumentAction` — the piece nobody should
write twice.

Four columns and one new idea. `work_status` is **not** document status: the
first says whether the paperwork is live, the second says where the CAR is, and
a job can be `ready` and still `open` until somebody pays. The board moves in
one tap on its own route, so a mechanic marking a car ready cannot change its
price, and it moves **backwards** — a job that fails its road test goes back on
the ramp, and software that refuses that teaches a workshop to keep the real
state on the wall.

Three things the tests caught, all real: the **car never reached the invoice**
(the job card knew the registration and the sale it became did not — the whole
feature failing quietly at the last step, since "what was done to this car" is
answered by the sale); **a workshop takes an advance** (deposits were fenced to
layaway, and parts get ordered before work starts); and the `kind` filter was
spelled out as `in:quotation,layaway`, leaving a third kind unfilterable —
capability built, one link missing, for the fourth time here.

`JobCardTest`, 17 tests, 4 mutations caught. Screen at **Workshop** in the
sidebar, automotive only — narrower than Vehicles, because a fuel station keeps
vehicle records but has no bay and a permanently empty board is a menu item
people learn to skip.

### 6. ✅ FIXED — a restaurant's default modules excluded the shelves

`BusinessTypes.php:119` gives `food` the default `'inventory' => false`
("menu items are products WITHOUT stock tracking").

The reach is wider than the sidebar: Suppliers and Purchases live under the
inventory module, and `SyncRecipeItemsAction::tracksStock()` also checks it — so
a default food tenant gets no supplier, no purchase order **and no recipe / food
costing**.

**Fixed 2026-08-16, by the SUB-type rather than the type.**

Flipping `food` to `inventory: true` would have handed Suppliers, Purchase
Orders and Stocktake to every juice corner and home kitchen — three sidebar
entries they will never open. Leaving it off kept restaurants, bakeries and
cloud kitchens unable to cost a menu, and they would never have found out why.

The shop already told us which it is: `business_category` is chosen on the
onboarding screen precisely so a type can be tailored. So `restaurant`,
`fast_food`, `cafe`, `bakery` and `cloud_kitchen` now get the stock chain and
`juice_corner` and `home_kitchen` do not.

**The two mistakes are not symmetrical**, and that decided the borderline cases:
clutter is noticed and ignored, while a missing capability is never discovered —
the shop simply concludes ShopOS cannot cost a menu. So anything that plausibly
buys on a running supplier account gets it. A chai dhaba does keep a milk khata,
which is why `cafe` is on the list.

A sub-type can only ever ADD a module, never take one away: otherwise the type
and the sub-type would argue and the type would lose, which is the wrong way
round since the type is what an admin sees. A tenant with no category recorded
is untouched — nobody gains three modules on a deploy.

7 tests. Four mutations run; **one survived and was a finding about my own
code** — a `$category !== null` guard that could not be killed, because strict
`in_array` already rejects null. Removed: a line that cannot be deleted without
a test failing is dead weight.

### 7. `DEPLOY_SSH_KEY` is still bad

The gate job in `.github/workflows/deploy-backend.yml` passes; the deploy job
cannot authenticate. Owner's chore.

---

## P3 — cosmetic

### 8. The trade gate exists only in the panel

There is no business-type middleware — `app/Http/Middleware/` holds
`EnsureFeature`, `EnsurePermission`, `EnsureRole`, `EnforceSubscription` and the
three resolvers, and nothing else. Pharmacy rides `feature:inventory`, warranty
the same, vehicles `customers.manage`.

This was raised as a security issue and **is not one**. Every model carries the
`BelongsToTenant` global scope, so a mart calling `/pharmacy/dispensing` reads
its own rows; and `StoreProductRequest::withValidator` refuses `item_type:
medicine` to a mart, so those rows do not exist. The register comes back empty.

What it actually costs: a wrong-trade tenant who guesses a URL gets an empty
screen instead of a 403. That is all.

### 9. ✅ FIXED — Settings showed tabs for modules the shop does not have

Found while writing the QA guide. `SETTINGS_TABS` in `ShopSettingsPage.tsx:45`
is a plain const handed straight to `FilterTabs` — nothing filters it. Only the
POS **sub**-tabs filter, on `tenantFeatures[t.needs]` (line 284), which is why
Kitchen correctly hides without dine-in.

So a Finance tenant — no till, no catalog, no stock — is still offered Point of
Sale, Loyalty and Barcodes. The settings save harmlessly and do nothing.

Same shape as the Reports finding, but with the opposite outcome: there the page
gates itself and the sidebar does not need to. Here nothing gated at all.

**Fixed 2026-08-13** — the tab order and the module each one needs moved to
`src/modules/shop/settingsTabs.ts` so they can be tested without mounting the
screen; the page keeps only the icons. "Sells" is the same `pos || marketplace
|| dine_in` test `reportTabs` uses, deliberately, so the two screens cannot
disagree about whether a shop sells anything. A Finance tenant now sees Business
and nothing else. `settingsTabs.test.ts`, 6 tests, including a brute-force pass
over all 16 module combinations; mutation-checked by ungating the POS tab.

---

## Found 2026-08-15 — the buyer side of the web app

Found by a different method than the rest of this list, and the method is worth
keeping: every authenticated backend endpoint was matched against every string
in the panel's source. **252 of 259 endpoint shapes are called. Seven are not**
— three of those are false positives (the staff screens build their path as
`${basePath}/permissions`, which a literal match cannot see).

The remaining four are two real gaps, both the same shape as every other bug in
this codebase: **capability built, one link missing.**

### 10. ✅ FIXED — a buyer retyped their address on every single order

`GET/POST/PUT/DELETE /customer/addresses` is fully built and **nothing in the
panel calls it.** Meanwhile `MarketShopPage` genuinely takes delivery orders on
the web: line 147 sends `delivery_address` as a free-typed string.

So a customer ordering from the same shop every week types their address out
again every week — and a mistyped one is a rider at the wrong gate. The backend
already holds the answer.

### 11. ✅ FIXED — a buyer could not see or cancel a reservation they made

`GET/POST /customer/reservations` and `POST /customer/reservations/{id}/cancel`
are built; nothing in the panel calls them. A buyer can create a reservation and
then has no way to look at it, and no way to cancel it — while the shop-side
screen (`/reservations`, accept/reject/complete) is fully wired.

The asymmetry is the tell: one side of the same feature reached a screen and the
other did not.

**Both are the WEB buyer surface.** Neither touches the till, the shop panel or
the admin panel — the POS itself calls every endpoint it has.

**Fixed 2026-08-15.** `DeliveryAddressField` turns checkout into a pick rather
than a retype: saved addresses listed, the default pre-filled once (only into an
empty box, or a refetch would wipe an address somebody was mid-way through
typing), a "save this for next time" tick, and removal. A signed-out visitor, a
failed fetch and a customer with nothing saved all get the plain box they had
before — losing an address book must never cost anybody an order.

`MyReservations` sits under My Orders and renders **nothing at all** when the
list is empty, which is almost everybody: a menu entry that is blank for nine
people in ten is one nobody reads. Statuses are worded for the person waiting
("Being held for you") rather than for the shop.

Both were caught by the existing `mutationFeedback` test on the first run — the
address field could delete a saved address and say nothing, which reads as a
glitch rather than as something you did. Toasts on both paths now.

### 12. ✅ FIXED — a printer's own paper size was stored and never used

**Asked as a verification, and half of it came back clean.** The tenant's
`receipt_width` setting (A4 / 80mm / 58mm) **does** reach the counter: the real
print (`ReceiptController::show`) renders `invoices.show` with
`$tenant->allSettings()`, and that Blade file reads `$settings['receipt_width']`
at line 16. It is the SAME template the settings preview renders, so the two
cannot drift — that was deliberate and it holds.

What does not reach anything is the **hardware device's** own `paper_size`.
`HardwareDevice` validates it (`58mm | 80mm | a4`), stores it, and the panel
uses it for exactly one thing: the printer's **test page**. No sale receipt has
ever consulted it.

The consequence is narrow but sharp: a shop whose default is A4 (because it
issues A4 invoices) and whose Lane 2 has an 80mm thermal gets a **correct test
print and a wrong receipt.** The setting looks like it works.

There is also an inconsistency next door. A Z-report and a quotation both accept
a `?paper=` override at print time (`PosController`, `SaleDocumentController`)
and honour it — `$paper ?? $settings['receipt_width']`. The sale receipt takes
no such parameter. So the one document a shop prints hundreds of times a day is
the one with no per-printer control.

**Fixed 2026-08-15**, exactly that way: `show()` already resolved the printer for
the print log, so it now also maps its size into the templates' vocabulary
(`58mm|80mm|a4` → `thermal_58|thermal_80|standard` — two names for one thing,
translated in ONE place rather than in three Blade files) and passes it as
`$paper`. The template resolves `$paper ?: $settings['receipt_width']`, the
shape `documents` and `z-report` already used.

Four tests, and the three that matter are the ones that must NOT change: a
printer with no size set, a shop with no printer at all, and an A4 printer under
a thermal default. Mutation-checked ×3, including mapping `a4` wrongly.

## Business-type audit — the MEASURABLE axes, run 2026-08-15

The audit was designed as twelve reading exercises. Four of them are not reading
exercises at all — they are measurements, and measurements can be run in an
afternoon and re-run whenever. Those four are now done, with denominators.

| Axis | Denominator | Result |
|---|---|---|
| **panel** — API surface vs UI | 259 authenticated endpoint shapes | 252 called. 3 of the 7 misses were false (paths built from `${basePath}`), 4 were real → items 10 and 11 |
| **schema** — per-trade fields reaching the form | 44 `StoreProductRequest` scalar fields | **44/44** named in the panel. Backed by the existing `ProductCreateParityTest` fence |
| **drift** — one truth stated twice | 9 backend enums, every value | one real finding, below |
| **gating** — trade vs module vs person | every route's resolved middleware | 185/209 gated; the other 24 role-gated or self-service. Covered again by the security pass |

### 13. ✅ FIXED — the panel's `PaymentMethod` omitted two real tenders

`deposit` and `trade_in` were missing from `src/modules/sales/types.ts` while
both are reachable on the server: an advance settling a layaway, and an
allowance covering a whole bill at a tyre shop.

**Nothing broke**, and the reason is worth keeping: the two screens that render
a method both degrade gracefully — `.replace("_", " ")` and a label lookup with
a default. It was a TRAP rather than a bug. A union that omits a real value
tells the next person writing an exhaustive `switch` that they have covered
everything.

Found by listing every backend enum and asking which values the panel never
mentions anywhere. `trade_in` was the only one in the whole codebase.

### Three leads that did NOT survive checking

Written down because the next audit should not spend a second pass on them, and
because two of the three were bad questions rather than bad code:

| Lead | Why it is closed |
|---|---|
| `serial_number` never exercised | There is no such column. It is `serial` — my guess at the name was wrong, not the coverage |
| `unit_factor` never exercised | `PackBreakingTest` proves the behaviour it drives in 25 assertions (a strip of 10 draws 10 base units, a box of 100 draws 100). Asking "is the column NAMED in a test" is the wrong question — a good test asserts the outcome |
| 0 of 28 trade signature fields covered | A broken measuring stick: the script ran from the panel directory and read an empty test corpus. Same class as the route-middleware miscount above |

**The denominator rule earned its keep three times in one session** — twice on
route middleware and once here. A result that says "nothing is covered" or
"nothing is authenticated" is a broken instrument, not a finding.

### What is genuinely left

The eight TRADE areas (`food`, `pharmacy`, `retail`, `automotive`, `petroleum`,
`finance`, plus `mart` and `services` already done) are judgment, not
measurement: *does a real shop of this type have what it needs?* No script
answers that. The two findings already on this list — the automotive job card
(#5) and `food`'s `inventory: false` default (#6) — came from exactly that kind
of reading, and they are the shape of what remains.

### 14. ✅ FIXED — the pump's most important figure was owed by nobody

**Found by reading the petroleum trade, which is the kind of finding no script
produces.** The forecourt close already computes what matters most at a petrol
pump: `unbilled_litres` — fuel that crossed a meter and was never rung up. The
arithmetic is excellent: per nozzle, meters against till, test litres taken out
of both sides, and deliberately kept apart from tank variance so a theft at the
nozzle cannot be confused with a hole in the ground.

It landed on the SHIFT. An owner read "forty litres unbilled" and could not say
by whom — nothing on a reading named a person, and `opened_by` / `closed_by` are
the manager who ran the shift, not the men who worked the hoses.

At a Pakistani pump the attendant IS the control: each works assigned nozzles
and hands over cash for their litres, and that handover is counted the same
evening or not at all. A station-wide total is a number an owner can worry about
and cannot act on.

**Fixed 2026-08-16.** `attendant_id` on the reading — where the litres are, not
on the shift, because one shift has several nozzles and two men can be short on
the same night for unrelated reasons. The close now reports what each man's
nozzles pushed and what it is worth: the figure a handover is counted against.

**It deliberately does NOT split the unbilled litres, and it cannot.** A till
sale of twenty litres does not record which nozzle it came from, so that gap is
a station figure and stays one — dividing it by attendant would be inventing an
accusation, and a report that does that is one nobody can defend to a man who
says it was not him. There is a test asserting the split is absent.

Unassigned nozzles roll up under nobody rather than vanishing: a shortfall no
one is named for is still a shortfall. Nullable and staying nullable — a one-man
pump has no assignment to make, and no station finds its shifts refusing to open
on a deploy.

5 tests, 3 mutations caught.

---

## CLOSED — verified false or already fixed. Do not re-raise.

| Claim | Why it is closed |
|---|---|
| Services trade needs appointment booking | Owner's decision: out of scope, permanently |
| Create drops `drug_schedule` / `tax_group_id` / `kitchen_station` | Fixed — `CreateProductAction.php:78-80` |
| Finance tenant gets empty/crashing Reports | `reportTabs(features)` gives it exactly one tab (Overview); an `unavailable` fallback also catches a module lost mid-session |
| Product form's nested collections are add-only | All nine are removable: variants, barcodes, combo, recipe, units, price tiers, modifier groups, modifier options, images |
| Backend trade gating is a security hole | Tenant scope + the item-type validator make it unexploitable — see P3 above |
| 9-Aug QA sweep: none of the nine fixed | Stale. All nine were fixed and verified in code on 2026-08-11 |
| Restaurant recipe drives ingredient stock negative | `SyncRecipeItemsAction::tracksStock()` checks the module; no trap |
| `/tenant/portfolio` and `/tenant/labels` are dead links | Both registered — `App.tsx:214,242` |
| Combo/pack cancel+return loses stock | `CancelSaleAction.php:47-83` reverses the movements |
