---
name: shopos-money-in-litres-out
description: SHIPPED — a sale line may name `amount` instead of `quantity`; the amount IS the gross, and it is MORE correct offline than litres
metadata:
  type: project
---

2026-09-04. The petroleum gap a station met on every sale: nobody asks for
7.449 litres, they hand over Rs 2,000. Before this the word "litre" appeared
**nowhere** in the panel's POS.

`items[].amount` — an alternative to `quantity`, on `sold_by = weight` items
only (**no migration**: that is already the set where a fraction is legal, and
"Rs 500 ka gosht" is the same interaction). The server divides by its OWN rate,
so it is not a price: a bigger amount buys more, never the same cheaper.

**The amount IS the gross — never recomputed.** 2000 / 268.50 = 7.449 L, and
7.449 × 268.50 = 2000.06. Recomputing makes the tender fail to cover the bill
(the mutation turned 5 tests into 422s), and at 300 sales/day it is Rs 36 of
FICTIONAL drawer variance — on the one screen that measures itself twice on
purpose.

**Why it matters most OFFLINE, which is the counter-intuitive half:**
`CreateSaleAction` re-prices every synced cart *deliberately* (`trusted_offline`
is trust about TIME, never money). A fuel rate changes overnight, so a sale
queued as litres comes back at tomorrow's rate and stops matching the cash in
the drawer. Queued as an amount, the money survives and only the litres move.

**Where the invariant lives — 49 tests decided it.** "Exactly one of
quantity/amount" as `required_without`+`prohibits` in `StoreSaleRequest` broke
every offline sale: `SyncRequest` re-keys that file's rules under
`operations.*.sale.` but NOT the sibling paths named inside them. **A request
validates shape and range; an ACTION owns the rule** — the action is the one
place all three doors pass through.

Also extracted `CreateSaleAction::rateFor()` — the level/tier/branch-override/
pack expression, previously inline once. An amount line must ask it first, and
two copies of a price rule is two prices. Tiers settle in two passes.

Locked across engines by three new `pricing.json` fixture carts, generated on
the server (the file reads the derived quantity back off the sale rather than
computing it — a second implementation would agree with itself forever).

Related: [[shopos-unit11-status]] · [[shopos-petroleum-analysis]] ·
[[shopos-offline-in-a-browser]] · [[shopos-fuel-rate-and-receipt-tray]]
