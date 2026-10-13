# A clothing shop, made by hand and sold from for a morning

2026-10-13. The owner: *"kisi aik business type ko leke … clothing brand bana
ke real time test karna … different user ke roles and permission … POS
proper work … jo data enter hota uska data sab ka theek aa raha … offline
orders, products ki listing, offline scan … tum itni achi tarah se test nahi
kar rahe, cheezain chhor rahe ho UI se"*.

**Zari Clothing** — Retail · Garments, plan Pro, all 21 modules — was created
by the admin form, set up by its owner, and worked through the screens:
8 settings tabs, 9 categories, 8 items (three with sizes or colours, each
size with its own tag and count), a shift, 9 sales across cash, card, split,
khata, wallet, a discount, a held bill, two with no line; four staff hired
one per job and the shop walked as each. Every figure below was added up by
hand first and then read off the screen and off the server.

Tenant `01a13400-93e4-7396-9310-d3c516185859` · owner `sana@zariclothing.test`
/ `Zari-pass-1` · staff `bilal@` (cashier) `usman@` (stock keeper) `farah@`
(accounts) `hina@` (manager) `…@zariclothing.test` / `Staff-pass-1`. Dev DB
only; made through the app.

## Wrong, and fixed

| # | What | Where it was |
|---|---|---|
| 1 | **A size sold at a cost of nothing.** The kurta was carded at Rs 1,600; its sizes have no cost of their own, and the sale line read the size's. Every sized item was pure profit on every report. | `UnitCost` — the sale, the order and the tab now ask the rule the stock report and a write-off already used. `ASizeCostsWhatItsDesignCostsTest` (7) |
| 2 | **Margins counted the tax as profit** where tag prices include it: a suit at 5,490, cost 3,200, "made 2,290 · 41.7%". It made 1,452.54 · 31.2%. Overview and Margins disagreed by the day's tax. | `ReportService::margins` |
| 3 | **Tax report: net sales = gross sales** in the same shops (30,060 and 30,060, with 4,186.73 of tax). | `ReportService::tax`. `ThePriceOnTheTagIncludesTheTaxTest` (8) |
| 4 | **"4 items have run out"** across the dashboard of a shop where one had: every design with sizes counted, because its own stock column is always 0. | `LowStock::soldOut`. `WhatHasRunOutTest` (7) |
| 5 | **A stock keeper could not open the two screens their menu offered** — Purchase orders and Suppliers said "No access", though the server lets the stockroom read an order and receive it. | `purchases/stockroom.ts` |
| 6 | **A cashier was offered Refund, Exchange and Cancel sale** and refused each after choosing a reason ("Return failed", no reason given). The server refused; nothing was lost. | `sales/afterTheSale.ts` |
| 7 | **Subscription drew a 403** (`GET /commission`) for every member of staff who opened it. | asked only for whoever holds Shop settings |

## Wrong, and the owner's to decide

| # | What |
|---|---|
| A | **A design "on sale" with sizes is charged at full price.** Lawn suit: sale price 4,990 on the item; the Products list and the till's tile say "SALE · from Rs 4,990"; choose a colour and the bill is 5,490 (INV-000002 was sold at it). A size's own price always wins. Either the sale reaches the sizes, or no screen may show it and the form may not take it. |
| B | **A cashier and a stock keeper see Today's Profit and Expenses** on the dashboard. Each item's cost is hidden from them on the products list; the profit is the same secret added up. The dashboard asks about modules, never about permissions. |
| C | Sales lines already recorded with no cost (finding 1) stay that way. Filling them from today's cost is a choice about history. |
| D | What is typed under "Whose ticket is it?" when a bill is held becomes the sale's customer name — on the list and on the receipt. |

## Smaller, written down

- Admin › tenant page: "Offline selling — Not granted" with a Grant button,
  beside "offline selling: Allowed · 7 days" in Usage & limits (the plan
  grants it; the card reads only the shop's own override). Payment history
  writes its period as `2026-10-13 → 2026-11-13`.
- Admin › Create a business: Email, Phone, City and Currency share one row.
- Owner's first setup asks for the city the admin already chose.
- Categories: a new sub-category is filed alphabetically, a new top-level one last.
- Item form: "No category" is offered twice.
- Products list: nothing left shows a plain "0"; low shows an amber badge.
- Till: a struck-through price breaks between "Rs" and the figure; the totals
  strip does not mark tax as included; a discount past a cashier's limit is
  refused only at Complete.
- Sale's sheet: a khata sale says "Paid Rs 2,950"; a split sale does not say
  which tenders; channel and tender are raw codes ("pos · split").
- Settings › Receipt preview: rice and cooking oil for every trade, at 17%.

## Right — checked, and it held

The day by hand: 7 sales, Rs 30,060; cash 13,180 + float 5,000 = 18,180 in the
drawer; tax 4,186.73; khata 2,950 on one account; 29 points; stock value at
cost 177,040 and at retail 322,810 over 111 units. The sales list, each
receipt, the dashboard, Day & banking, the customer's page, Inventory and five
Reports tabs said the same — except where the table above says otherwise.

A forbidden screen typed into the address bar goes to the dashboard for every
role; every forbidden write asked of the server directly was refused (403).

With no line: all 8 items on the till, found by name and by tag, sizes with
their counts, the empty size refused, an unknown tag said so; two sales saved
on the device under OFF- numbers; the tab closed; the line back on another
screen — both on the server, the shelf down by exactly what was sold.

## Not done

Returns and exchange by the owner, a khata payment, a purchase order received
(by the stock keeper), expenses and the cashbook, the shift and day closed,
orders by phone and from the storefront, coupons, quotes, stocktake, labels.
