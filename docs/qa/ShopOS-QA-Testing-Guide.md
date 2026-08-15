# ShopOS — QA Testing Guide

**For:** whoever is testing a ShopOS shop account
**Works for:** any business type — Food, Mart, Pharmacy, Retail, Services, Auto & Tyre, Petroleum, Finance

Read Part 0 and Part 1 once. After that, follow the steps in order. **The order
matters** — most steps need something the step before it created. If you jump to
the till before you have a product, the till will be empty and you will report a
bug that is not one.

**Part 7 (offline) is the same rule at a larger scale:** it needs a shop that has
already been built and sold from, so leave it until last — and read 7.1 before
you touch it.

> **Changed on 2026-08-15 — if you were sent an earlier copy:**
>
> 1. **Part 7 is new: selling with no internet.** Twenty-one tests, O1–O21. Read
>    7.1 FIRST — which of them apply depends on a switch you cannot see from the
>    shop, and getting that wrong costs you an afternoon.
> 2. Reporting moved from Part 7 to **Part 8**.
> 3. The "already known, do not log" list has grown — check it before logging
>    anything from Part 7.
>
> **Changed on 2026-08-13:**
>
> 1. **Settings tabs are now filtered by module.** A missing tab is usually
>    correct. See the box in Part 1 and the map in 1.1.
> 2. **A product can now be retired** — "Still selling this" on the Codes & packs
>    tab. New steps P16–P22.

---

## Part 0 — Before you touch anything

### 0.1 Write down what shop you were given

Everything in ShopOS is decided by three things. Get them on paper first, because
every "this screen is missing" question is answered by one of them.

| | Where to find it | Write it here |
|---|---|---|
| **Business type** | Settings → Business, top of the page | |
| **Modules that are ON** | See 0.2 below | |
| **Your permissions** | Ask the owner, or look at what the sidebar shows you | |

### 0.2 How to read which modules are ON

You cannot switch modules on yourself — only the platform admin can. But you can
**read** them off the sidebar. This is the single most useful minute in the whole
test:

| If the sidebar shows… | …then this module is ON |
|---|---|
| Catalog | `products` or `services` |
| Inventory (Stock, Stocktake, Suppliers, Purchases, Labels) | `inventory` |
| POS button (top bar / full screen till) | `pos` |
| Dine-in, Kitchen | `dine_in` |
| Collections, Reviews | `marketplace` |
| Reservations | `reservations` |
| Expenses | `expenses` |
| Forecourt / Fuel | `fuel` |

### 0.3 The one rule that explains every missing screen

A screen has to pass **three gates** before you see it:

```
MODULE  →  does the shop have this feature turned on?
TRADE   →  does this business type use this screen at all?
PERSON  →  does your login have the permission?
```

**A screen you cannot see is not automatically a bug.** Before you write it up,
check all three. Only report it if all three should have passed.

Four screens are gated on **trade** and will never show for the wrong business
type — this is correct behaviour, not a bug:

| Screen | Only shows for |
|---|---|
| Pharmacy (dispensing register, recall) | Pharmacy |
| Vehicles | Auto & Tyre, Petroleum |
| Warranty lookup | Trades that sell serialised goods (phones, electronics, batteries) |
| Portfolio | Services |

### 0.4 What each business type starts with

Use this to know what you *should* be seeing. If your shop differs, the admin
changed it on purpose — not a bug, but note it.

| Business type | products | services | inventory | marketplace | delivery | dine-in | POS | expenses |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Food & Restaurant** | ✅ | — | **❌** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Mart / Grocery** | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **Pharmacy** | ✅ | — | ✅ | ❌ | ✅ | — | ✅ | ✅ |
| **Retail** | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **Services** | ❌ | ✅ | ❌ | ❌ | ❌ | — | ✅ | ✅ |
| **Auto & Tyre** | ✅ | ✅ | ✅ | ❌ | ❌ | — | ✅ | ✅ |
| **Petroleum** | ✅ | ✅ | ✅ | ❌ | ❌ | — | ✅ | ✅ + fuel |
| **Finance (books only)** | ❌ | ❌ | ❌ | ❌ | ❌ | — | **❌** | ✅ |

**Two rows to pay attention to:**

- **Food starts with inventory OFF.** That is deliberate — a menu item is not
  counted on a shelf. It also means a restaurant starts with **no Suppliers, no
  Purchases and no recipe/food-costing**. If your test plan needs those, ask the
  admin to switch `inventory` on.
- **Finance has no till and no catalog.** It is the expense/income book only.
  Skip Parts 3–5 entirely for a Finance shop.

---

## Part 1 — Settings first, and which module each one belongs to

**Do Settings before anything else.** Half the behaviour you are about to test is
decided here, and a setting changed halfway through a test invalidates everything
you did before it.

Go to **Settings** (bottom of the sidebar). There are up to seven tabs.

> ✅ **You are only shown the tabs your shop can use.** A Finance shop (no till,
> no catalog) sees **only Business**. A shop that sells online but has no counter
> keeps Tax, Loyalty and Receipt but loses Point of Sale and Hardware.
>
> So a **missing** settings tab is usually correct — check the table below before
> logging it. What IS a bug: a tab you *should* have that is missing, or a tab
> that is shown when the table says it should not be.

### 1.1 The settings map

**"Needs module" now decides whether the tab appears at all.** Where it says
"sells", any one of `pos`, `marketplace` or `dine_in` is enough.

