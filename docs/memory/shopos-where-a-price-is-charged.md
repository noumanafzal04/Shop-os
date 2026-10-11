---
name: shopos-where-a-price-is-charged
description: Add-on price process (user asked 2026-10-10) + the reach line under each price; `plans` empty is NOT "charged to nobody"; price-list Save sends only `changes`
metadata:
  type: project
---

**The user asked (2026-10-10):** "plans main addons ki prices kaise manage hoti? pehle addons ki prices khud set krni? plan price auto calculate hogi? maine product price addon main 25000 rkhi koi impact ni aya."

**The process (answer to give again if asked):**
- A plan's price is TYPED on the plan. Never summed from add-on prices.
- A plan includes a module list at no extra charge.
- An add-on price = monthly price of a module a shop has PAST its plan.
- Shop's bill = plan price + that shop's add-ons. See [[shopos-plan-packages]].

**Built:** `ModulePackages::reach()` → `GET /admin/modules/reach` → `{plans, shops, named}` per module → `admin/addOnReach.ts` → a line under every price on Plans. Three answers: `somewhere` (add-on on these plans · N shops), `never` (in every plan AND no shop has it → charged to nobody), `anyway` (in every plan on offer, yet a named shop has it past its plan → on ITS bill). Amber only when a price is typed where it is odd (`pricedOddly`).

**I got it wrong first, and told the user wrong:** said "Products is in every plan → no impact". `plans` is reckoned over trades a module is USUAL for; a books-only QA business given Products was being billed the Rs 25,000. Found only by reading the endpoint back before pushing (`products: {plans: [], shops: 1}`); the e2e had asserted the false sentence and passed. **Neither figure stands for the other** — check the sentence against a bill, not against its own inputs.

**Price-list save:** `PUT /admin/modules/prices {changes: {key: n|null}}` merges (`ModulePackages::reprice`, row lock, reads the ROW not the 5-min cache). `{prices}` = whole list, REPLACES — kept only for the already-deployed panel (backend deploys first). Panel: `admin/priceChanges.ts`. Before: a screen left open erased prices set since it loaded.

**Not done:** `PlatformSetting` has no audit trait — "who emptied the list, when" could not be answered.

Related: [[shopos-somebody-is-working]], [[shopos-promise-in-another-file]]
