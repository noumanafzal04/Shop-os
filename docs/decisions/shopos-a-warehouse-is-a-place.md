# A warehouse is a place

**2026-10-11 · built at the user's word, with them using the screens as they were made · NOT PUSHED until they say**

A godown was a branch like any other. It cost a branch on the plan, so a
single shop on the smallest plan could not have one. It could open a till it
would never use. An online order could be sent to it for being nearest. A
delivery went into whichever place the person keying it in was looking at.
And a transfer arrived the instant it was sent: thirty cartons went on a van,
twenty-eight came off, and the record said thirty.

The user asked how wholesale and a warehouse are handled, said "real time
dekho … market level", pasted another assistant's answer, and then: *"lazmi ni
humne totally chatgpt ko follow krna lkn suggestion ly skty."* This is what
was taken, and what was not.

## The one decision: a kind, not a table

The pasted design had a `warehouses` table beside `branches`, with
`inventory_locations` and `inventory_balances` over both. **Not done.** Stock
is already kept per place — `branch_stock`, lots, movements, counts,
write-offs and transfers all name a `branch_id`. A second kind of location
would have had every one of them asking which table a place lives in.

So a place has a **kind**: `branches.kind` = `shop` | `warehouse`. Everything
that already knows where stock is keeps knowing it. What differs is one rule.

## A warehouse does not sell at a counter

`Branch::mustSell(?string $branchId)` — one rule, asked by every door that
sells across a counter, about the branch that door arrived at:

| Door | Where |
|---|---|
| opening a shift | `OpenCashSessionAction` |
| a counter sale | `CreateSaleAction` (only when `$atTheCounter`, never for a sale already rung offline) |
| a table, a takeaway tab | `OpenTicketAction`, `DiningTableController@store` |
| a forecourt shift, a tank | `OpenForecourtShiftAction`, `FuelSetupController` |

Where the place is NAMED in a request rather than stood in — a till lane, a
tank, a pump, a branch price — the rule is `App\Rules\SellsAtACounter`.

**Main is always a shop** (model `saving` hook → `MAIN_IS_A_SHOP`): every
write that names no branch lands on the default one, and the one place every
shop is guaranteed to have must not be the one that refuses a sale.