| Tab | Sub-tab | Needs module | What it controls | Where you will SEE the effect |
|---|---|---|---|---|
| **Business** | — | none — always shown | Shop name, contact, logo, location pin | Invoice header, storefront, "shops near me" |
| **Business** | Online shop | `marketplace` | Storefront on/off | Public shop page |
| **Tax & Delivery** | Tax | **sells** | Default tax %, tax-inclusive on/off | Every sale line that has no rate of its own |
| **Tax & Delivery** | Fulfillment | **sells** + `delivery` | Pickup/delivery on, radius, min order, free-delivery threshold, prep time | Online checkout options |
| **Point of Sale** | Counter | `pos` | Default payment, auto-print, drawer kick, idle lock, **require open shift**, denomination count, blind close, declare tenders, cash rounding, discount limits, tips | The till, and the shift open/close screens |
| **Point of Sale** | Lanes & PINs | `pos` | Registers (checkout lanes), till PINs, signed-in devices | Which lane a sale belongs to; who a sale is credited to |
| **Point of Sale** | Quotes & advances | `pos` | Quotations on/off + validity + terms, layaway on/off + deposit % + days + cancellation fee, stock-age warnings | Sales → Documents screen |
| **Point of Sale** | Kitchen | `dine_in` | Kitchen stations list, KOT auto-print | Which station a dish is routed to |
| **Loyalty** | — | **sells** | Points on/off, earn rate, redeem value, minimum redeem | Till → redeem points; customer statement |
| **Receipt** | — | **sells** | Header line, footer, show logo, receipt width (standard / 80mm / 58mm), show cashier | Printed receipt / invoice |
| **Receipt** | Tax identifiers | **sells** | NTN, STRN, FBR POS ID | Printed receipt (blank = nothing prints) |
| **Hardware** | — | `pos` | Receipt printer, label printer, scanner, cash drawer | Printing and scanning |
| **Barcodes** | — | `products` | Show price / show name on label; scale barcodes (prefix, weight-or-price mode) | Barcode Labels screen; scanning a weighed item at the till |

### 1.2 Settings walkthrough — do these in this order

Each line is: **do it → expect this → if not, log it.**

| # | Do | Expect |
|---|---|---|
| S1 | Settings → Business. Fill shop name, phone, address. Save. | Toast confirms saved. Reload the page — values persist. |
| S2 | Settings → Business → Location. Search your city, drop the pin. Save. | City fills in automatically. *(If you see "Map search is not set up on this installation", the map key is missing on this server — that is a known deployment gap, not a bug.)* |
| S3 | Settings → Receipt. Set a header line and a footer. Save. | The live preview on the same screen updates as you type. |
| S4 | Settings → Receipt → width. Try each of standard / 80mm / 58mm. | Preview changes width each time. |
| S5 | Settings → Tax & Delivery. Set default tax to 5%. Save. | Note it — you will verify this on a sale in Part 3. |
| S6 | Settings → Point of Sale → Counter. Set **max discount %** to 10. Save. | Note it — you will try to beat this limit in Part 3. |
| S7 | Settings → Point of Sale → Counter. Leave **Require open shift** OFF for now. | You will turn it ON in Part 3 and re-test. |
| S8 | Settings → Point of Sale → Lanes & PINs. Add one register called "Counter 1". | It appears in the list. |
| S9 | *(Restaurant only)* Settings → Point of Sale → Kitchen. Add stations: `Kitchen`, `Bar`. Save. | Both appear. You will route a dish to each in Part 5. |
| S10 | *(If inventory ON)* Settings → Barcodes. Turn price + name on. | Note it — verify on a printed label in Part 2. |
| S11 | Settings → Loyalty. Turn points ON. Earn = 1 per Rs 100. Redeem value = Rs 1. Min redeem = 100. | Note it — verify at the till in Part 4. |
| S12 | Count the tabs you were given and check them against the map in 1.1. | Every tab you have, your shop's modules feed. Every tab you lack, they do not. A Finance shop must see **only Business**. |

**Cross-check to run now:** open a settings tab, change one field, then switch to
a different tab **without saving**, then come back.

> Expect: your unsaved change is still there and the page still says unsaved.
> All the preference tabs share one save bar on purpose — saving from any tab
> saves all of them. This is intended; confirm it works.

---

## Part 2 — Build the shop up, in dependency order

You cannot sell what does not exist. Follow this chain. Each row needs the row
above it.

```
Category  →  Product  →  Supplier  →  Purchase Order  →  Receive  →  Stock on hand
```

### 2.1 Categories *(needs: products or services)*

| # | Do | Expect |
|---|---|---|
| C1 | Catalog → Categories. Some are already there. | Your business type seeded them (a restaurant gets Starters/Main Course/Beverages; a mart gets its own). |
| C2 | Add a category "QA Test Category". | Appears in the list. |
| C3 | Hide it (the Hide button), then Show it again. | Name goes grey + struck through when hidden, back to normal when shown. |

### 2.2 Products *(needs: products or services)*

This is the biggest form in the system. Test it properly.

| # | Do | Expect |
|---|---|---|
| P1 | Catalog → Products → Add. Pick an **Item type**. | The list of item types you are offered depends on your business type. A mart cannot pick Medicine. A restaurant gets Food item. This is correct. |
| P2 | Fill name + price only. Save. | Saves. Appears in the list with an **Active** badge. |
| P3 | Open it again (edit). | **Every field you typed is still there.** ⚠️ This is the highest-value check in the whole document — see the box below. |
| P4 | Set a **cost** lower than the price. Save. | Saves cleanly. |
| P5 | Set a **cost HIGHER than the price**. Save. | Saves, **but shows a warning**: "Selling price is below cost". It must not block you — clearance sales are real. |
| P6 | Add a **SKU** that another product already uses. Save. | Rejected: "This SKU is already used by another item." |
| P7 | Same for **barcode**. | Same kind of rejection. |
| P8 | Add 2 **variants** (e.g. Small / Large) with different prices. Save, reopen. | Both there, both prices correct. |
| P9 | Delete one variant. Save, reopen. | It is gone and stays gone. |
| P10 | Add **extra barcodes**, then remove one. Save, reopen. | Removal sticks. |
| P11 | *(inventory ON)* Add **pack sizes** (e.g. Box = 12). Save, reopen. | Sticks. |
| P12 | Add **price tiers**: 1 → Rs 100, 10 → Rs 90. Save. | Saves. |
| P13 | Now make a **higher quantity cost more**: 1 → Rs 90, 10 → Rs 100. Save. | **Rejected**: a higher-quantity tier cannot cost more per unit. |
| P14 | Give two tiers the **same minimum quantity**. Save. | Rejected as ambiguous. |
| P15 | Set an **availability window** — fill only the start time, leave the end blank. Save. | Rejected: set both ends or neither. |

