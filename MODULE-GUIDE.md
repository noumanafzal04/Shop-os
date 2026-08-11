# ShopOS — how every module works

The operating manual. Screen by screen: what it is for, what each control does,
and where a business type changes the answer.

Companion documents:

- **`BUSINESS-FLOWS.md`** — who gets which screen, and the daily loop per trade
- **`BUSINESS-TYPE-WORKFLOWS.md`** — the developer contract: modules, gating, tests

---

## The three things that decide what you see

Nothing in ShopOS is hidden by accident. A screen appears when **all three**
agree:

| | Decides | Set by |
|---|---|---|
| **Module** | what the shop bought — POS, Inventory, Dine-in, … | Admin, per shop |
| **Trade** | what the shop *is* — food, mart, pharmacy, … | Admin, once, at creation |
| **Person** | what this user may do | The owner, per staff member |

If a screen is missing, one of those three is the reason — in that order. A
pharmacy has no Dine-in because of the **module**. A mart has no Pharmacy
register because of the **trade**. A cashier has no Reports because of the
**person**.

---

# 1. Catalog — Products, Categories, Collections

## What the three are, and why they are not the same thing

| | What it is | How many per product | Who sees it |
|---|---|---|---|
| **Category** | What the thing *is*. Rice. Antibiotics. Brake pads. | **One** | You, and the shopper |
| **Collection** | A group you made up for selling. "Ramadan deals". "New arrivals". | **Many** | The online shop only |
| **Brand** | Who made it | One (free text) | You, and the shopper |

The rule: a **category** is the truth about the product; a **collection** is a
decision about how to sell it. A product lives in exactly one category forever,
and drifts in and out of collections whenever you like.

If you are not selling online, you do not need collections at all.

## Adding a product

**Products → + Add product.** The form is four tabs, and you can save from the
first one — the rest are there when you need them.

### Tab 1 — Details (the only required tab)

| Field | What it is for |
|---|---|
| **Item type** | What kind of thing this is. The list depends on your trade — see below |
| **Name** | What the cashier will search for |
| **Category** | One. Required |
| **SKU** | Your own code. Auto-generated if you leave it |
| **Barcode** | What the scanner reads. A product can have several — see *Codes & packs* |
| **Sale price** | What the customer pays |
| **Cost** | What you paid. **Staff cannot see this** unless they manage stock, purchasing or reports |
| **Wholesale price** | A second price for trade customers. Also cost-protected |
| **Tax rate / Tax group** | Leave blank to use the shop default |
| **Sold by** | Each / weight / volume / length. Changes how the POS asks for quantity |
| **Base unit** | kg, litre, metre, piece |
| **Low-stock alert at** | The alert fires at **exactly** this number, not below it |
| **Opening stock** | Only when creating. Afterwards stock changes through Inventory, never by editing |

### Tab 2 — Media & online
Photos, description, and which **collections** it belongs to. Only appears when
images or the online shop are switched on.

### Tab 3 — Variants & options
- **Variants** — the same product in sizes or colours, each with its own stock
  and barcode. Set at creation.
- **Modifiers** — "extra cheese", "no ice", "large". Restaurant add-ons that
  change the price. Set when editing.

### Tab 4 — Codes & packs
- **Extra barcodes** — the same product from two suppliers with two codes.
- **Pack sizes** — sell the same thing as a piece, a dozen or a carton. Stock is
  held in the base unit; a carton simply removes twelve.
- **Scale PLU** — for a shop with a weighing scale that prints its own labels.

### What changes per trade

| Trade | Item types offered | Extra fields |
|---|---|---|
| **Food** | Food item, Deal | Modifiers, recipe (ingredients) |
| **Mart / Retail** | Product, Combo | Serial / IMEI + warranty months (retail) |
| **Pharmacy** | Medicine, Product | Salt/generic name, strength, dosage form, controlled schedule, **batch + expiry required** |
| **Services** | Service | Duration in minutes. No stock at all |
| **Petroleum** | Fuel, Product, Service | Tank and nozzle linkage |
| **Automotive** | Product, Service | Parts and labour on one invoice |

## Categories

**Products → Categories.** Seeded from your business type the day the shop was
created — a pharmacy starts with medicine categories, a restaurant with menu
sections. They are yours to rename, add to, or delete.

