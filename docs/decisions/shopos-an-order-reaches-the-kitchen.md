# An order taken on the phone reaches the kitchen — and is priced by the path that places it

**2026-10-12.** Found by taking one phone order through its whole life in a
restaurant that had just been set up (the owner's ask: *"aik complete flow
bnao … hr flow jo aik QA human flow hai, data entry ki, shop k according"*,
and *"order page ka ui or take order ka ui b acha hony ki zrort hai"*).
Built and tested.

## What was wrong — six things on one road

| | What a restaurant met |
|---|---|
| **"none left"** | On Take order, every dish without sizes read "none left" and could not be pressed. A dish is made to order — nobody counts it, so its stock figure is nought — and the page judged every product by that figure. The server would have said yes. |
| **no size** | A dish in sizes went on the order with none: one button a dish. It was taken at the parent row's price (the Half's) whichever the caller wanted, and the kitchen would have been told "a karahi". |
| **no answer** | A dish with a question that must be answered ("Spice") was refused when the order was sent — on a page with nowhere to answer it. |
| **"Approximately"** | The page added the order up itself. The delivery fee, the order above which delivery is free, a coupon and what an extra costs were not its to know. |
| **the kitchen** | "Start preparing" told nobody. A table's order reaches the pass when fired and a counter order when paid; an order in the Orders queue — phone, WhatsApp or the online shop — reached no screen and no slip. |
| **one press** | "Cancel order" cancelled there and then, with the reason "Cancelled by shop" sent to the customer. |

## What was decided

**The kitchen is told when the order is being prepared.**
`SendAnOrderToTheKitchen`, called from `OrderService::advance()` at whichever
of *preparing / ready / out for delivery* the order reaches first.
- A ticket that never had a table (`from_counter`): off the floor, and it
  closes itself when its last docket is served — exactly as a counter order.
- It carries the **order's number** and the **caller's name** (what the pass
  calls out); the docket says "Delivery" or "Pickup" and what the customer
  asked for ("Delivery — less spicy").
- Tied to its order by `ticket_number = order_number` — no new column, no
  migration. Sent once, however far the order then goes.
- Only what a kitchen cooks: a bottle of water is not sent to the cook, and an
  order of packets sends nothing.
- **Cancelled, it comes off the pass** (`takeBack`); a docket already served
  stays on the record — the same rule a cancelled tab keeps.
- Not when it is *confirmed*: an accepted order is not yet a meal to cook.

**The page asks the server what the order comes to.**
`POST /orders/worth` → `OrderService::worth()` runs `place()` and stops it —
`OrderQuoted` — at the first line the bill is known and before anything is
written. The same shape as `SaleQuoted`
(`shopos-what-the-screen-adds-up.md`). A coupon looked at is not a coupon
spent. The figure can be asked before the caller has given a name; the order
cannot be taken without one. Stock is **not** told by the question — it is
checked when the order is written, as on a sale.

**A dish in sizes is ordered in one — at every door.** `VARIANT_REQUIRED`,
"Chicken Karahi comes in sizes — choose one.", from the question and from
the order. The till and the table already asked.

**The Take-order page** (`panel/src/modules/orders/`):
- `whatIsLeft.ts` — the three questions the server asks about stock: a service
  is never short, an item nobody counts is never short, an item in sizes is
  not judged against its own row. A dish off for today says "off".
- `takeOrder.ts` — a line is the dish, its size and its answers; the same
  again joins the line, another size is another line.
- `components/ChooseHow.tsx` — one sheet: sizes with their prices, each
  question with its limits. "Add to order" stays shut and says what is missing.
- The figure block is the server's: the order, a coupon, delivery (or "Free"),
  and what is collected at the door. Nothing while it is being worked out; the
  server's own words when it will not take the order as it stands.

**Cancelling asks, and takes a reason** — the one the customer is sent. The
"no" says "Keep it": a question whose yes is "Cancel order" cannot have a no
that also says "Cancel" (`components/ui/confirm/words.ts`, for every
confirmation in the panel — "Cancel this tab?" had the same two buttons).