> ### ⚠️ P3 is the check that matters most
>
> There is a known bug shape in this system: a field is accepted by the form,
> looks saved, but is **never written on create** — and then saves correctly the
> *second* time you press save. It looks like it works.
>
> So for **every** field you fill: **save → close → reopen → confirm.** Never
> trust the screen right after saving.
>
> Fields to be extra careful with: **tax group**, **kitchen station**, **drug
> schedule**, and anything trade-specific.

### 2.2b Retiring a product without deleting it

| # | Do | Expect |
|---|---|---|
| P16 | Open a product → **Codes & packs** tab → bottom. | A toggle: **"Still selling this"**, on by default. |
| P17 | Turn it OFF. Save. | Product list badge changes to **Inactive**. |
| P18 | Search that product at the till. | **Not found** — an inactive item cannot be sold. |
| P19 | *(If you sell online)* Check the storefront. | Gone from there too. |
| P20 | Open a past sale that included it. | The sale is **intact** — the item is still named on it. This is the whole point of retiring instead of deleting. |
| P21 | Turn the toggle back ON. Save. | Back to Active, and sellable again at the till. |
| P22 | Create a **new** product and turn the toggle off before the first save. | Saves as Inactive straight away — useful for preparing next season's catalog. |

### 2.3 CSV import/export *(needs: products)*

| # | Do | Expect |
|---|---|---|
| I1 | Products → Export CSV. | File downloads with readable Title Case headers (Name, Item Type, SKU…). |
| I2 | Open it, add one new row, import it back. | New product created. |
| I3 | Change the price on an **existing** row (same SKU) and import. | That product is **updated**, not duplicated. Rows match by SKU. |
| I4 | Import a row with no price. | Rejected with a clear message naming the row. |

### 2.4 Suppliers *(needs: inventory)*

> Not visible for **Food** or **Services** by default — inventory is off. Not a bug.

| # | Do | Expect |
|---|---|---|
| SU1 | Inventory → Suppliers → Add. Name + phone. Save. | Appears in the list. |
| SU2 | Open the supplier. | Shows the balance you owe (Rs 0 so far). |

### 2.5 Purchase order and receiving *(needs: inventory)*

This is where stock actually enters the shop. **Do not adjust stock by hand
first** — receive it properly, so you can test the whole chain.

| # | Do | Expect |
|---|---|---|
| PO1 | Inventory → Purchases → New. Pick the supplier. Add your product, qty 100, cost Rs 50. Save. | Order created, status Draft/Pending. |
| PO2 | Check Inventory → Stock for that product. | **Still 0.** An unreceived order does not add stock. |
| PO3 | Receive the order (full receipt). | Status changes to Received. |
| PO4 | Check Inventory → Stock again. | **Now 100.** |
| PO5 | Check the supplier's balance. | Now shows Rs 5,000 owed. |
| PO6 | Pay the supplier (record a payment). | Balance drops. **And** the payment shows in the cashbook as money out — check Expenses → Cashbook. |
| PO7 | *(Multi-branch shops only)* Switch to a non-Main branch and receive an order there. | Stock lands on **that branch**, not Main. |

### 2.6 Stock adjustments and stocktake *(needs: inventory)*

| # | Do | Expect |
|---|---|---|
| ST1 | Inventory → Stock → adjust one product down by 5, with a reason. | Quantity drops. A movement is recorded with your name and reason. |
| ST2 | Inventory → Stock → movements. | Your adjustment is listed, plus the PO receipt from PO3. |
| ST3 | Set a **reorder level** on a product, then adjust stock below it. | Product appears in the low-stock / reorder list. |
| ST4 | Dashboard. | The low-stock count reflects it. Clicking through opens the reorder list already filtered. |
| ST5 | Inventory → Stocktake. Start a count, enter a different number, commit. | Stock corrects to your counted number; the difference is recorded. |
| ST6 | Inventory → Barcode Labels. Print a label. | Price and name appear or not, matching what you set in step S10. |

---

## Part 3 — Selling *(needs: pos)*

> Skip this entire part for a **Finance** shop.

### 3.1 Opening the till

| # | Do | Expect |
|---|---|---|
| T1 | Open the POS. | Full screen — no sidebar. That is intentional. |
| T2 | Open a **shift** with a starting cash float (e.g. Rs 5,000). | Shift opens. If denomination counting is on, you must break the float into notes. |
| T3 | Search a product by name. | Found. |
| T4 | Search by **part of the description** or by **category name**. | Also found — search covers more than the name. |
| T5 | Scan / type a barcode. | Product is added to the cart directly. |
| T6 | Try an **extra barcode** you added in P10. | Same product is found. |

### 3.2 A plain cash sale

| # | Do | Expect |
|---|---|---|
| T7 | Add 1 item. Check the tax line. | Tax = 5% (from step S5), unless the product carries its own rate. |
| T8 | Take cash, tender more than the total. | Change is calculated correctly. |
| T9 | Complete the sale. | Receipt shows. Header/footer match S3. Cashier name appears if you enabled it. |
| T10 | Check stock for that product. | Down by 1. |
| T11 | Try to complete a sale where the tender is **less** than the total. | **Blocked.** Underpayment must be refused. |

### 3.3 Discounts — test the limit you set

| # | Do | Expect |
|---|---|---|
| T12 | Apply a 5% discount. | Accepted (limit is 10%). |
| T13 | Apply a **15%** discount. | **Blocked** — over the limit from step S6. |

### 3.4 Split payment

| # | Do | Expect |
|---|---|---|
| T14 | Total Rs 1,000. Pay Rs 600 cash + Rs 400 card. | Accepted. |
| T15 | Look at the shift's expected cash. | Only the **Rs 600** counts toward cash. The card part must not. |

### 3.5 Sell on credit (khata)

| # | Do | Expect |
|---|---|---|
| T16 | Attach a customer, then sell on credit. | Sale completes with nothing in the drawer. |
| T17 | Open that customer. | Balance owed = the sale amount. |
| T18 | Record a payment against it. | Balance drops; the payment shows in the cashbook. |
| T19 | Try selling on credit with **no customer attached**. | Blocked — a khata needs a name. |