Deleting a category does not delete its products.

## Collections

**Products → Collections.** Only useful with the online shop on. A product can
be in as many as you like; a collection is just a shelf you invented.

## Labels

**Products → Labels.** Prints shelf labels and barcode stickers from the catalog
record — the price on the label is the price in the system, so they cannot
disagree.

---

# 2. POS — the till

Full screen, no sidebar, because a cashier serving a queue should not be one
mis-click from the settings page. **Esc** or the exit button leaves.

## Before you can sell: the shift

The POS will not sell until a **shift is open**.

1. **Which register is this device?** — asked once per device and remembered.
   Two tills in one shop are two registers, and their drawers are counted apart.
2. **Open shift** — you type the **float**, the cash already in the drawer.
3. Sell all day.
4. **Close shift** — you count the drawer and type what is actually there. The
   system compares it against what should be there. The difference is the
   **variance**, and it is recorded whether it is over or short.

An **X-read** counts the drawer mid-shift without closing it.

## The screen

**Left — the product browser.** Search box (**F2**), category tabs underneath.
A barcode scanner types into the search box and adds the item on Enter; a beep
confirms it, and the beep can be muted.

**Right — the cart.** One line per product. Quantity steppers, a price that the
**server** decides (never the browser — this is why a tampered page cannot
change what a customer is charged), and a remove button.

**Bottom — the total and the pay button.**

## The hotkeys

| Key | Does |
|---|---|
| **F2** | Jump to search / scan |
| **F4** | **Hold** — park this ticket and start a new one |
| **F6** | **Drafts** — reopen a parked ticket |
| **F7** | **Quote** — a price given, or an advance taken, without selling yet |
| **F9** | **Pay** |
| **Esc** | Clear search |

## Taking payment

Press **F9**. The payment panel offers:

- **Split tenders** — part cash, part card, part credit. Add as many lines as
  the customer hands you.
- **Cash rounding** — suggests amounts in notes that actually exist.
- **Credit (khata)** — puts the balance on the customer's account. Requires a
  named customer.
- **Trade-in** (automotive) — goods taken in part-exchange. This is a **tender**,
  not a discount: it is money the customer paid you, and it must appear as a
  payment line or the day's takings are wrong.
- **Discount** — up to the ceiling in Shop settings. Going past it needs a
  supervisor's permission.

After the sale: the receipt prints, and the drawer opens if one is attached.

## What the POS adds per trade

| Trade | On the till |
|---|---|
| **Food** | Order type (dine-in / takeaway / delivery), modifiers, KOT to the kitchen |
| **Pharmacy** | Prescription capture (doctor, Rx), batch picked nearest-expiry-first |
| **Retail** | Serial / IMEI capture, warranty recorded against the buyer |
| **Automotive** | Vehicle + odometer on the ticket, trade-in tender |
| **Petroleum** | Nozzle sales, priced at the rate in force at the time |
| **Mart** | Weighed items via the scale, pack sizes |

---

# 3. Dine-in and Kitchen (food only)

**Dine-in** — the floor. Tables, and a tab per table.

1. Guest sits. **Waiter** taps the table → tab opens.
2. Adds items → presses **Fire** → the order lands on the Kitchen board with no
   refresh needed.
3. **Kitchen** marks it ready → the floor updates on its own.
4. **Settle** — the whole bill, split evenly, or split by item/quantity. A
   partial settlement leaves the remainder open.

**Kitchen** — the board on the kitchen wall. Fired orders, oldest first. Mark
ready. That is the entire screen, and the person who works it can see nothing
else — not the till, not the takings.

A tab belongs to the **waiter who opened it**. A cashier can settle anyone's;
another waiter cannot, unless you tick "Serve any table".

---

# 4. Inventory

Off for restaurants (a kitchen depletes by recipe, not by counting) and for
services.

| Screen | What it is for |
|---|---|
| **Inventory** | Current stock, and the reorder list — what has fallen to its alert level |
| **Stock count** | Count a shelf, enter what is really there. The difference posts as a correction with a reason, never a silent overwrite |
| **Transfers** | Move stock between branches. Leaves one, arrives at the other, and both sides are recorded |

