# A plan says what it includes; an add-on is on the shop, and on its bill

**2026-10-09 · asked for by the owner**

> "Admin side py jb tenant create kry ya edit, jo modules hain hr business type k
> lehaz sy restrict hony chahye. Jb plan select ho basic to basic level k modules
> create hon jo aam shop ki need ho… extra cheezain separate show hon… Addons
> main extra modules ayen. Plan k andr modules set kr skty? Ya separate khud
> manual assign kryn? Choti shop py bht kam modules ki need hoti — bs product add
> kiye, label bnaye, POS ki."
>
> "Agr kisi ny basic plan lia hai, bad main wo aik addon lena chahta — uska plan
> wohi rahy ga ya custom ban jaye ga? … agr usne addon ly lia, kaise next time
> pta chaly ga is sy extra charges lene?"

## What there was

Twenty-one switches in six groups, the same twenty-one for every trade. A
corner shop was asked about Fuel Management and Dine-in Tables. Plans carried a
price and ceilings and nothing else (the August rebuild, for three good
reasons: every combination needed its own plan; a renewal merged the plan's
modules over the shop's and silently revoked what an admin had granted; a
trade's own modules could not sit on a plan without being stripped from the
trades that need them).

## The answers

**Both — in the order that keeps each honest.**

- **A plan carries a list of modules.** It is a *starting point* and a *label*:
  what a shop is switched on with when it is given the plan, and the line
  between "in the plan" and "an add-on" on every screen afterwards.
- **It is never the gate.** What a shop may use is still `tenants.features`,
  written only by `Tenant::applyModules()`. Nothing reads the plan's list at
  request time and nothing here ever switches a module off — so none of the
  three August defects comes back. Re-thinking what Basic includes does not
  move a single shop already on it.
- **The trade comes first.** `ModulePackages::FOR_TRADE` is what each trade can
  use at all; `ESSENTIAL` is what it cannot open without on any plan. A
  restaurant on Basic still has its kitchen pass; a chemist is never offered
  one.
- **The plan stays the plan.** A shop on Basic that takes an add-on is a shop on
  Basic with one more module. No custom plan is made — not by a person, not
  automatically. A custom plan is for a deal: its own price, its own ceilings.
- **Nobody has to remember to charge for it.** An add-on is not a note somebody
  made. It is *any module the shop has that its plan does not include*, read
  off the shop as it stands (`ModulePackages::bill`). Switch one on and it is on
  the bill; switch it off and it is not.

## The ladder (until an admin ticks otherwise)

| Plan | Includes |
|---|---|
| Basic | Products, Services, POS, Barcode Labels (+ the Inventory labels read from) |
| Standard | + Inventory, Suppliers & Purchases, Stocktake, Quotes & Advances, Customers & Khata, Expenses, Images, Dine-in |
| Pro | + Disposals, Coupons & Promotions, Bank Card Offers, Reservations, Online Store, Delivery |
| Enterprise | everything the trade can use |

Each rung holds all of the one below (a test holds that). A shop gets the part
of its plan's list that its trade can use, plus the trade's essentials.

## What it costs

- **Add-on prices** — rupees a month per module, set at the foot of the Plans
  page (`module_addon_prices` in platform settings). No price = free to add.
- **A shop's own price** — `tenants.addon_prices`, set beside the switch on the
  shop's page. Nought is "thrown in free", and is shown as such with what it
  would have been.
- **A plan paid by the year** pays twelve months of its add-ons.
- With no prices set, nothing anywhere changes: every existing shop's bill is
  its plan's price, as before.

## Where it shows

- **Create a business** — choose the trade and the plan; three bands appear:
  *In {plan}*, *Add-ons* (each with its price), and a folded *Not usual for a
  {trade} shop*. The opening payment suggests plan + add-ons.
- **A shop's page** — the same picker, a price box on each add-on it has, and a
  **What it pays** card beside Actions.
- **Plans** — each card lists what it includes; the dialog is three tabs
  (Plan & price · Limits · Modules) with the modules as grouped checkboxes; a
  tick brings what it depends on.
- **Configuration** — no longer says a plan "grants one or more modules" or
  marks three of them "sellable"; neither had been true since August.

## API

`GET /admin/modules/offer?business_type=&plan_id=` · `GET|PUT /admin/modules/prices`
· `PUT /admin/plans/{id}` takes `modules` (null = back to its rung) ·
`PUT /admin/tenants/{id}/modules` takes `addon_prices` · `TenantResource.package`
(`included`, `addons`, `missing`, `offer`, `bill`) wherever the plan is loaded.

Migration `2026_10_09_000001`: `plans.modules`, `tenants.addon_prices`, both
nullable.

## Held by

`ModulePackagesTest` (62) · `PlanPackagesTest` (7) · `ModulePicker.test.tsx`
(18) · `e2e/admin-plans.spec.ts`. Twelve server mutations, twelve caught after
one survivor was closed.

A real fault the tests found in the first draft: proposing through
`Modules::normalize` PRUNED Labels because Inventory was not on the list —
Basic gave a mart no labels, the one thing Basic exists to give. It goes through
`settle` now, which brings a module's dependencies with it.

## Not done

- The renewal dialog does not yet pre-fill plan + add-ons (the create page
  does). `AssignPlanAction` still defaults a blank amount to the plan's price.
- Add-ons are not pro-rated; one switched on mid-period is on the next bill in
  full.
- The server does not refuse a module outside a trade's list — the journey and
  deliberate cross-trade grants rely on that. The screen folds them away.