### 3.6 The shift gate — turn it on now

| # | Do | Expect |
|---|---|---|
| T20 | Close your shift. Count the drawer. | Shift closes. If blind close is on, you must count **before** seeing the expected figure. |
| T21 | Compare counted vs expected. | Over/short is shown and recorded. |
| T22 | Now go to Settings → POS → Counter and turn **Require open shift ON**. |  |
| T23 | Go back to the till with **no shift open** and try to sell. | **Refused**: "Open a shift before ringing up a sale." |
| T24 | Open a shift, sell again. | Works. |
| T25 | Turn the setting back OFF and sell with no shift. | Allowed again. |

### 3.7 X and Z reads

| # | Do | Expect |
|---|---|---|
| T26 | Run an **X read** mid-shift. | Shows takings so far; the shift stays open. |
| T27 | Run a **Z read** at close. | Shows the final figures; the shift is closed. |
| T28 | Compare with the sales you actually made. | They match, and card money is separated from cash. |

---

## Part 4 — After the sale

### 4.1 Returns and cancellation

| # | Do | Expect |
|---|---|---|
| R1 | Find a completed sale. Return 1 item. | Money goes back out; **stock comes back in**. |
| R2 | Check the product's stock. | Increased by exactly 1 — not 0, not 2. |
| R3 | Cancel a whole sale. | Everything reverses: stock, money, customer balance. |
| R4 | *(If you sold a deal/combo)* Cancel it. | Stock returns for **every component**, at the right quantity. |
| R5 | Try a return as a user without refund permission. | Refused. |

### 4.2 Loyalty *(if enabled in S11)*

| # | Do | Expect |
|---|---|---|
| L1 | Sell Rs 1,000 to a customer. | They earn 10 points. |
| L2 | Try redeeming with fewer than 100 points. | Blocked — below the minimum. |
| L3 | Build up 100+ points, then redeem. | Discount applied at the correct rate. |
| L4 | Return that sale. | The points earned on it are **reversed**. |
| L5 | Open the customer statement. | Earn, redeem and reversal all listed. |

### 4.3 Expenses and income *(needs: expenses — every shop has this)*

| # | Do | Expect |
|---|---|---|
| E1 | Expenses → add an expense with a category. | Saved. |
| E2 | Add an **income** entry. | Saved. |
| E3 | Open the cashbook. | Both appear. Money in and money out are separate columns. |
| E4 | Check profit / the reports Overview. | Income is **included** — not just sales minus expenses. |
| E5 | Set a **budget** on a category, then exceed it. | You are warned. |
| E6 | Create a **recurring** expense (e.g. monthly rent). | Repeats as configured. |
| E7 | Attach a **receipt image** to an expense. | Uploads and opens again. |

### 4.4 Reports

| # | Do | Expect |
|---|---|---|
| RP1 | Open Reports. | **Only tabs your shop can fill are shown.** A Finance shop sees just Overview. A shop with no stock module sees no Stock value / Dead stock / Purchases. **This is correct — do not log it.** |
| RP2 | Overview for today. | Matches the sales you made. |
| RP3 | Margins. | Uses the cost you set in P4. |
| RP4 | Staff report. | Credits sales to whoever was signed in at the till. |
| RP5 | Tax report. | Matches the 5% from S5. |
| RP6 | *(inventory ON)* Stock value + Dead stock. | Valuation matches cost × quantity. |
| RP7 | Change the date range to a custom range with the **end before the start**. | Refused before it sends — the figures on screen must never answer a question you did not ask. |
| RP8 | Export any report that offers CSV. | Downloads and opens. |

---

## Part 5 — Trade-specific tests

**Only run the section that matches your business type.**

### 5.1 Restaurant / Food *(needs: dine_in)*

| # | Do | Expect |
|---|---|---|
| F1 | Dine-in → create a Floor, then Tables on it. | Both saved. |
| F2 | Open a table → start a tab. | Table shows as occupied. |
| F3 | Add items and fire to kitchen. | A KOT is produced. |
| F4 | *(If you set stations in S9)* Put one dish on `Kitchen` and one on `Bar`. Fire. | **Two separate tickets**, each to its own station. The bar must not get the biryani. |
| F5 | Kitchen screen. | Both tickets appear, each at the right station. Mark one ready. |
| F6 | Back at the table, settle the bill. | Sale completes, table frees up. |
| F7 | **Split the bill** across 2 people. | Splits correctly and adds up to the total. |
| F8 | Waiter A opens a tab. Log in as waiter B and try to open it. | Refused — a tab belongs to its waiter. |
| F9 | Now **hand the table over** from A to B. | B can now work it. |
| F10 | Reads (just viewing) as waiter B. | Allowed — reads stay open even when writes do not. |
| F11 | *(inventory ON)* Give a dish a **recipe** (Bun ×2, Patty ×1). Sell it. | Each ingredient's stock drops by the recipe amount. |
| F12 | Cancel that sale. | Ingredient stock comes back. |

### 5.2 Pharmacy

| # | Do | Expect |
|---|---|---|
| PH1 | Create a **Medicine** with opening stock. | An expiry date is **required** — you cannot save without it. |
| PH2 | Check Inventory → Batches. | A batch exists from day one, dated. |
| PH3 | Add a second batch with an **earlier** expiry. Sell the item. | The **earlier-expiring** batch is used first (FEFO). |
| PH4 | Try to sell from a batch that has already expired. | Blocked. |
| PH5 | Write off an expired batch. | Stock reduces; the write-off is recorded. |
| PH6 | Set a **drug schedule** (G / H / X) on a medicine. Save, **reopen**. | The schedule is still there. |
| PH7 | Sell that scheduled drug. | The till demands prescriber details before it will complete. |
| PH8 | Capture a prescription against a sale. | Saved and visible on the sale. |
| PH9 | Pharmacy → Dispensing register. | Your scheduled sale is listed. |
| PH10 | Pharmacy → Recall. Enter a batch number. | Lists who bought from that lot. |
| PH11 | Pharmacy → Alternatives. Search a salt. | Shows other products with the same salt that are in stock. |
| PH12 | Dashboard. | Near-expiry count is shown. Click through. |