## Later the same day — one press, a slip, two tabs, and a page that holds still

The owner, looking at the screens: *"take order ka process flow kya hai — order
lia, kitchen ticket? send to kitchen? print for kitchen?"*, *"cheezaion bht
zyeda scroll main ja rhi — POS ki screen dekhlo"*, and *"make tab — Today and
Past orders, past orders in table form"*.

**A restaurant's own order goes to the kitchen when it is taken.** It was taken
as *New — waiting to be accepted*, and needed Confirm and then Start preparing
before a cook heard of it: three presses for what a restaurant does in one
breath. `send_to_kitchen` on `POST /orders` →
`OrderService::straightToTheKitchen()`, which walks the order *confirmed →
preparing* through the same `advance()` every other step uses (so the ticket,
the notifications and the trail are the ones a pressed button makes).
- The Take-order page ticks **Send to the kitchen now** by itself where the
  shop has a kitchen. Unticked is for the order wanted later: taken as New, and
  the kitchen is told at Start preparing, as before.
- An order a **customer** places online always arrives as New. The shop accepts
  it before anybody cooks it; nothing here changes that.
- Without the `kitchen` feature the flag does nothing — there is nobody to send
  it to.

**Its slip prints, from the screen that sent it.** The server could put a
ticket on the kitchen's *screen* and never on paper: a browser prints, and no
screen was told which ticket. The answer to taking an order, and to moving one
on, now carries `kitchen_ticket` (`ticket_id`, `ticket_number`, its `kots`)
when that step sent it. `orders/kitchenSlip.ts` prints it by the same
`printKots` a table's order uses, under the same shop switch (`kot_auto_print`)
— and says which of four things happened: nothing was sent, it is on the
screen, it printed, or it did **not** print (said as an error, with the order
still on the kitchen's screen).

**The Orders page is two tabs: Today, and Past orders.**
- **Today** is a *board* of everything still being worked — New · Accepted ·
  Being prepared · Ready/on the way — each card with its lines, who it is for,
  how long it has waited and the one button for its next step. Under it,
  **Finished today**: what was completed or cancelled since the day began.
  An order from an earlier day that nobody has finished is still on the board:
  it is still somebody's to finish.
- **Past orders** is every day before this one, as a *table* — date range,
  completed/cancelled, delivery/pickup, channel, search. On a phone a row is
  two columns (the same cells on a grid — nothing is written twice).
- The number on the Today tab is how many are being worked in the **whole
  shop**, whatever is typed in the search box and whichever tab is open; the
  "no rider" warning is counted the same way. A count on a tab is not a filter
  result.
- **Where today ends is the server's to say**: `when=today|past` on
  `GET /orders`, cut by `ShopDay` — the order taken at one in the morning
  belongs to the evening it was cooked in. `closed_only` is the other half of
  `open_only`. The tab is in the address (`?show=past`).

**The Take-order page is arranged like the till.** The order was first *under*
the menu (every "Show more" pushed it further down), then a tall panel whose
middle scrolled the customer's details away. Now: menu on one side, the order
on the other, and what it comes to — with the one button — in a strip along
the bottom. From `lg` up the page does not scroll: the menu scrolls in its
pane and the lines in theirs. Who it is for is two rows above the lines. The
order pane answers to **its own** width (a container query), not the window's —
beside the menu on a tablet it is half the screen. Below `lg` the order is
under the menu and a bar at the menu's foot leads to it.

## And three things the owner asked for on seeing it

*"pickup and delivery badge on orders page or any identifier?"*, *"when out for
delivery, ask assign rider — optional, but ask always; maybe he has not created
any rider"*, and *"on sidebar orders count? or any highlight dot? blinking dot
like notification"*.

**Delivery or pickup is a badge.** It was two grey words at the foot of a card
and a column only a wide screen drew. `components/HowItReaches.tsx`: a blue
*Delivery* with a van, a purple *Pickup* with a bag — beside the order's number
on the board, in the table at every width, and on the order's sheet.

**"Out for delivery" asks who is carrying it — always, and never insists.**
`orders/whoCarries.ts` + `components/WhoCarriesIt.tsx`. Pressed on a delivery
with nobody on it — from a card, a row or the sheet; they all go through one
`move()` — a sheet lists the shop's riders, the free ones first, each saying
whether they are already out.
- *Send with ⟨name⟩* puts the rider on the order **first** (so the rider and
  the customer are told), then sends it. If the name will not go on, the order
  does not leave.
- *Send without a rider* is always there, and is the main button when the shop
  has made no rider — which is allowed; the sheet says where riders are made.
- Closing the sheet is not an answer. The order stays where it was.
- An order that already has a rider is not asked about again. A pickup never is.
- The server is unchanged: assign-rider and advance are the two calls they were.

**The menu says an order is waiting, from every screen.** A new order arrived
in a list on a screen nobody was looking at; after the bell's one message no
other screen said so. The Orders row now carries how many orders are being
worked (steady), and when one of them is *new* — accepted by nobody — the count
turns the colour of a notification and a ring blinks behind it (never for a
reader who has asked for no motion; folded to icons, a dot).
- `GET /orders/waiting` → `{ new, being_worked }`: **one** aggregate. Not the
  list with a page size of one (four queries for two numbers) — a test counts
  the queries.
- `layout/ordersWaiting.ts` marks that row and no other; asked only by a rail
  that has the row.
- The blink is for the new one only: a board of orders already cooking is not
  an alarm.

**The count is kept, not asked for** (the same night, at the owner's word).
As first built it was asked on every load and every half minute. A browser
run that reloads thirty-five screens a minute was refused by the API's limit
because of it, and when that was reported the owner said the thing itself was
wrong: *"aise to theek nahi, har baar load ho — tab update ho jab order create
ho; invalidate tab, jab order on/off ho"*, and *"jab hum store use kar rahe
hain to aisi cheezain kyun nahi use kar rahe, ke rate limit theek rahe"*.

So the device keeps the last answer (`orders/waitingStore.ts`, a persisted
store, fenced by shop and person) and asks again only on news of an order
(`orders/waitingCount.ts`):

| What happened | How the menu knows | Asked? |
|---|---|---|
| The app is opened again | it shows what was kept | no, inside two minutes |
| This device took, confirmed or cancelled an order | the count lives under the `["orders"]` key those invalidate | once |
| An order was taken on another device, or online | `order.placed` rings the bell of everyone who can work it; the bell is asked anyway, and its newest order news is compared with the last one acted on | once |
| The Orders screen is open | its own list has the same count of the same orders, and tells the menu (`useTellTheMenu`) | no |
| Another device accepted an order and told nobody | nothing rings for that | once, after two minutes with no word |

- News is told apart by WHICH notification is newest, never by a time: the
  server's clock and the device's are two clocks.
- The last row is the one thing still asked on a clock. Without it a second
  counter would blink "1 new" until the app was closed. A quarter as often as
  before, and never on a reload inside the two minutes.
- The Orders screen telling the menu is also what stops the two disagreeing
  on one screen: the board is asked every half minute while it is open.
- Taking an order on this device asks twice — once for the press, once for
  the bell it rang. Known, and left: the second is one request.
- Tests: `waitingCount.test.ts` (13), `useOrdersWaiting.test.tsx` (11, and
  what they count is the requests), and in a browser — the app opened again
  asks nothing; an order taken at another counter reaches the menu by the
  bell, asked once; back on the Orders screen the two agree. Nine faults put
  in on the copy under the unit tests and three under the browser's: all
  caught.
- The two browser runs still make room for themselves under the limit
  (`roomToWork`, `roomForACase`). The walk of every menu entry asks 269
  things in under a minute without this count; it had been passing on where
  the limiter's minute happened to turn.

## Not decided here — the owner's to say

1. **An order is not taxed.** The till charges this shop 5% on a biryani; the
   same biryani ordered by phone or online is charged none, and its sale is
   filed with `tax: 0` (`OrderService::complete()` says so in a comment: "the
   order quoted NO tax, so the sale must not invent one"). Putting it right
   needs a `tax` column on orders and changes what a customer sees at checkout
   in the storefront and the app. **Recommended: tax orders by the same rule
   as the till.**
2. **An order takes no offer.** A promotion ("Lunch lemonade −20%") and a
   member's discount apply at the till and not on an order. A coupon does.
3. **Raw ingredients are offered for sale.** "Basmati Rice — 33 left" is a tile
   on Take order and on the till, because an item is either active or not. The
   "ingredient — not sold" kind proposed on 11 Oct would end it.
4. **"Reservations"** on a restaurant's menu is the online shop's *item holds*,
   not table bookings.
5. "Out for delivery" does not ask who is carrying it.

## Tested

- `AnOrderReachesTheKitchenTest` (7): on the pass under its own number and the
  caller's name, one docket a station; sent once; pickup; only what a kitchen
  cooks; cancelled; a shop with no kitchen; never a tab on the floor. Seven
  mutations, seven caught.
- `WhatAnOrderWillComeToTest` (9): the figure said is the figure carried;
  free above the shop's line and when collected; asking places no order and
  spends no coupon; a size is required, and charged at its own price with its
  extras; an unanswered question is refused in words; a dish off for today;
  asked before the name; nothing the caller sends turns the question into an
  order. Mutations caught.
- `whatIsLeft.test.ts` (6), `takeOrder.test.ts` (7), `words.test.ts` (4).
- `e2e/food.take-order.spec.ts` (restaurant, tablet, phone): the sheet and its
  rules; the page's figure against the server's; taken → confirmed → being
  prepared → on the pass → cancel asked, refused, then given a reason → off
  the pass.

Later the same day:

- `AnOrderReachesTheKitchenTest` (now 11): taken with the kitchen told now it
  is being prepared and on the pass; the answer names the ticket and its
  dockets; a shop with no kitchen is unchanged; moving an order on names the
  ticket that step sent.
- `TheOrderQueueTest` (+3): today's and the past's share nothing and miss
  nothing; **today is the shop's day** — at half past one, ten at night is
  still today, and four in the morning is after *this* shop's day turned
  (the server's own midnight in place of `ShopDay`: caught); what is finished
  can be asked for on its own.
- `kitchenSlip.test.ts` (5), `orderBoard.test.ts` (6).
- `e2e/food.take-order.spec.ts` (now 4 tests × 3 sizes; the two that live an
  order run once): **the page does not scroll** with the whole menu loaded and
  "Show more" pressed, and the name, the total and the button are on the
  screen; taken with the kitchen told now → *Being prepared* on the board, on
  the pass, **its slip handed to the printer**, said in a message; called off →
  off the board, under *Finished today*, and **not** under Past orders; taken
  for later → New → Accepted (kitchen not told) → Start preparing → pass →
  cancel asked, refused, then given a reason. Three faults put in on the copy
  — the kitchen not told, the page left to scroll, the past not cut from
  today — three caught.
- `whoCarries.test.ts` (8), `layout/ordersWaiting.test.ts` (6),
  `TheOrderQueueTest` +3 (the menu's two numbers; nought, and never another
  shop's; **one query** — a second query, and finished orders counted, both
  caught). The spec's fifth test: a delivery wears its badge and says "no
  rider"; the step asks; Escape sends nothing; *Send without a rider* sends it
  with no name; a chosen rider is on the order before it leaves; the next step
  asks nothing. And in the fourth: the count beside Orders is the server's two
  numbers, blinks while one is new, is there on the Dashboard too, and moves
  with Confirm.