**Batches and expiry** (pharmacy, groceries): stock is held in lots with an
expiry date. Selling takes the lot expiring soonest. Medicine batches **must**
have an expiry — the form will not accept one without.

---

# 5. Purchases and Suppliers

| Screen | What it is for |
|---|---|
| **Suppliers** | The vendor directory, and what you owe each one |
| **Purchase orders** | Raise an order → goods arrive → **receive** against it |

Receiving is what raises stock, not raising the order. The cost on the received
line is what the delivery actually cost, so margin is calculated against a real
number.

**Supplier payments** are recorded against the supplier. In the Ledger they are
their own row type — *not* an expense, because a shop that both files the
wholesaler's bill and records the payment would count the same money twice.

---

# 6. Expense Manager — how the money side works

Four screens, one module. This is the whole product for a books-only business,
and a drill-down for everyone else.

## Cashbook — "what did each day come to?"

Money **in** against money **out**, by day, week, month or year.

- Sales are counted **automatically**. You never type a sale here.
- Other income, expenses and refunds come from the rows you file.

One warning printed on the screen and worth repeating: the Cashbook is money
**booked** across all payment types — cash, card, credit. It is **not** the cash
drawer. For physical cash at the counter, use the POS shift close. A shop that
took Rs 50,000 on card has Rs 50,000 in the Cashbook and nothing extra in the
till, and both numbers are right.

## Ledger — "what was each day made of?"

The Cashbook says a day came to Rs 80,000. The Ledger says which rows made it:
every movement, in date order, with a **balance carried down** the page.

Five row types, and each is a genuinely different source of money:

| Type | Direction | What it is |
|---|---|---|
| **Sale** | in | Something sold |
| **Income** | in | Money in that is not a sale — rent received, owner investment |
| **Expense** | out | A bill you paid |
| **Refund** | out | Money handed back |
| **Supplier paid** | out | Paying the wholesaler |

Filter by type, category, payment method, amount range or date. Export what you
filtered — what you hand your accountant is what you were looking at.

## Expenses

**Expenses → + Add expense.** Date, category, amount, how it was paid, and who
it was paid to.

- **Paid to** takes a supplier where you have one, or a plain **payee** name
  where you do not — a landlord is not a supplier, and neither is the electricity
  board.
- **Cash** expenses move the drawer. Everything else does not.
- **Receipt** — attach a photo of the bill. It is **private**: served only to
  someone who could already read the row.

Three more tabs on the same screen:

- **Recurring** — rent, salaries, the internet bill. Posts itself on schedule,
  and a posted row is marked so you can tell it from one you typed.
- **Budgets** — a ceiling per category per month, warning you when you go past.
- **Categories** — your own vocabulary, seeded from your trade.

## Income

The other side. Rent received, owner investment, a supplier refund. **Sales are
not entered here** — they are counted from the sales themselves, and typing them
again would double the month.

Pick the payment method carefully: **cash** income puts money in whatever drawer
is open. Recording a bank transfer as cash gives that cashier a phantom overage.

---

# 7. Day & banking

The 10pm question: what did the shop take today across **every** drawer, and how
much of it went to the bank.

A shift close counts one drawer. This counts the day. Closing the day is a
manager's job; a cashier can see it but not close it.

---

# 8. Reports

Sales by product, category, customer and staff. Profit — takings, plus other
income, minus cost of goods, minus expenses. Behind `reports.view`, which is
deliberately not in the cashier preset.

---

# 9. Customers

Names, phone numbers, and what they owe. **Credit (khata)** is a running balance
per customer: sell on credit, take payment later, and the statement shows every
line.

**Loyalty points** earn on sales and redeem at the till.

**Vehicles** (automotive) sit here, because the number plate is how a workshop
finds a person.

---

# 10. Shop settings

Yours alone unless you deliberately hand out `settings.manage`.

Shop name, logo, address and map location · currency and tax defaults · receipt
and invoice layout, with a live preview · discount ceiling · business hours ·
branches · hardware (printers, drawers, scales) · theme colours.

---

## The one rule behind all of it

**The server decides the money.** The browser never sends a price, a tax figure
or a line total — only which product and how many. Every amount on a receipt was
calculated on the server from the catalog. That is why a discount ceiling cannot
be edited away in a browser, and why a tampered page cannot sell a phone for
Rs 1.