### 5.3 Mart / Grocery

| # | Do | Expect |
|---|---|---|
| M1 | Create a product sold **by weight**. | Accepted. |
| M2 | *(If scale barcodes on)* Scan a scale label. | The correct weight or price is read out of the barcode. |
| M3 | Set up **pack breaking** (Box = 12). Sell 1 box. | Stock drops by 12 base units, not 1. |
| M4 | Create a **deal / combo** of 3 items. Sell it. | All 3 components come off stock. |
| M5 | Set up a **BOGO** promotion. Ring it at the till. | Discount applies automatically. |
| M6 | Create a **coupon**. Apply it. | Applies. Apply it twice → refused if single-use. |
| M7 | Create a **customer group** with its own pricing. | The right price is charged for a customer in that group. |

### 5.4 Retail / Electronics

| # | Do | Expect |
|---|---|---|
| RT1 | Create a product with **serial tracking** on and a warranty length. | Saved. |
| RT2 | Sell it. | The till makes you pick/enter a serial or IMEI. |
| RT3 | Warranty lookup → enter that serial. | Shows what was sold, to whom, and whether it is still in warranty. |
| RT4 | Raise a **warranty claim**. | Recorded. **No money and no stock moves** — a claim is not a return. |
| RT5 | Resolve the claim. | Status updates. |
| RT6 | Create a **quotation**, then convert it to a sale. | Converts at the quoted price. |
| RT7 | Create a **layaway** with a deposit. | Deposit taken; balance tracked; stock held. |
| RT8 | Cancel the layaway. | Cancellation fee applied as configured in S-Quotes. |

### 5.5 Auto & Tyre

| # | Do | Expect |
|---|---|---|
| A1 | Register a **vehicle** with a plate. | Saved. |
| A2 | Link it to a customer. | Linked. |
| A3 | Sell **parts and labour on one invoice**. | Both lines appear; only the parts come off stock. |
| A4 | Vehicle → history. | Shows what was fitted and when. |
| A5 | Take a **trade-in** against a sale. | It reduces what is owed as a **tender**, not as a discount. Check the reports still show the full sale value. |
| A6 | *(Tyres)* Record a DOT date. | Shown as tyre **age**, not as an expiry. |

> 📌 There is **no job card** in the system yet (car in the bay → work in progress
> → parts + labour → hand back). Quotation → convert to sale is the nearest thing.
> Already recorded as a gap — do not log it again.

### 5.6 Petroleum *(needs: fuel)*

| # | Do | Expect |
|---|---|---|
| PT1 | Forecourt → set up tanks, pumps and nozzles. | Saved. |
| PT2 | Open a forecourt shift with opening meter readings. | Saved. |
| PT3 | Record a **test litre** return. | Deducted from sales, not counted as a sale. |
| PT4 | Close the shift with closing meters and a **dip** reading. | Sales calculated from the meter; the dip corrects stock. |
| PT5 | Try closing with a closing meter **lower** than the opening. | Refused, unless it is a genuine meter roll-over. |
| PT6 | Receive a **tanker** delivery. | Tank stock increases. |
| PT7 | Compare meter sales vs dip. | Variance is shown. |

### 5.7 Services

| # | Do | Expect |
|---|---|---|
| SV1 | Create a **service** with a duration. | Saved. |
| SV2 | Try to give it stock. | **Refused** — a service does not carry stock. |
| SV3 | Sell the service at the till. | Completes. No stock moves. |
| SV4 | Portfolio → add work you have done. | Appears on the public page. |

> 📌 There is **no appointment / time-slot booking**, and there is not going to be.
> This is a deliberate product decision. Do not log it.

### 5.8 Finance (books only)

| # | Do | Expect |
|---|---|---|
| FN1 | Sidebar. | No Catalog, no Inventory, no POS. Only Expenses, Customers, Reports, Staff, Settings. |
| FN2 | Reports. | **Exactly one tab: Overview.** Correct — everything else needs sales or stock. |
| FN3 | Run the full Expenses set (E1–E7 above). | All work. |
| FN4 | Try opening `/tenant/pos` by typing the URL. | Refused or redirected. It must not open a working till. |

---

## Part 6 — Cross-cutting checks

Run these no matter what business type you have.

### 6.1 Permissions

| # | Do | Expect |
|---|---|---|
| X1 | Staff → create a user with the **Cashier** preset. | Created. |
| X2 | Log in as that cashier. Open a product. | **They cannot see the buying price (cost).** This is a real rule — if a cashier can read cost, that is a serious bug. |
| X3 | As cashier, try to open Reports. | Refused. |
| X4 | As cashier, try to refund a sale. | Refused, unless the preset includes it. |
| X5 | Check every job preset (Cashier, Waiter, Kitchen, Manager). | **Each one can actually do its own job.** A preset that cannot do the job it is named after is a bug. |
| X6 | Suspend a staff member. | They cannot log in. |
| X7 | Reactivate them. | They can. |

### 6.2 Every screen must speak

| # | Do | Expect |
|---|---|---|
| X8 | On any screen that saves, submits or deletes: make it fail (blank required field, duplicate SKU, no network). | **Something visible must say so** — a toast, an inline error, a message. |

> A screen that silently does nothing on failure is a bug, every time. Log it.

### 6.3 Multi-branch *(if the shop has more than one branch)*

| # | Do | Expect |
|---|---|---|
| X9 | Switch branches. | Stock figures change — stock is per branch. |
| X10 | Receive an order into branch B. | Lands on B, not Main. |
| X11 | Transfer stock A → B. | A goes down, B goes up, by the same amount. |
| X12 | Look up stock across branches from the till. | Shows where else the item is. |
| X13 | Reports for all branches vs one branch. | Figures differ correctly and add up. |

### 6.4 Help Centre

| # | Do | Expect |
|---|---|---|
| X14 | Open Help (bottom of the sidebar). | Full screen. |
| X15 | Read what it lists. | **Only screens this shop actually has.** A Finance shop must not be told how to use the till. |

### 6.5 Money and formatting

