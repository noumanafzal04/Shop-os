# CartZe Partner

The shop's own app. A third client on the same API — beside the customer
app (`mobile/`) and the web panel (`panel/`).

> **Structure only.** Nothing here runs yet. Every file is a stub carrying
> what will live in it and which decisions are still open. Nothing is
> installed, nothing is built, and no native project has been generated.

## What it is

For a shop that sells ONLY online there is no counter and no panel habit.
This app is the business, so it answers six questions rather than four:

1. Has an order come in?
2. Can I accept it, move it along, and get a slip to the kitchen?
3. Is this item on or off today, and is its price right?
4. Am I open, do I deliver, and how far?
5. **What came in today — and how does that compare with yesterday?**
6. **What did I actually earn, after cost, expenses and the platform's cut?**

Built for shops that took the **online module**. The panel remains the
place for the till, stock, purchasing, staff, the full expense manager and
the filed reports.

## What it is NOT

| Not here | Where it lives |
|---|---|
| POS / till, shifts, drawer | panel |
| Inventory, stocktake, transfers | panel |
| Purchasing, suppliers | panel |
| Budgets, recurring expenses, the ledger, filed reports | panel |
| Dine-in floor, fuel forecourt | panel |
| Staff and permissions admin | panel |
| The rider's job board | `mobile/` — see below |

## Why the rider is not in here

Every rider endpoint on the server sits under `role:customer`, with the
reason written on the route group: *a rider IS a customer who was approved
— one account, two hats*. `RiderService::apply()` and `::claim()` both
start from a customer account, and a shop-minted rider id is claimed in
the customer app.

A rider is a person, not a shop. Moving the job board here would mean
asking riders to install a business app, and rewriting identity rather
than porting a screen. It stays in `mobile/`, where the mode switch
already swaps the whole navigator.

## Phases

| Phase | What | State |
|---|---|---|
| **0** | `packages/core` extraction out of `mobile/`, its 830 tests still green | not started |
| **1** | Shell: sign in, tab bar, **Dashboard + charts**, Account | not started |
| **2** | **Orders** — list, detail, accept, stages, assign a rider | not started |
| **3** | **Menu** — product, sold-out, one photo, categories, collections | not started |
| **4** | **Money** — earnings, sales, commission, expense entry | not started |
| **4b** | Shop settings | not started |
| **5** | Push, and printing a slip | blocked — see `docs/DECISIONS.md` |

## Open decisions

Four, and three of them block a phase. They are written up with their
consequences in [`docs/DECISIONS.md`](docs/DECISIONS.md).
