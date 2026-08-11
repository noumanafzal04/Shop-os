# Who gets which screen — the flow, per business type

`BUSINESS-TYPE-WORKFLOWS.md` answers *what a trade can do*: which modules, which
edge cases, which tests. This document answers the question that comes up when
you actually set a shop up:

> **Kitchen ki screen kisko deni hai? Table se order lene wali screen kisko?**

There are no job roles in ShopOS. There is one list of permissions per person,
and a **preset** is a button that ticks the right boxes for a named job so
nobody has to know which of nineteen checkboxes makes a cashier.

Staff → Add staff → **pick the job** → the boxes tick themselves → save. You can
change any box afterwards; the preset is a starting point and is then forgotten.

The list of jobs offered is already filtered by the shop: a pharmacy is offered
**Pharmacist** and never **Waiter**; a restaurant is offered **Waiter** and
**Kitchen**; a mart is offered neither. Nothing has to be hidden by hand.

---

## The answer to the question above

| Job | Gets | Does NOT get |
|---|---|---|
| **Waiter** | Dine-in floor — opens a table, takes the order, fires it to the kitchen, settles the bill | Only **their own tables**. Cannot touch another waiter's tab |
| **Kitchen** | The Kitchen board only — sees fired orders, marks them ready | No till, no sales, no takings, no menu |
| **Cashier** | POS, and **any** waiter's table, so they can take payment at the counter | Cannot void a completed sale or refund |

The three fit together on purpose:

- A **waiter** is deliberately denied "serve any table". Their own tables are the
  unit the service report pays tips off, and that stops being true the moment
  anyone can settle anyone's bill.
- A **cashier** IS given "serve any table" — the till settles what the floor
  opened, and a cashier who cannot pick up a waiter's tab cannot take the money.
- **Kitchen** holds one permission and one only. It used to carry `sales.manage`
  because the kitchen board was gated on it — which also opens the sales ledger,
  the day's banking and the quotes screen. A kitchen hand was being shown the
  shop's takings in order to be allowed to mark a curry ready. That is fixed;
  `kitchen.manage` now exists for exactly this.

---

## What each permission opens

One table, because every screen in the shop derives from this list. The sidebar,
the dashboard tiles and the server all read the same rule.

| Permission | Screens |
|---|---|
| `sales.manage` | POS · Dine-in · Sales · Day & banking · Quotes & Advances · Pharmacy register · Warranty desk |
| `kitchen.manage` | Kitchen board |
| `orders.manage` | Online orders · Riders |
| `products.manage` | Products · Categories · Collections · Labels |
| `inventory.manage` | Inventory · Stock count · Transfers · Forecourt shifts |
| `suppliers.manage` | Suppliers |
| `purchases.manage` | Purchase orders · Suppliers · Fuel deliveries |
| `customers.manage` | Customers · Vehicles |
| `coupons.manage` | Coupons · Promotions |
| `expenses.manage` | Cashbook · Ledger · Income · Expenses |
| `reports.view` | Reports |
| `reservations.manage` | Reservations |
| `settings.manage` | Shop settings · Branches · Portfolio · Reviews · Tanks & pumps |
| `staff.manage` | Staff |
| — always open — | Dashboard · Subscription · Security (your own password) |

Three permissions are **not** in any preset by design — `staff.manage`,
`settings.manage`, and nothing grants the owner's own account. A manager runs
the shop; the owner decides who works in it and how it is configured. Tick them
by hand if you mean to.

---

## FOOD — restaurant, café, dhaba, bakery

**Modules:** products · pos · dine_in · marketplace · delivery · expenses · images

### Who you hire

| Job | What they do all day |
|---|---|
| **Waiter** | Opens tables, takes orders, fires to kitchen, settles their own tables |
| **Kitchen** | Watches the board, cooks, marks ready |
| **Cashier** | Counter and takeaway, settles any table |
| **Shift supervisor** | A cashier who can also void, refund and discount past the ceiling |
| **Online orders** | Works delivery / pickup orders through to dispatch |
| **Purchasing** | Suppliers and purchase orders for raw material |
| **Accounts** | Money in and out, reports |
| **Manager** | All of the above except staff and shop settings |

### The daily flow

1. **Owner / manager** — build the menu: dishes, modifiers (extra cheese), deals.
2. **Cashier** opens the shift with a float.
3. A guest sits down. **Waiter** opens the table → adds items → **fires** → the
   order appears on the **Kitchen** board with no refresh.
4. **Kitchen** marks it ready → the waiter's floor screen updates on its own.
5. **Waiter** settles — full bill, split, or by quantity. Or the guest walks to
   the counter and the **cashier** settles the same tab.
6. Takeaway and delivery run in parallel through POS and Online orders.
7. **Cashier** closes the shift → counts the drawer → variance is recorded.
8. **Owner** closes the day and records what went to the bank.

> A restaurant has **no inventory module**. Ingredients deplete by recipe when a
> dish sells, not by counting a shelf. Stock keeper and Purchasing are offered
> because a kitchen still buys from suppliers and keeps a menu — but there is no
> Inventory screen, and there should not be.

---

## MART / grocery / general store

**Modules:** products · pos · inventory · marketplace · delivery · expenses · images

### Who you hire

| Job | What they do all day |
|---|---|
| **Cashier** | The counter. Scan, take payment, print |
| **Shift supervisor** | Cashier + void, refund, discount override |
| **Stock keeper** | Receives goods, counts shelves, keeps the catalog straight |
| **Purchasing** | Suppliers, purchase orders, what was paid against them |
| **Online orders** | Home-delivery orders |
| **Accounts** · **Manager** | As above |