An online order is the exception that is not one: a warehouse that
`fills_orders` ships them, and the sale that closes such an order is written
at the warehouse. `FulfillingBranch::ranked` reads the flag; a shop always
fills, a warehouse only when its owner said so (a clothing brand packs its
online orders at the warehouse; a grocer's godown does not).

In the panel `SellsHere` (a route guard round the till and dine-in) draws a
card instead of a till — "Godown is a warehouse" and the shops to sell at. It
lets the screen through unless it KNOWS, so it can never be what stops a till
working offline.

## Counted on its own allowance

`PlanLimits`: `branches` counts shops only; `warehouses` is its own key
(`plans.max_warehouses`, default 1, needs the `inventory` module). Seeded
1 / 2 / 5 / 20 on Basic / Standard / Pro / Enterprise. A shop with one counter
can have its godown.

## Who may move stock where

A staff member is pinned to one place. `ResolveBranch` holds them to it for
everything that reads a header — but stock is also moved by naming a place in
the BODY. `App\Support\StockPlace` is the one answer:

- the owner, and anyone holding **`inventory.any_place`** ("Move stock at any
  place"; the Manager preset has it, the Stock keeper preset does not), may
  act anywhere;
- everybody else acts at their own place and nowhere else.

Asked by: receiving a delivery into a place, sending, receiving, settling,
calling back, moving, asking. The transfers list returns `can: {send, receive,
settle, cancel}` per row so the panel draws the buttons the server will honour
— a copy of the rule in TypeScript would be a second rule.

## An order says where it is going

Researched, at the user's word ("market level strategy hai search krlo"):
market systems put the destination on the **purchase order**, and there are
two real models — the supplier delivers to each store (direct store delivery),
or to a central warehouse that feeds the stores — and most businesses mix
them. Three shapes, one rule, nothing to configure for the first:

- `purchase_orders.deliver_to_branch_id` — set when the order is raised.
- `Branch::newOrdersGoTo()` — the place marked `takes_deliveries` if there is
  one, else the place the order is raised from, else Main.
- `branches.takes_deliveries` — at most one per business (model `saved` hook,
  like the default branch). Unmarked everywhere = direct delivery.
- Receiving goes **into** the place the receipt names; failing that, the place
  the order was addressed to (while it is still open); failing that, where the
  receiver stands. `PurchaseOrderController@receive`.

Panel: `DeliverTo`, `ReceiveInto`, `AddressedTo` in
`branches/components/ReceiveInto.tsx`. Each shows as chosen what the server
would do if nothing were chosen.

**Opening stock** follows the same idea. It always went on Main; an owner who
chose the godown and carded sixty of something had the sixty land on the shop
shelf. `App\Support\OpeningShelf` puts it where its maker stands — and writes
an explicit nought at Main, because `InventoryService` reads "no row at Main"
as stock that pre-dates per-place rows and seeds Main from the product total.

## A transfer is asked for, sent, received — and settled

| Status | Means | Stock |
|---|---|---|
| `requested` | the place that needs it asked | nothing has moved |
| `in_transit` | sent, not yet counted in | on NO shelf |
| `short` | counted in, less arrived than left | what arrived is on the receiver's shelf; the rest waits |
| `completed` | everything accounted for | |
| `cancelled` | called back, or a request declined | back at the sender / never moved |

`App\Actions\Inventory`: `RequestStockTransferAction`,
`SendStockTransferAction` (`execute` and `fulfil`), `ReceiveStockTransferAction`,
`SettleStockTransferAction`, `CancelStockTransferAction`, and
`TransferStockAction` — the old one-step move, now literally send + receive in
one transaction, so there is one way stock leaves a place and one way it
arrives. `POST /inventory/transfers` with no `mode` still moves at once, which
is what every caller that pre-dates the modes meant.

- **A shortage needs a reason** (missing | damaged), and then a decision from
  the SENDER: `returned` (back on its shelf) or `written_off` (stays gone; the
  transfer keeps the quantity and reason).
- **Stock on the road is on nobody's shelf.** The product's total excludes it;
  Stock by place shows it in its own column.
- **Lots travel as themselves** (`App\Support\TransferLots`). A transfer used
  to pour arriving stock into whichever lot at the destination expired first —
  so a medicine received under batch B-204 arrived under another batch's date,
  or undated. The lots the sender's FEFO gave up are written on the line and
  put down at the other end with the same number, dates and cost.
  `InventoryService::adjust` takes `lots_placed` so it does not also "restore"
  them.
- **A size is sent as that size.** The old form sent `product_id` and a
  quantity; the server, rightly, refused a product sold in sizes
  (`VARIANT_REQUIRED`) — so a clothing shop could not transfer at all.
- **The slip** (`inventory/transfer-slip.blade.php`) travels with the goods:
  both places, each line with a blank to write what arrived, both names, no
  prices.

## A place goes only when nothing live is left in it

Deleting was allowed with stock in it; the rows stayed in every product's
total — on the books, impossible to sell, count or move. Staff assigned to it
fell back to Main without anybody deciding it.

`BranchController@destroy` (and closing, `is_active → false`) refuse while:
stock, an unfinished transfer, an open till, an open table, an unfinished
online order, or assigned staff. **History always stays.**

At the user's word the dialog now ASKS (`GET /branches/{id}/leaving`,
`App\Actions\Branch\EmptyPlaceAction`, panel `DeletePlaceDialog`):

- its stock: **move** to a chosen place (one transfer, lots kept) or
  **discard** (set to nought with a movement that says why);
- its people: where they work from now on.

What somebody has to FINISH — a drawer, a table, a van, an order — is said and
not offered as a choice.

## Seeing it

- `GET /inventory/by-place` (`StockByPlace`, `StockByPlaceController`): one row
  per product, one column per place, sizes on expand, "on the road", and
  `only=refill` = low here and held elsewhere. A fixed number of queries per
  page however many products or places — there is a test that counts them.
- The reorder list carries `held_elsewhere`: "Godown has 40 — bring it" above
  the supplier it would otherwise be ordered from. The link opens the transfer
  filled in; for a keeper who may not take another place's stock the button
  reads **Ask for it**.

## Found on the way

- **Retired products were offered where things are sold.** The till, the
  exchange picker and Take Order read the catalogue's own list, which shows
  everything; the server refused at the sale. (New Sale sieved them out on the
  client after fetching, which left short pages.) All four ask the server now
  — `ProductFilters.for_sale` — and a guard
  (`sellingScreensListWhatSells.test.ts`) holds every caller of `useProducts`
  to having decided which kind of list it is.
- **Two till layout tests had been red since the keys were renamed**
  (`controls-fit.spec`): they looked for a title that no longer exists, and
  demanded a Quote button of a shop with no Quotes module.
- `ProductController@branchStock` asked the database once per branch.

## Not done, and why

- **Selling godown stock at the shop's till.** A sale takes stock from the
  place it is rung at; a bulk order is transferred first. Most systems draw
  the same line.
- **Serial numbers are not tied to a place.** `product_serials.branch_id` is
  written at receipt and read by nothing; a transfer does not move it.
- **Expired lots cannot be transferred** (the expired fence refuses the
  stock-out). Sending them back to a warehouse for supplier return is done
  from the branch itself, through Disposals.
- **No approval step** between asking and sending. The sender's Send is the
  approval.
- **Dates on these screens use the browser's locale**, like the other 130
  places in the panel that call `toLocaleString()`. One shared formatter is
  owed.
- **Wholesale** — the business type, order booking → challan → invoice,
  per-dealer rates — is the next piece of work, not this one.

## Deploy

Two migrations: `2026_10_10_000002_a_warehouse_is_a_place`,
`2026_10_11_000001_an_order_says_where_it_is_going`. Both additive; every
existing place is a shop, every existing transfer is completed and received in
full, every existing order is unaddressed and received where it always was.
The user intends a fresh migrate and seed on live; `PlanSeeder` and
`demo:shops` carry the new columns (mart: a godown; pharmacy: a medicine
store; clothing: a central warehouse that ships online orders and takes the
deliveries).

Sources for the delivery model: Bepoz (multi-location inventory), Odoo
(purchase multi location), Wiser (direct store delivery vs warehousing),
Loyverse (transfer orders), Oracle Store Inventory (transfers), Hyperbots
(stock transfer).

## A warehouse is not compulsory — a second place is the switch (2026-10-11, later)

*"warehouse compulsory hai? branch to compulsory hai — warehouse add-on main
aye ga? kaise manage kia hai — jaise bht sari shop shops main e apna sb manage
krti, mtlb branch main un ka warehouse ni hota"* … *"is edge case ko dekho
market k lehaz sy."*

**The answers, as built:**

- **Compulsory: one thing.** Every business has its Main branch — a shop —
  made with it and never deletable. A warehouse is optional, and a shop
  without one loses nothing: goods arrive at the branch, are kept there and
  are sold there, as before warehouses existed.
- **It is not a module and not an add-on.** It is an allowance on the plan
  (`max_warehouses`: 1 / 2 / 5 / 20 on the seeded ladder; needs Inventory).
  An allowance is "may have", not "has".
- **If it is to be charged for**, both ways already exist: set a plan's
  Warehouses to **0** (the plan form accepts nought), and/or grant a shop an
  extra warehouse as **paid capacity** from its page, the way extra staff or
  branches are — priced, dated, and listed on its bill. Nothing new to build.

**The edge case.** Every plan allows a godown, and the panel drew from the
ALLOWANCE. So a grocer with one counter and no godown was shown *Stock by
place* (a table with one column), *Stock transfers* (to nowhere), a *Branch*
column reading "Main" down every sales list, "where is it" and "branch
prices" buttons on every product row — and asked the server for its list of
branches on every page, to draw nothing with it.

**How the market does it** (looked up, not assumed):

| Product | Single location | When the location screens appear |
|---|---|---|
| Shopify | transfers are described only for "multiple locations" | a second location is added |
| Square for Retail | a transfer needs a source AND a destination location | a second location (and the Plus plan) |
| Zoho Inventory | "Enable Multiwarehouse" is OFF by default | the setting is switched on — which "unlocks" stock per location, transfers, and choosing where goods are received |
| Odoo | "Manage several locations" is OFF by default | the setting is switched on |

One location is the plain experience everywhere; everything about locations
arrives with the second one. Two of the four use a setting. **We use the
fact:** a second open place existing IS the switch — nothing for a
shopkeeper to find and turn on, and nothing to turn off by mistake.

**What was built:**

- `/shop/settings` carries `places: { shops, warehouses }` — the places
  actually OPEN (`ShopController::places`). It rides on settings the panel
  already holds, so the menu needs no second request and no permission.
- `branches/places.ts`: `hasSecondPlace()` / `hasSecondShop()` beside the two
  `mayHaveMore…` questions, which now answer only "may another be ADDED".
- **Menu:** Stock by place and Stock transfers appear with the second place.
  Branches & warehouses stays wherever one may be added (or more than one
  exists), and is on the Simple view only once there is a second place.
- **Lists:** the Sales list's Branch column follows a second SHOP; the
  product rows' "where is it" follows a second place and "branch prices" a
  second shop.
- **Speed:** the header's switcher, the delivery picker, the shelf note, the
  warehouse guard on the till and the branch column all asked for `/branches`
  whenever the plan allowed a second place — on every page of a one-shop
  business. They ask only when there is one. One request fewer per page load
  for the commonest kind of shop.
- A place added, closed or removed refreshes the count at once
  (`useBranchMutations` invalidates the settings too).
- A shop moved to a plan that allows no second place **keeps** the screens for
  the places it already has (`multiBranch` = may add, or already has).

Tests: `AWarehouseIsAPlaceTest` (the count through add, close and delete, and
never another shop's), `places.test`, `shopNav.test` ("the screens about
places arrive with the second place"), `e2e/one-place.spec.ts` (the same shop
told it has one place, then a godown, then the truth — including that it
fetched no branch list), and stage R on a real one-shop business.

Sources: [Shopify — create a transfer between locations](https://help.shopify.com/en/manual/products/inventory/transfer-locations/create-transfer-locations) ·
[Square — transfer stock between locations](https://squareup.com/help/us/en/article/8254) ·
[Zoho Inventory — warehouses overview](https://www.zoho.com/us/inventory/help/warehouses/warehouses-overview.html) ·
[Odoo — inter-warehouse transfers](https://www.odoo.com/documentation/user/13.0/nl/inventory/routes/concepts/inter_warehouse.html)