| # | Do | Expect |
|---|---|---|
| X16 | Look at every price, total and report on screen and on print. | **Always Rs / PKR. A "$" anywhere is a bug.** |
| X17 | Check rounding on a total that needs it. | Matches the cash-rounding setting. |

---

## Part 7 — Selling with no internet

**Do this LAST.** It needs a shop that already has products, a till that has
been used, and settings that are finished — because the whole feature is about a
till carrying on with what it already knows.

Two very different tests live in here and which one you run depends on a switch
you cannot see from the shop. **Read 7.1 first and find out which shop you have**
before you do anything else, or you will spend an afternoon reporting a refusal
that is the software working correctly.

---

### 7.1 First: which of the two shops do you have?

Offline selling is **off until a platform admin turns it on for that shop.**
That is deliberate — a shop earns it by running the pricing checks in 7.4 over
its own sales until the till has been proved to price exactly as the server
does.

Find out which one you have by going to **Shop settings → Point of Sale →
Lanes & PINs** and reading the box at the bottom:

| What you see | Which shop this is | Which tests you run |
|---|---|---|
| Pricing checks with numbers climbing, but the till refuses to complete a sale offline | **Shadow shop** — the normal state | 7.2, 7.3, **7.4**, 7.6 |
| The till completes a sale offline and prints an `OFF-…` slip | **Offline shop** — it has been granted | all of Part 7 |

> **A refusal is not a bug.** If your shop is a shadow shop, the till telling you
> *"This shop's tills aren't set up to sell without a connection yet"* at the
> tender screen is exactly right. Do not log it. What you test instead is 7.4.

---

### 7.2 Setup — five things that must be true, or nothing here works

Work through these **in order**. Most "offline is broken" reports are one of
these five not being true.

**① The address must be `https://` or `localhost`.**
This is the one that catches everybody. The offline engine is a service worker,
and a browser refuses to run one on a plain `http://` address — **including a
LAN IP like `http://192.168.1.40`.** If you were given a plain-http address,
offline cannot be tested at all. Say so and stop; it is not a bug in ShopOS.

**② Install it to the home screen.**
Chrome/Edge: the install icon in the address bar. Safari on iPad: Share → Add to
Home Screen. A browser tab works, but an installed till holds onto its data far
better under pressure — **and on an iPad it is the only thing that makes a real
difference.** Test from the installed icon, not the tab.

**③ Open the POS once, online, and let it settle.**
The till downloads the shop's catalog on its first run. On a big catalog this
takes a moment. Do not pull the plug until it has finished.

**④ Check the till registered itself.**
**Shop settings → Point of Sale → Lanes & PINs.** Your device should be in the
list. Nothing to register by hand — it adds itself.

**⑤ Name your till.**
Press **Name it** and call it something you will recognise: *"QA tablet"*, *"Lane
1 laptop"*. Ten seconds, and it is worth it — every later screen names the till
against what it did, and three rows all reading *Unnamed till* tell you nothing.

**Write down:**

```
Address (https / localhost?):
Installed to home screen?      yes / no
Till name I gave it:
Shadow shop or offline shop?
```

---

### 7.3 The connection pill — learn to read it before you need it

Top of the POS. It is the one thing that tells you what state the till is in.

| It says | It means |
|---|---|
| nothing / normal | online, nothing waiting |
| **Offline** | the till cannot reach the server |
| **47 saved here** | 47 sales are on this device waiting to send. **Not an error** — it says the money is safe |
| **Sending 12 of 47** | it is catching up right now |

**Test O1 — the pill is honest.** With the POS open, turn the connection off
(see 7.5 for how). The pill must turn Offline **within about 5 seconds.** Turn
it back on: it must go back within about 5 seconds.

If the pill lies about the connection, log it as **P1** — every other decision a
cashier makes rests on it.

---

### 7.4 The pricing checks — **the most important test in Part 7**

**Every shop runs this, granted or not.** This is the gate that decides whether a
shop is allowed to sell offline at all, and it is the thing most worth your time.

**What is happening:** every sale you ring **online** is priced twice — once by
the server (which is what the customer pays) and again by the offline engine,
purely to compare. Nothing on the receipt changes. Nobody is ever charged the
second figure.

**Where to look:** Shop settings → Point of Sale → Lanes & PINs → *Offline
pricing checks*.

**Test O2 — build up a real count.**

1. Ring **15–20 ordinary sales** on the till. Vary them on purpose:

| Ring at least one of each | Why |
|---|---|
| a plain single item | the base case |
| several items at once | line totals adding up |
| something sold by weight (0.35 kg) | fractional quantity |
| a whole-bill discount | the discount order |
| a per-line discount | the other discount order |
| an item that is on one of your promotions | **this is the one that found a real bug** |
| a taxed item, if the shop charges tax | rounding |
| a quantity that hits a bulk-price break | tiers |

2. Go back to the pricing checks box and read the four numbers.

**What good looks like:**

```
Carts checked      18
Matched exactly    18      ← must equal Carts checked
Couldn't be priced  0
Tills reporting     1 of 1
```

**What each number means when it is wrong:**

| Number | If it is not what you expect |
|---|---|
| **Carts checked** stays 0 | the checks are not running. Confirm 7.2 ① and ③, then log **P1** |
| **Matched exactly** < Carts checked | a real disagreement. **Log it — this is the highest-value bug you can find in Part 7.** Expand the row and copy BOTH figures |
| **Couldn't be priced** > 0 | the till is missing something it needs. Note what those carts had in common |
| **Tills reporting** 0 of N | a till is not reporting at all |

> **A disagreement never means a customer was overcharged.** They paid the
> server's price. It means the offline engine is not ready — and finding that
> here, on a normal trading day, is exactly the point.

**When you log a disagreement, include this shape:**

```
discount:  server Rs 106.00, till Rs 0.00
total:     server Rs 954.00, till Rs 1,060.00
Cart:      2 × Milkpak 1L, 1 × Bread
Promotion running at the time:  "Weekend 10% Off"
```

---

### 7.5 How to actually go offline (do it properly)

Three ways, best first:

| Method | How | Note |
|---|---|---|
| **DevTools** *(best)* | F12 → Network tab → the throttling dropdown → **Offline** | Precise, and only this tab. Leave DevTools open |
| **Airplane mode** | Tablet/phone: switch it on | Realistic. Use this for the long tests |
| Unplug the router | — | **Avoid.** Slow to take effect and hard to undo cleanly |

> Do **not** just close the laptop lid or walk out of Wi-Fi range mid-sale for
> the first few tests. Start with DevTools so you know exactly when the
> connection went.

---

### 7.6 What the till must REFUSE offline — and the exact words

This is not caution. The rule behind every line below is one sentence:

> **A till may only do what it can decide correctly on its own.**

Anything where **two tills could reach different answers at the same moment** —
a customer's khata balance, a loyalty point, one specific IMEI, a coupon that
may be used once, a dining table — needs the server.

**Test O3 — go offline and try each row. The refusal must arrive BEFORE you take
the money, never after.**

| Put this in the cart | Expected | The words you should see |
|---|---|---|
| A **medicine** | refused | *"Panadol can't be sold while the internet is down. Take it off the bill, or wait for the connection."* — it names **the item**, so a cashier knows which line to pull |
| An item tracked by **serial / IMEI** | refused | same shape, naming that item |
| Pay by **khata (credit)** | refused | *"Khata needs the connection — a customer's balance is shared between tills."* |
| **Spend loyalty points** | refused | *"Points can't be spent while the internet is down — the balance is shared."* Plus: ring it without points and the points **earned** still arrive later |
| Enter a **coupon code** | refused | *"A coupon's remaining uses can only be checked by the server."* |
| A **dine-in table** order | refused | *"A table's bill is shared between tills, so it needs the connection."* |
| Pay by **deposit / advance** | refused | *"deposit can't be settled while the internet is down."* |
| Pay by **trade-in** | refused | *"trade_in can't be settled while the internet is down."* |
| A **refund** | refused | *"…puts stock back, reverses any points and can credit a khata…"* then **"Take the customer's details and refund it once you are back online."** |
| An **exchange** | refused | *"An exchange is a refund and a sale together…"* |
| **Takeaway** food, cash | **allowed** | — |
| An ordinary product, cash or card | **allowed** | — |

> The wordings above are what the **till** says at the counter. The offline
> report may describe the same refusal differently — it is written for the owner
> the next morning, not the cashier mid-sale. Both being different is correct.

**Two things to check about every refusal, and log a P2 if either fails:**

1. **It arrives before the drawer opens.** A cashier who completes a sale and is
   then told it was not allowed has already handed the goods over.
2. **It says what to do instead.** *"Not allowed"* sends someone hunting for a
   setting. *"Take cash and ring it once you are back online"* sends them back to
   the counter. Every refusal here should name the way forward.

**Test O4 — a cart with three problems at once.** Put a medicine AND a coupon in
one cart and pay by khata. You should be told **all three**, not the first one. A
cashier who fixes the tender and is only then told about the medicine has been
interrupted twice for one decision.

---

### 7.7 Ringing a sale offline *(offline shop only)*

**Test O5 — the sale itself.**

1. Go offline (7.5).
2. Ring a plain cash sale.
3. Complete it.

Expect: the drawer behaviour and the slip are normal, but the number is
`OFF-LANE1-…` instead of an invoice number. The pill now says **1 saved here**.

4. **Keep that slip number written down.** You need it in step 7.
5. Ring three or four more.
6. Go back online.
7. Within a few seconds the pill counts down and clears.

**Test O6 — the slip a customer walked out with still finds the sale.**

Go to Sales and search for the `OFF-…` number from step 4. It must find the
sale, and that sale must **also** have a real invoice number now. **Both are
kept, and both are searchable** — that slip is the only reference the customer
has.

If the `OFF-…` number finds nothing, log **P1**.

**Test O7 — stock came down.**

Note a product's stock, sell 3 of it offline, and check the till's own figure
drops by 3 immediately. After syncing, the shop's stock must be down by 3 —
**not by 6.**

---

### 7.8 A sale that has happened is never lost

This is the promise the whole feature rests on. Test it rudely.

| # | Do this | Expected |
|---|---|---|
| **O8** | Ring 3 offline, then **close the browser completely** and reopen | still there, still says 3 saved here, still sends |
| **O9** | Ring 3 offline, then **reload the page mid-way** | nothing lost |
| **O10** | Ring 3 offline, leave it **overnight**, come back and reconnect | all 3 sync |
| **O11** | Ring 3 offline, then let the **battery die**. Charge and reopen | all 3 sync |
| **O12** | Open the POS in **two tabs**, both offline, ring in both, reconnect | every sale lands **exactly once** — no duplicates, none missing |
| **O13** | Ring **50+** offline sales, then reconnect | all of them sync; the pill counts down honestly |

**Anything lost here is P0.** Anything **duplicated** here is also P0 — the shop
would bank the same money twice.

---

### 7.9 A till whose clock is wrong

A tablet that has been flat for a week can come back believing it is the day it
was made. The moment of a sale decides its trading day, its shift, whose figures
it lands in — so this matters more than it sounds.

**Test O14 — the slow clock.**

1. Go offline.
2. In the tablet's own settings, turn **automatic date & time OFF** and set the
   date **3 days back**.
3. Ring two sales.
4. Put the clock back to automatic and reconnect.

**Expected:**

- The sales file on **today**, not three days ago.
- **Reports → Offline** shows a row naming your till and how far out its clock
  was, in the *"a till with the wrong time"* section.

**What is NOT expected:** the sales appearing in a day that has already been
closed and banked. If that happens, log **P0**.

**Test O15 — the fast clock.** Same, but set the date **2 days forward**. The
sales must still file on today. A sale in a day nobody has traded yet is P0.

> Put the clock back to automatic when you are done, or every later test in this
> guide will be strange.

---

### 7.10 Whose sale was it *(needs two logins)*

**Test O16.**

1. Sign in as **cashier A**. Go offline. Ring two sales.
2. Sign out. Sign in as **cashier B** on the same device.
3. Go back online and let the queue send.
4. Owner → **Reports → Staff**, covering today.