### The daily flow

1. **Purchasing** raises a PO on a supplier.
2. Goods arrive. **Stock keeper** receives against the PO — stock rises, and the
   cost on the row is what the delivery actually cost.
3. **Cashier** opens the shift, sells all day. Stock falls per sale.
4. Low-stock alerts fire at exactly the reorder level set on each product.
5. **Stock keeper** runs a stock count; the difference is posted as a correction,
   never silently overwritten.
6. **Cashier** closes the shift. **Owner** closes the day and banks the cash.

---

## PHARMACY / medical store

**Modules:** products · pos · inventory · delivery · expenses

### Who you hire

| Job | What they do all day |
|---|---|
| **Pharmacist** | Dispenses against a prescription, and manages batches and expiry as well as the counter |
| **Cashier** | Counter only — sells, takes payment |
| **Shift supervisor** | Cashier + void, refund, override |
| **Stock keeper** · **Purchasing** | Receiving, counting, ordering |
| **Accounts** · **Manager** | As above |

The **Pharmacist** is the one preset that exists only for this trade. It is a
cashier who also holds `products.manage` and `inventory.manage`, because
dispensing and batch/expiry work are the same person's job at a chemist's
counter — nobody stops mid-sale to fetch the stock keeper.

### The daily flow

1. **Purchasing** orders from the distributor.
2. **Stock keeper / pharmacist** receives, and every medicine batch is entered
   **with its expiry** — required, not optional.
3. Selling picks the batch nearest expiry first (FEFO), so old stock leaves first.
4. A prescription sale captures the doctor and the Rx against the ticket.
5. The dashboard warns on near-expiry stock before it is dead money.
6. Close shift, close day, bank.

---

## RETAIL — clothing, electronics, hardware, books

**Modules:** products · pos · inventory · marketplace · delivery · reservations · expenses · images

Same shape as MART, plus two things:

- **Serial / IMEI capture** at the counter for anything tracked by serial, with
  the warranty recorded against the buyer. The **Warranty desk** then answers
  "when did I buy this and is it still covered?" from the serial alone.
- **Reservations** — no preset grants it except **Manager**. If someone takes
  bookings and nothing else, tick `reservations.manage` by hand.

---

## SERVICES — salon, tailor, repair shop

**Modules:** services · pos · expenses

Only four jobs are offered — **Cashier**, **Shift supervisor**, **Accounts**,
**Manager** — because a service shop has no stock to keep and nothing to buy in.
The catalog holds **services**, not products: labour billed by the job.

> There is no appointment booking, and there will not be.

---

## PETROLEUM — petrol pump

**Modules:** products · services · pos · inventory · fuel · expenses

### Who you hire

| Job | What they do all day |
|---|---|
| **Forecourt attendant** | Sells fuel at the pump and closes their own shift against the dip |
| **Cashier** | The shop counter — oil, snacks, everything not a nozzle |
| **Purchasing** | Tanker deliveries and rate changes |
| **Accounts** · **Manager** | As above |

**Forecourt attendant** exists because a station's counter job is not a shop's
counter job. Closing a forecourt shift ends by setting fuel stock to the **dip**
— that is a stock correction, so it needs `inventory.manage`, and an attendant
who cannot close their own shift leaves the reconciliation to whoever is still
standing there at midnight.

### The daily flow

1. **Owner** sets up tanks, pumps and nozzles once.
2. **Attendant** opens a forecourt shift — meter readings are taken at the start.
3. Fuel sells through the shift. Test litres are recorded and are **not** a sale.
4. **Attendant** closes: meter readings at the end, then the tank is dipped and
   stock is set to the dip. The difference is the variance.
5. **Purchasing** books a tanker delivery when it arrives; rate changes are
   recorded so a sale is always priced at the rate in force at the time.

---

## AUTOMOTIVE — workshop, tyre shop, service centre

**Modules:** products · services · pos · inventory · expenses

Parts **and** labour on one invoice. The distinguishing pieces:

- A **vehicle** is customer data. The plate is how a workshop finds a person, so
  Vehicles sits behind `customers.manage`, and the vehicle's history follows it.
- A **trade-in** is a tender, not a discount — it is money the customer paid you
  in goods, and it appears as a payment line, never as a price reduction.
- Tyre **DOT dating** is age, not expiry.

Jobs offered are the general set: Cashier, Shift supervisor, Stock keeper,
Purchasing, Accounts, Manager.

---

## FINANCE — books-only

**Modules:** expenses (nothing else)

Two jobs: **Accounts** and **Manager**. There is no till, no catalog and no
sales ledger, and the sidebar shows none of them — a books-only tenant that was
offered a POS it can never open would be a bug, not a courtesy.

### The daily flow

1. **Accounts** files what was spent and what came in, each against a category.
2. A bill can name **who was paid** — a landlord is not a supplier, and a
   books-only shop has no supplier directory to pick from.
3. Recurring bills post themselves on schedule; budgets warn when a category
   goes past its ceiling.
4. Receipts attach to the row as evidence. They are **private** — served only to
   someone who could already read the row.
5. The Ledger is the whole book, balance carried down.

---

## Two rules worth knowing before you assign anyone

**A preset is forgotten once applied.** Editing "Cashier" next month does not
re-permission anyone hired last month. That is deliberate — silently changing
what your existing staff can do because you adjusted a template is exactly the
surprise this avoids.

**A job is offered even when a module is off, and stays harmless.** The module
gate is the real boundary and it is enforced on every request, so an extra
permission is inert until you switch that module on — at which point it means
what you intended. Trimming it instead would leave an invisible gap that shows
up months later as "why can't my manager see online orders?"