**Expected:** the two sales are against **cashier A**, who rang them — not
against cashier B, who merely happened to be signed in when the connection
returned. If B is credited, log **P1**: one person's whole day has landed in
somebody else's figures.

---

### 7.11 A till carried to another branch *(multi-branch shops only)*

**Test O17.**

1. On a till registered at **Branch A**, go offline and ring two sales.
2. Still offline, switch the branch selector to **Branch B**.
3. Go back online.

**Expected:** those two sales belong to **Branch A** — its books, its shelf. A
tablet being carried does not move the goods that already left Branch A's shelf.
If they land in Branch B, log **P0**: two branches are now wrong at once.

---

### 7.12 The hard stop *(only if your shop was given one)*

Most shops have none, and that is the sensible default. If yours has one, you
were told the number of days.

**Test O18.** Set the tablet's clock **FORWARD** past the limit — forward, not
back. The limit is measured from when this till last reached the server, so
winding the clock backwards makes the till read *"never heard from the server"*
and no limit applies at all; you would be testing nothing.

Then go offline and try to start a **new** sale. Expect a refusal that names the
way back: *"This till has been without internet for longer than the shop allows…
Get this device back online for a moment — its queued sales will send and it can
sell again straight away."*

**Test O19 — the cart already on the counter finishes.** Start a cart **before**
the limit passes, then let it pass, then complete. It must go through. A stop
that lands mid-transaction, with the goods bagged and the customer waiting, is
the exact failure this feature exists to prevent — log **P1** if it happens.

---

### 7.13 The morning after — Reports → Offline

Open this after any of the tests above. It answers one question: *what happened
while we were out of contact?*

| Section | What it is | What to check |
|---|---|---|
| **Late sales** | everything that came in after the fact | your test sales are here, with the right totals and the right tills |
| **Count these again** | stock that went below zero | correct after two tills sell the last one. **Not a bug** |
| **Need a decision** | sales that broke an offline rule and were recorded anyway | should be empty in a clean run |
| **Arrived after the day was closed** | a rupee figure, not a count | it is how far that day's takings now read short |
| **A till with the wrong time** | one row per **tablet**, not per sale | your clock test from 7.9 |

**Test O20 — the slip number is here too.** Every late sale row shows the
`OFF-…` number beside the real invoice number.

**Test O21 — a clean run says so.** On a shop with no outage, this screen should
say your tills were in touch the whole time. **That is the answer you want.**

---

### 7.14 Offline — correct behaviour, do NOT log

| | Why it is right |
|---|---|
| The till refuses to complete a sale offline | The shop has not been granted offline selling. This is the normal state |
| Medicines, serials, khata, points, coupons, dine-in, refunds refused offline | The rule in 7.6 — every one is shared between tills |
| Stock going **negative** after two tills sold the last one | Both cashiers told the truth; the goods really did leave twice. The shelf needs counting, nothing is corrupted |
| A sale filed on the day it **happened**, not the day it arrived | Deliberate. Tuesday's sale is Tuesday's money |
| A closed day's figures not changing when a late sale lands | Deliberate. A day signed off in March must read the same in September — the shortfall is **named** instead |
| Nothing works at all on a plain `http://` LAN address | A browser will not run a service worker outside a secure context. Not a ShopOS bug — see 7.2 ① |
| "47 saved here" | Not an error. It says the money is safe on this device |

---

## Part 8 — How to report what you find

One issue per entry. An issue nobody can reproduce cannot be fixed.

```
TITLE:      one line, what is wrong

BUSINESS TYPE:   e.g. Pharmacy
MODULES ON:      products, inventory, pos, expenses
LOGGED IN AS:    owner / cashier / waiter — and which permissions
BRANCH:          Main / other

STEPS:
  1. …
  2. …
  3. …

EXPECTED:   what should have happened
ACTUAL:     what happened instead

SCREENSHOT: attach one
CONSOLE:    open the browser console (F12) and paste any red errors
```

### Before you log it, ask these four

1. **Is the module ON?** Check the sidebar (0.2). Missing module = missing screen, correctly.
2. **Does this business type use this screen?** Check the trade table (0.3).
3. **Does my login have the permission?** Try as the owner.
4. **Is it in the "already known" list below?**

### Already known — please do not log these again

| | |
|---|---|
| Restaurant has no Suppliers / Purchases / recipes by default | Correct — inventory is off by default for Food |
| Finance shop's Reports shows only Overview | Correct behaviour |
| No appointment / time-slot booking | Deliberate — out of scope permanently |
| No job card for workshops | Known gap, recorded |
| "Map search is not set up on this installation" | Deployment config, not a code bug |
| The till refuses to sell offline | Correct unless the shop was granted it — see 7.1 |
| Medicines / serials / khata / points / coupons / dine-in / refunds refused offline | Correct — see the rule in 7.6 |
| Stock going negative after an outage | Correct — see 7.14 |
| A closed day's figures not moving when a late sale lands | Correct — the shortfall is named instead |
| Nothing offline works on a plain `http://` LAN address | A browser will not run a service worker outside a secure context — see 7.2 ① |

### Severity — mark each one

| | |
|---|---|
| **P0** | Money or stock is wrong; or data leaks between shops |
| **P1** | A core job cannot be completed at all |
| **P2** | Works, but wrong or confusing |
| **P3** | Cosmetic |

---

## Quick reference — the whole run in order

```
0.  Record business type + modules + permissions
1.  Settings, all 7 tabs                    ← do this FIRST
2.  Categories → Products (incl. retire toggle) → Suppliers → PO → Receive → Stock
3.  Till: shift → sale → discount → split → credit → shift gate → X/Z
4.  Returns → Loyalty → Expenses → Reports
5.  Your trade's own section (5.1 – 5.8) — ONE of them only
6.  Permissions, error messages, branches, help, currency
7.  Offline (O1–O21)                        ← do this LAST, and read 7.1 first
8.  Write it up
```

**If you only have an hour for Part 7,** do 7.4 — the pricing checks. It is the
one that decides whether this shop may sell offline at all, it runs on any shop
granted or not, and it has already caught a real bug on its first day in a real
shop.

**The single rule to remember:** for every field you fill in —
**save it, close it, open it again, and check it is still there.**
