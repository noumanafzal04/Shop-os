/**
 * The Help Centre's content — one entry per module, plus the topics that are
 * not a module but are the first thing anyone asks about.
 *
 * Written as DATA rather than pages for one reason: help that shows a
 * restaurant how to count stock, or a pharmacy how to fire a table's order to
 * the kitchen, is worse than no help. Every article declares the modules,
 * trades and permission it belongs to, and the page filters against the shop
 * and the person actually reading it — the same three axes the sidebar uses.
 *
 * `trades` are PRIMARY codes (BusinessTypes::primary), so an old `clinic` reads
 * as `pharmacy` and still gets the chemist's articles.
 */

export type HelpBlock =
  /** A section heading. These, and only these, become the "On this page" rail. */
  | { type: "h"; text: string }
  | { type: "p"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "keys"; items: Array<[string, string]> }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "note"; text: string }
  | { type: "warn"; text: string };

export interface HelpArticle {
  id: string;
  /** The module this documents, or a plain topic name. */
  title: string;
  /** One line, shown in the list. */
  summary: string;
  /** The group it sits under in the left rail. */
  group: "Start here" | "Selling" | "Catalog & stock" | "Money" | "People & setup";
  /** Show when ANY of these modules is on. Empty/absent = always. */
  modules?: string[];
  /** Show only for these trades. Absent = every trade. */
  trades?: string[];
  /** Show only to someone who could open the screen it describes. */
  permission?: string;
  /** Where the screen actually is, so the article can offer to open it. */
  screen?: string;
  /** Words a person might search that aren't in the title. */
  keywords?: string[];
  /**
   * The id of the article this one sits UNDER in the rail. A sub-screen is
   * still its own article — Stock count is not a paragraph of Inventory — but
   * a flat list of forty screens is a list nobody reads.
   *
   * A child is only ever offered when its parent survived the same filter, so
   * nesting can never smuggle a screen past the module gate.
   */
  parent?: string;
  body: HelpBlock[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Start here ────────────────────────────────────────────────────
  {
    id: "how-it-fits",
    title: "How ShopOS fits together",
    summary: "Why you see the screens you see, and not the ones you don't.",
    group: "Start here",
    keywords: ["missing", "hidden", "why can't I see", "screen not showing"],
    body: [
      {
        type: "h", text: "The three gates",
      },
      {
        type: "p",
        text: "Nothing here is hidden by accident. A screen appears only when three things agree, and if something is missing, one of these is the reason — in this order.",
      },
      {
        type: "table",
        head: ["", "Decides", "Who sets it"],
        rows: [
          ["Module", "What your shop bought — POS, Inventory, Dine-in and the rest", "Us, for your shop"],
          ["Business type", "What your shop is — restaurant, mart, pharmacy…", "Us, once, when the shop was created"],
          ["Person", "What this particular user is allowed to do", "You, per staff member"],
        ],
      },
      {
        type: "p",
        text: "So: a pharmacy has no Dine-in because of the module. A mart has no prescription register because of the business type. A cashier has no Reports because of the person.",
      },
      {
        type: "note",
        text: "This Help Centre follows the same rule — you are only reading articles about the modules your shop actually has, and the screens you personally can open.",
      },
    ],
  },
  {
    id: "first-week",
    title: "Setting up — the order to do it in",
    summary: "What to fill in first so nothing blocks you later.",
    group: "Start here",
    permission: "products.manage",
    keywords: ["setup", "getting started", "new shop", "onboarding"],
    body: [
      {
        type: "steps",
        items: [
          "Shop settings — name, logo, address, currency and your tax default. The receipt is built from these.",
          "Categories — what kinds of thing you sell. Yours were seeded from your business type; rename and add freely.",
          "Products — the catalog. You can save a product from the first tab alone; the rest are there when you need them.",
          "Opening stock — entered on the product when you create it. After that, stock only ever changes through Inventory.",
          "Staff — add your people and pick the job each one does.",
          "Open a shift on the till and sell.",
        ],
      },
      {
        type: "warn",
        text: "Set the tax default and the discount ceiling in Shop settings BEFORE you start selling. Both are applied at the moment of sale, so changing them later does not correct yesterday's receipts.",
      },
    ],
  },

  // ── Catalog & stock ───────────────────────────────────────────────
  {
    id: "products",
    title: "Products",
    summary: "Adding what you sell, and what each field on the form is for.",
    group: "Catalog & stock",
    modules: ["products", "services"],
    permission: "products.manage",
    screen: "/tenant/products",
    keywords: ["add product", "sku", "barcode", "price", "cost", "item"],
    body: [
      { type: "h", text: "Adding a product" },
      { type: "p", text: "Products → + Add product. The form is four tabs, and you can save from the first one alone." },
      { type: "h", text: "Every field on the form" },
      { type: "p", text: "Tab 1 — Details. The only one you must fill in:" },
      {
        type: "table",
        head: ["Field", "What it is for"],
        rows: [
          ["Item type", "What kind of thing this is. The list depends on your business type."],
          ["Name", "What the cashier will search for at the till."],
          ["Category", "One per product, and required."],
          ["SKU", "Your own code. Left blank, one is generated."],
          ["Barcode", "What the scanner reads. A product can have several — see Codes & packs."],
          ["Sale price", "What the customer pays."],
          ["Cost", "What you paid. Staff cannot see this unless they manage stock, purchasing or reports."],
          ["Wholesale price", "A second price for trade customers. Also hidden from the counter."],
          ["Tax rate / group", "Leave blank to use your shop default."],
          ["Sold by", "Each, weight, volume or length — this changes how the till asks for quantity."],
          ["Low-stock alert at", "The alert fires AT this number, not below it."],
          ["Opening stock", "Only when creating. Afterwards stock changes through Inventory, never by editing the product."],
        ],
      },
      {
        type: "list",
        items: [
          "Tab 2 — Media & online: photos, description, and which collections it belongs to.",
          "Tab 3 — Variants & options: the same product in sizes or colours (each with its own stock and barcode), or add-ons like 'extra cheese' that change the price.",
          "Tab 4 — Codes & packs: extra barcodes for the same product, and pack sizes — sell as a piece, a dozen or a carton while stock is held in the base unit.",
        ],
      },
      {
        type: "note",
        text: "Editing a product never changes its stock. That is deliberate: stock moves for a reason — a sale, a delivery, a count — and every movement is recorded.",
      },
    ],
  },
  {
    id: "categories-collections",
    title: "Categories vs Collections",
    summary: "The difference, and why a product has one category but many collections.",
    group: "Catalog & stock",
    modules: ["products"],
    permission: "products.manage",
    screen: "/tenant/categories",
    keywords: ["category", "collection", "brand", "group", "shelf"],
    body: [
      {
        type: "table",
        head: ["", "What it is", "How many", "Who sees it"],
        rows: [
          ["Category", "What the thing IS. Rice. Antibiotics. Brake pads.", "One", "You and the shopper"],
          ["Collection", "A group you invented for selling. 'Ramadan deals'. 'New arrivals'.", "Many", "The online shop only"],
          ["Brand", "Who made it", "One", "You and the shopper"],
        ],
      },
      {
        type: "p",
        text: "The rule: a category is the truth about the product; a collection is a decision about how to sell it. A product stays in one category forever and drifts in and out of collections whenever you like.",
      },
      { type: "note", text: "If you are not selling online, you do not need collections at all." },
      { type: "p", text: "Deleting a category does not delete the products in it." },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    summary: "Stock levels, counting a shelf, and moving stock between branches.",
    group: "Catalog & stock",
    modules: ["inventory"],
    permission: "inventory.manage",
    screen: "/tenant/inventory",
    keywords: ["stock", "count", "shelf", "reorder", "low stock", "transfer"],
    body: [
      {
        type: "table",
        head: ["Screen", "What it is for"],
        rows: [
          ["Inventory", "What you hold now, and the reorder list — everything that has fallen to its alert level."],
          ["Stock count", "Count a shelf and enter what is really there. The difference posts as a correction with a reason."],
          ["Transfers", "Move stock between branches. It leaves one and arrives at the other, and both sides are recorded."],
        ],
      },
      { type: "h", text: "Reordering what has run low" },
      {
        type: "p",
        text: "Set a reorder level on a product and it appears here the moment stock falls to it. The count on your dashboard — “12 items are running low” — opens this list directly.",
      },
      {
        type: "steps",
        items: [
          "Inventory → Needs reordering. Only the short items, not the whole catalog.",
          "Order these items — every one of them becomes a line on a new purchase order, at its last known cost.",
          "Pick the supplier, correct the quantities, and save it as a draft or place it.",
        ],
      },
      {
        type: "note",
        text: "On a multi-branch shop the list is for the branch you are looking at. A product with none of it on THIS branch's shelf counts as short even if the warehouse is full — because that is the shelf a customer is standing at.",
      },
      {
        type: "warn",
        text: "A stock count never silently overwrites. The difference between what the system thought and what you counted is posted as its own movement, so a month later you can still see that a correction happened and how big it was.",
      },
    ],
  },
  {
    id: "batches",
    title: "Batches and expiry",
    summary: "Lots, expiry dates, and why the oldest stock sells first.",
    group: "Catalog & stock",
    modules: ["inventory"],
    trades: ["pharmacy", "mart"],
    permission: "inventory.manage",
    keywords: ["expiry", "batch", "lot", "fefo", "near expiry", "medicine"],
    body: [
      {
        type: "p",
        text: "Stock is held in lots, each with its own expiry date. When you sell, the lot expiring soonest goes first — so old stock leaves before it dies.",
      },
      {
        type: "warn",
        text: "A medicine batch must have an expiry date. The form will not accept one without, because an expiry you cannot see is an expiry nobody checks.",
      },
      { type: "p", text: "Your dashboard warns on near-expiry stock while it is still sellable, rather than after it becomes a write-off." },
      { type: "h", text: "Writing off a batch that has died" },
      {
        type: "p",
        text: "The Inventory screen lists every batch expiring within 30 days, with the expired ones marked. Each row has a Write off next to it.",
      },
      {
        type: "steps",
        items: [
          "Inventory → the expiring-stock panel at the top.",
          "Write off, on the batch that has gone. Confirm the quantity.",
          "What was left in that batch comes out of stock as recorded wastage, naming the batch.",
        ],
      },
      {
        type: "note",
        text: "It is a recorded movement, not a deletion — the stock did not vanish, it was thrown away, and next month you can still see how much and which lot. That is the number that tells you whether you are over-ordering.",
      },
    ],
  },
  {
    id: "purchases",
    title: "Suppliers & purchase orders",
    summary: "Ordering from a supplier, receiving the delivery, and what you owe.",
    group: "Catalog & stock",
    modules: ["inventory", "products"],
    permission: "purchases.manage",
    screen: "/tenant/purchases",
    keywords: ["supplier", "purchase order", "po", "receive", "delivery", "payable"],
    body: [
      {
        type: "steps",
        items: [
          "Raise a purchase order against a supplier — what you want and at what price.",
          "The goods arrive. Receive against the order, entering what actually turned up.",
          "Stock rises at that moment, and the cost on the line is what the delivery really cost.",
          "Record what you paid the supplier. The balance you still owe shows on the supplier.",
        ],
      },
      {
        type: "note",
        text: "Receiving is what raises stock — not raising the order. An order is an intention; a delivery is goods on your shelf.",
      },
      {
        type: "p",
        text: "Paying a supplier is recorded as its own kind of money-out, not as an expense. If it were an expense, a shop that both files the wholesaler's bill and records the payment would count the same rupees twice.",
      },
    ],
  },

  // ── Selling ───────────────────────────────────────────────────────
  {
    id: "pos",
    title: "POS — the till",
    summary: "Shifts, the cart, hotkeys, and taking payment.",
    group: "Selling",
    modules: ["pos"],
    permission: "sales.manage",
    screen: "/tenant/pos",
    keywords: ["till", "checkout", "sell", "scan", "barcode", "pay", "shift", "drawer", "float"],
    body: [
      {
        type: "h", text: "What the till is",
      },
      {
        type: "p",
        text: "The POS runs full screen with no sidebar, because a cashier serving a queue should not be one mis-click from the settings page. Esc leaves it.",
      },
      { type: "h", text: "Opening and closing a shift" },
      { type: "p", text: "Before you can sell, a shift must be open:" },
      {
        type: "steps",
        items: [
          "Pick which register this device is. Asked once and remembered — two tills in one shop are two registers, and their drawers are counted apart.",
          "Open the shift and type the float: the cash already in the drawer.",
          "Sell all day.",
          "Close the shift: count the drawer and type what is actually there. The difference against what should be there is the variance, and it is recorded whether you are over or short.",
        ],
      },
      { type: "p", text: "An X-read counts the drawer mid-shift without closing it." },
      { type: "h", text: "The screen" },
      { type: "p", text: "The screen is three parts: the product browser on the left with search and category tabs, the cart on the right, and the total with the pay button at the bottom. A barcode scanner types into the search box and adds the item on Enter." },
      {
        type: "keys",
        items: [
          ["F2", "Jump to search / scan"],
          ["F4", "Hold — park this ticket and start a new one"],
          ["F6", "Drafts — reopen a parked ticket"],
          ["F7", "Quote — a price given, or an advance taken, without selling yet"],
          ["F9", "Pay"],
          ["Esc", "Clear the search box"],
        ],
      },
      { type: "h", text: "Taking payment" },
      { type: "p", text: "Press F9 to take payment. You can split it across cash, card and credit — add a line for each way the customer pays. Cash amounts are suggested in notes that actually exist." },
      {
        type: "warn",
        text: "Prices are decided by the server, never by the browser. That is why a discount past your ceiling needs a supervisor, and why nothing on the page can change what a customer is charged.",
      },
    ],
  },
  {
    id: "dine-in",
    title: "Dine-in — tables and tabs",
    summary: "Opening a table, firing to the kitchen, and settling the bill.",
    group: "Selling",
    modules: ["dine_in"],
    permission: "sales.manage",
    screen: "/tenant/dine-in",
    keywords: ["table", "tab", "waiter", "restaurant", "kot", "fire", "split bill"],
    body: [
      {
        type: "steps",
        items: [
          "The guest sits down. Tap the table — a tab opens on it.",
          "Add what they ordered, with any modifiers (extra cheese, no ice).",
          "Press Fire. The order appears on the Kitchen board immediately — nobody needs to refresh anything.",
          "The kitchen marks it ready, and your floor screen updates on its own.",
          "Settle: the whole bill, split evenly, or split by item. A partial settlement leaves the rest open on the table.",
        ],
      },
      {
        type: "note",
        text: "A tab belongs to the waiter who opened it. A cashier can settle anyone's tab so payment can be taken at the counter; another waiter cannot, unless you tick 'Serve any table' on them.",
      },
      { type: "h", text: "Going off shift with open tables" },
      {
        type: "p",
        text: "Open the tab and press Hand over. Pick the colleague taking the section. The order, the kitchen tickets already fired and the bill all stay exactly as they are — only who is serving it changes.",
      },
      {
        type: "list",
        items: [
          "You can always give YOUR OWN table to anyone. Finishing a shift should not need a supervisor.",
          "Taking someone else's table needs 'Serve any table' — otherwise this would be the way around every other rule on the floor.",
          "After handing over it is genuinely theirs. You will see the tab but not be able to change it.",
        ],
      },
      {
        type: "note",
        text: "This is the answer to a shift change, not 'Serve any table'. Ticking that permanently, to solve one evening, gives that person every table in the restaurant for good.",
      },
    ],
  },
  {
    id: "kitchen",
    title: "Kitchen board",
    summary: "The screen on the kitchen wall, and nothing else.",
    group: "Selling",
    modules: ["dine_in"],
    permission: "kitchen.manage",
    screen: "/tenant/kitchen",
    keywords: ["kot", "chef", "cook", "ready", "board", "pass"],
    body: [
      { type: "p", text: "Fired orders, oldest first. Mark them ready as they leave the pass. That is the whole screen." },
      {
        type: "note",
        text: "Someone on the Kitchen job sees this and nothing else — not the till, not the sales list, not the takings. That is deliberate: marking a curry ready should not require being shown what the shop earned today.",
      },
      { type: "p", text: "Marking an order ready updates the waiter's floor screen straight away." },
    ],
  },
  {
    id: "prescriptions",
    title: "The prescription counter",
    summary: "Dispensing against a doctor's prescription.",
    group: "Selling",
    modules: ["pos"],
    trades: ["pharmacy"],
    permission: "sales.manage",
    screen: "/tenant/pharmacy",
    keywords: ["rx", "prescription", "doctor", "dispense", "medicine", "generic", "salt"],
    body: [
      { type: "p", text: "Sell as normal, and capture the doctor and the prescription against the ticket. Both stay with the sale." },
      { type: "p", text: "Search finds a medicine by its brand name or by its salt, so a customer asking for the generic still gets served." },
      { type: "p", text: "The batch nearest expiry is picked automatically." },
    ],
  },
  {
    id: "serials",
    title: "Serial numbers & warranty",
    summary: "Capturing an IMEI or serial at the counter, and looking it up later.",
    group: "Selling",
    modules: ["pos"],
    trades: ["retail", "automotive"],
    permission: "sales.manage",
    screen: "/tenant/warranty",
    keywords: ["imei", "serial", "warranty", "guarantee", "claim"],
    body: [
      { type: "p", text: "For anything tracked by serial, the serial is captured as it is sold and the warranty period is recorded against the buyer." },
      { type: "p", text: "The Warranty desk then answers the only question anyone asks with a broken phone on the counter: when was this bought, and is it still covered? The serial alone is enough to find it." },
    ],
  },
  {
    id: "orders",
    title: "Online orders & delivery",
    summary: "Working an order from placed to dispatched.",
    group: "Selling",
    modules: ["marketplace", "delivery"],
    permission: "orders.manage",
    screen: "/tenant/orders",
    keywords: ["online", "delivery", "rider", "dispatch", "marketplace", "cod"],
    body: [
      { type: "p", text: "Orders placed on your online shop arrive here. Accept, prepare, then dispatch — assign a rider if you deliver." },
      { type: "note", text: "Payment is cash on delivery. It is recorded when the money actually reaches you, not when the order is placed." },
    ],
  },
  {
    id: "forecourt",
    title: "Forecourt — shifts and the dip",
    summary: "Opening and closing a fuel shift, and what the variance means.",
    group: "Selling",
    modules: ["fuel"],
    trades: ["petroleum"],
    permission: "inventory.manage",
    screen: "/tenant/fuel",
    keywords: ["fuel", "pump", "nozzle", "dip", "tank", "meter", "petrol", "diesel"],
    body: [
      {
        type: "steps",
        items: [
          "Open a shift. Meter readings are taken at the start.",
          "Fuel sells through the shift, priced at the rate in force at the time.",
          "Test litres are recorded and are not a sale — they went back in the tank.",
          "Close the shift: meter readings again, then dip the tank and set stock to the dip.",
          "The difference between what the meters say sold and what the dip says is left is the variance.",
        ],
      },
      { type: "note", text: "Tanker deliveries and rate changes are recorded separately, under Deliveries & rates." },
    ],
  },
  {
    id: "day",
    title: "Day & banking",
    summary: "What the whole shop took today, and what went to the bank.",
    group: "Selling",
    modules: ["pos"],
    permission: "sales.manage",
    screen: "/tenant/day",
    keywords: ["end of day", "close day", "bank", "deposit", "takings"],
    body: [
      { type: "p", text: "A shift close counts one drawer. This counts the day, across every drawer in the shop, and records what was deposited." },
      { type: "note", text: "Anyone at the till can read the day. Closing it off is a manager's job." },
    ],
  },

  // ── Money ─────────────────────────────────────────────────────────
  {
    id: "cashbook",
    title: "Cashbook",
    summary: "What each day came to — and why it is not the cash in your drawer.",
    group: "Money",
    modules: ["expenses"],
    permission: "expenses.manage",
    screen: "/tenant/cashbook",
    keywords: ["cash book", "daily", "summary", "in and out", "profit"],
    body: [
      { type: "p", text: "Money in against money out, by day, week, month or year. Sales are counted automatically — you never type a sale here." },
      {
        type: "warn",
        text: "The Cashbook is money BOOKED across every payment type — cash, card, credit. It is not the cash drawer. A shop that took Rs 50,000 on card has Rs 50,000 in the Cashbook and nothing extra in the till, and both numbers are correct. For physical cash at the counter, use the shift close on the POS.",
      },
    ],
  },
  {
    id: "ledger",
    title: "Ledger — what the Ledger actually is",
    summary: "Every movement in date order, with the balance carried down.",
    group: "Money",
    modules: ["expenses"],
    permission: "expenses.manage",
    screen: "/tenant/ledger",
    keywords: ["ledger", "khata", "balance", "statement", "book", "entries"],
    body: [
      {
        type: "h", text: "Cashbook vs Ledger",
      },
      {
        type: "p",
        text: "The Cashbook tells you a day came to Rs 80,000. The Ledger tells you what made it up: every movement, in date order, with a running balance carried down the page — the way a paper book has always worked.",
      },
      { type: "h", text: "The five kinds of row" },
      { type: "p", text: "There are five kinds of row, and each is a genuinely different source of money:" },
      {
        type: "table",
        head: ["Row", "Direction", "What it is"],
        rows: [
          ["Sale", "in", "Something you sold"],
          ["Income", "in", "Money in that is not a sale — rent received, owner investment"],
          ["Expense", "out", "A bill you paid"],
          ["Refund", "out", "Money handed back to a customer"],
          ["Supplier paid", "out", "Paying your wholesaler"],
        ],
      },
      { type: "p", text: "Filter by kind, category, payment method, amount range or date — then export exactly what you filtered. What you hand your accountant is what you were looking at." },
    ],
  },
  {
    id: "expenses",
    title: "Expenses",
    summary: "Filing a bill, recurring costs, budgets and receipts.",
    group: "Money",
    modules: ["expenses"],
    permission: "expenses.manage",
    screen: "/tenant/expenses",
    keywords: ["expense", "bill", "spend", "rent", "salary", "budget", "recurring", "receipt"],
    body: [
      { type: "h", text: "Filing a bill" },
      { type: "p", text: "Expenses → + Add expense. Date, category, amount, how it was paid, and who it was paid to." },
      {
        type: "list",
        items: [
          "Paid to takes a supplier where you have one, or a plain name where you do not — a landlord is not a supplier, and neither is the electricity board.",
          "Cash expenses move the drawer. Every other payment method does not.",
          "Attach a photo of the bill. It is private, and is only ever served to someone who could already read the row.",
        ],
      },
      { type: "h", text: "Recurring, budgets and categories" },
      { type: "p", text: "Three more tabs on the same screen:" },
      {
        type: "table",
        head: ["Tab", "What it does"],
        rows: [
          ["Recurring", "Rent, salaries, the internet bill — posts itself on schedule, and a posted row is marked so you can tell it from one you typed."],
          ["Budgets", "A ceiling per category per month, warning you when you go past it."],
          ["Categories", "Your own vocabulary, seeded from your business type."],
        ],
      },
    ],
  },
  {
    id: "income",
    title: "Income",
    summary: "Money in that is not a sale.",
    group: "Money",
    modules: ["expenses"],
    permission: "expenses.manage",
    screen: "/tenant/income",
    keywords: ["income", "rent received", "investment", "other income"],
    body: [
      { type: "p", text: "Rent received, owner investment, a refund from a supplier — anything that brought money in without being a sale." },
      {
        type: "warn",
        text: "Do not enter sales here. They are already counted from the sales themselves, and typing them again doubles your month.",
      },
      {
        type: "warn",
        text: "Pick the payment method carefully. Cash income puts money into whatever drawer is open — so recording a bank transfer as cash hands that cashier an overage they cannot explain.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "The dashboard",
    summary: "What the numbers on your home screen mean.",
    group: "Start here",
    screen: "/tenant",
    keywords: ["home", "dashboard", "today", "profit", "kpi", "alerts"],
    body: [
      { type: "h", text: "Today's figures" },
      { type: "p", text: "Everything on the dashboard is for TODAY unless it says otherwise, and each figure is compared against yesterday. A percentage is only shown when yesterday had something to compare against — on your first day there is no honest percentage, so none is printed." },
      {
        type: "table",
        head: ["Figure", "What it counts"],
        rows: [
          ["Revenue", "What you sold today"],
          ["Other income", "Money in that was not a sale — shown separately so you can still see what you SOLD"],
          ["Expenses", "What you spent today"],
          ["Profit", "Revenue + other income − the cost of what you sold − expenses"],
          ["Customers", "Buyers served, not tickets rung — one person who came back twice counts once"],
        ],
      },
      { type: "h", text: "What it shows you only when it matters" },
      { type: "p", text: "Low stock, near-expiry batches, pending orders and unbanked cash appear as alerts when there is something to act on, and stay out of the way when there is not." },
      { type: "note", text: "Only the parts your shop has are calculated at all. A books-only business is not shown an empty sales chart — it is not shown one." },
    ],
  },
  {
    id: "sales",
    title: "The sales ledger",
    summary: "Finding a past sale, reprinting a receipt, refunds and returns.",
    group: "Selling",
    modules: ["pos", "marketplace"],
    permission: "sales.manage",
    screen: "/tenant/sales",
    keywords: ["sale", "invoice", "receipt", "reprint", "return", "refund", "void", "exchange", "history"],
    body: [
      { type: "h", text: "Finding a sale" },
      { type: "p", text: "Every completed sale, newest first. Search by receipt number, customer or amount, and filter by date, payment method or who rang it." },
      { type: "p", text: "Open a sale to see its lines, what was paid and how, and to reprint the receipt." },
      { type: "h", text: "Undoing a sale" },
      {
        type: "table",
        head: ["Action", "What it does", "Who can"],
        rows: [
          ["Reprint", "Prints the receipt again. Changes nothing.", "Anyone at the till"],
          ["Return", "Some lines come back. Stock returns, money goes back for those lines only.", "Refund permission"],
          ["Exchange", "A return and a new sale in one movement, so the difference is settled once.", "Refund permission"],
          ["Void", "Cancels the WHOLE sale. Stock returns and the money is reversed.", "Void permission"],
        ],
      },
      {
        type: "warn",
        text: "Void and refund are deliberately not in the cashier job. They are the two actions that move money back out of the till, and they belong with whoever is answerable for the drawer.",
      },
      { type: "note", text: "Nothing is ever deleted. A voided sale stays on the ledger marked as voided, because a receipt a customer is holding must always be findable." },
    ],
  },
  {
    id: "documents",
    title: "Quotes & advances",
    summary: "A price you have quoted, and money taken before the goods go out.",
    group: "Selling",
    modules: ["pos"],
    permission: "sales.manage",
    screen: "/tenant/documents",
    keywords: ["quote", "quotation", "advance", "booking", "deposit", "estimate", "proforma"],
    body: [
      { type: "h", text: "The two kinds" },
      {
        type: "table",
        head: ["", "What it is", "Money"],
        rows: [
          ["Quote", "A price given to a customer who has not decided yet.", "None taken"],
          ["Advance", "Goods promised, with a deposit paid now.", "Taken and held against the order"],
        ],
      },
      { type: "h", text: "How they work" },
      {
        type: "steps",
        items: [
          "Build the ticket at the till as normal.",
          "Press F7 and save it as a quote or an advance instead of selling.",
          "When the customer comes back, open it from this screen and convert it to a sale.",
          "An advance's deposit is already counted, so only the balance is collected.",
        ],
      },
      {
        type: "warn",
        text: "An advance is a customer's money you are holding. It sits with the daily screens rather than in a reports folder for exactly that reason — you should see it every day until it is settled.",
      },
    ],
  },
  {
    id: "branches",
    title: "Branches",
    summary: "More than one location — separate stock, one business.",
    group: "People & setup",
    permission: "settings.manage",
    screen: "/tenant/branches",
    keywords: ["branch", "location", "shop", "outlet", "multi", "transfer", "warehouse"],
    body: [
      { type: "h", text: "What a branch is" },
      { type: "p", text: "A second address. Every shop starts with one branch called Main, and you never have to think about branches until you open another." },
      { type: "p", text: "Each branch holds its OWN stock, its own till drawers and its own takings. The catalog, customers and suppliers are shared — a product is one product wherever it sits." },
      { type: "h", text: "Working across branches" },
      {
        type: "list",
        items: [
          "Staff are assigned to a branch and see that branch's figures.",
          "As the owner you can switch to an all-branches view, where the numbers are the whole business added up.",
          "Transfers move stock from one branch to another; it leaves one and arrives at the other, and both sides are recorded.",
          "You can look up whether another branch has something in stock before telling a customer no.",
        ],
      },
      { type: "note", text: "Every figure on every money screen respects the branch you are looking at. Switching to all-branches changes the numbers because it is genuinely a different question." },
    ],
  },
  {
    id: "coupons",
    title: "Coupons & promotions",
    summary: "Discount codes, and offers that apply themselves.",
    group: "Selling",
    permission: "coupons.manage",
    screen: "/tenant/coupons",
    keywords: ["coupon", "promo", "discount", "offer", "code", "bogo", "buy one get one", "deal"],
    body: [
      { type: "h", text: "Coupons — the customer types a code" },
      { type: "p", text: "A code the customer gives you at the till. Set what it takes off (an amount or a percentage), when it is valid, how many times it can be used, and the smallest basket it works on." },
      { type: "h", text: "Promotions — they apply themselves" },
      { type: "p", text: "No code. The offer applies whenever the basket qualifies — buy one get one, a percentage off a category, a price break at a quantity." },
      { type: "note", text: "Both are checked by the server when the sale is rung, so an expired coupon cannot be made to work by anyone at the counter." },
    ],
  },
  {
    id: "reservations",
    title: "Reservations",
    summary: "Holding stock for a customer who is coming back for it.",
    group: "Selling",
    modules: ["reservations"],
    permission: "reservations.manage",
    screen: "/tenant/reservations",
    keywords: ["reserve", "hold", "booking", "layaway", "set aside"],
    body: [
      { type: "p", text: "A customer asks you to keep something. The stock is set aside so it cannot be sold to somebody else, and the reservation expires on its own if they do not come back." },
      { type: "p", text: "Confirm it to turn it into a sale, or let it lapse and the stock returns to the shelf." },
      { type: "warn", text: "This is holding STOCK, not booking an appointment. ShopOS does not do appointment booking." },
    ],
  },
  {
    id: "online-shop",
    title: "Your online shop",
    summary: "What customers see, your portfolio, and replying to reviews.",
    group: "Selling",
    modules: ["marketplace"],
    permission: "settings.manage",
    screen: "/tenant/portfolio",
    keywords: ["online", "storefront", "marketplace", "portfolio", "review", "rating", "reply", "listing"],
    body: [
      { type: "h", text: "Getting listed" },
      { type: "p", text: "Your shop appears to customers once your setup is complete, your city is set and the online module is on. Products need a photo — an online customer must be able to see what they are buying." },
      { type: "h", text: "Portfolio and reviews" },
      {
        type: "list",
        items: [
          "Portfolio — photos of your work or your shop, shown on your storefront page.",
          "Reviews — what customers said. Replying is the only thing anyone does here, and a reply is public.",
        ],
      },
      { type: "note", text: "Collections are the shelves of your online shop. Group products into them to give shoppers something to browse." },
    ],
  },
  {
    id: "riders",
    title: "Riders",
    summary: "Your delivery people, and assigning an order to one.",
    group: "Selling",
    modules: ["delivery"],
    permission: "orders.manage",
    screen: "/tenant/riders",
    keywords: ["rider", "delivery", "driver", "dispatch", "assign"],
    body: [
      { type: "p", text: "The people who take orders out. Add them here, then assign an order to one when it is ready to leave." },
      { type: "p", text: "Cash collected on delivery is recorded when the rider hands it in, not when the order was placed." },
    ],
  },
  {
    id: "labels",
    title: "Shelf labels & barcodes",
    summary: "Printing price labels and barcode stickers.",
    group: "Catalog & stock",
    modules: ["products"],
    permission: "products.manage",
    screen: "/tenant/labels",
    keywords: ["label", "barcode", "sticker", "print", "shelf", "price tag"],
    body: [
      { type: "p", text: "Pick the products, pick a label size, print. The price on the label is read from the catalog record, so a label and the till can never disagree." },
      { type: "note", text: "Reprint labels after a price change. The system knows the new price; the sticker on the shelf does not." },
    ],
  },
  {
    id: "vehicles",
    title: "Vehicles",
    summary: "Finding a customer by number plate, and a vehicle's history.",
    group: "Money",
    modules: ["products", "services"],
    trades: ["automotive"],
    permission: "customers.manage",
    screen: "/tenant/vehicles",
    keywords: ["vehicle", "car", "plate", "registration", "odometer", "service history"],
    body: [
      { type: "p", text: "A vehicle belongs to a customer, because the number plate is how a workshop actually finds a person." },
      { type: "p", text: "Every job done on that vehicle stays with it, with the odometer reading at the time — so when it comes back you can see what was done and when." },
    ],
  },
  {
    id: "fuel-deliveries",
    title: "Tanker deliveries & rate changes",
    summary: "Booking a fuel delivery, and changing the pump price.",
    group: "Selling",
    modules: ["fuel"],
    trades: ["petroleum"],
    permission: "purchases.manage",
    screen: "/tenant/fuel/deliveries",
    keywords: ["tanker", "delivery", "rate", "price change", "fuel price", "dip"],
    body: [
      { type: "h", text: "A tanker arrives" },
      { type: "p", text: "Record the delivery against the tank: what was ordered, what the dip says arrived, and what it cost. Fuel stock rises by what actually went in, not by what the invoice claimed." },
      { type: "h", text: "The rate changes" },
      {
        type: "warn",
        text: "Record a rate change at the moment it takes effect. Every sale is priced at the rate in force when it was rung, so a change entered late prices the wrong litres — and on a forecourt that is the difference between a clean shift and an unexplainable one.",
      },
    ],
  },
  {
    id: "subscription",
    title: "Your subscription",
    summary: "What you pay, when it renews, and what happens if it lapses.",
    group: "People & setup",
    screen: "/tenant/subscription",
    keywords: ["subscription", "plan", "billing", "renew", "expiry", "payment", "invoice"],
    body: [
      { type: "p", text: "Your plan, what it costs, and the date it runs to. Payments you have made are listed underneath." },
      { type: "h", text: "If the date passes" },
      {
        type: "table",
        head: ["", "What happens"],
        rows: [
          ["Grace period", "Everything keeps working, with a warning. The length depends on your plan."],
          ["After grace", "The shop becomes read-only — you can still see everything, but nothing new can be entered."],
        ],
      },
      {
        type: "note",
        text: "Your data is never deleted. Renewing restores everything exactly as it was, immediately.",
      },
    ],
  },
  {
    id: "setup",
    title: "First-time setup",
    summary: "The wizard that runs once, before anything else works.",
    group: "Start here",
    parent: "first-week",
    screen: "/tenant/setup",
    keywords: ["setup", "wizard", "onboarding", "city", "address", "first time"],
    body: [
      { type: "p", text: "A new shop lands here and cannot go anywhere else until it is finished. That is deliberate — a shop with no city cannot be found, and one with no address cannot print a receipt." },
      { type: "steps", items: [
        "Confirm your business name.",
        "Pick your city, and drop your shop on the map.",
        "Set your currency and tax default.",
        "Done — you land on the dashboard and everything unlocks.",
      ]},
      { type: "note", text: "Your business TYPE is not here. It is set when your account is created and decides which modules you have; it is not something to change later by accident." },
    ],
  },
  {
    id: "products-new",
    title: "Adding a product",
    summary: "The four tabs, and which ones you can skip.",
    group: "Catalog & stock",
    parent: "products",
    modules: ["products", "services"],
    permission: "products.manage",
    screen: "/tenant/products/new",
    keywords: ["new product", "create", "add item", "tabs"],
    body: [
      { type: "p", text: "Reached from Products → + Add product, not from the menu." },
      { type: "list", items: [
        "Details — the only tab you must fill in. Name, category, price.",
        "Media & online — photos and description. Only if you sell online or use images.",
        "Variants & options — sizes and colours, or add-ons that change the price.",
        "Codes & packs — extra barcodes, and selling the same thing by piece or carton.",
      ]},
      { type: "note", text: "Save from the first tab and come back later. A half-filled product is more useful than one you never finished." },
    ],
  },
  {
    id: "collections",
    title: "Collections",
    summary: "Shelves you invent, for the online shop.",
    group: "Catalog & stock",
    parent: "categories-collections",
    modules: ["marketplace"],
    permission: "products.manage",
    screen: "/tenant/collections",
    keywords: ["collection", "group", "featured", "online shelf"],
    body: [
      { type: "p", text: "A collection is a group you made up for selling — \"Ramadan deals\", \"New arrivals\". A product can be in as many as you like." },
      { type: "p", text: "They only appear on your online shop. If you do not sell online, you do not need them." },
    ],
  },
  {
    id: "labels-sub",
    title: "Shelf labels",
    summary: "Printing price labels and barcode stickers.",
    group: "Catalog & stock",
    parent: "products",
    modules: ["products"],
    permission: "products.manage",
    screen: "/tenant/labels",
    keywords: ["label", "sticker", "price tag", "print barcode"],
    body: [
      { type: "p", text: "Pick products, pick a size, print. The price comes from the catalog, so a label and the till cannot disagree." },
      { type: "warn", text: "Reprint after a price change. The system knows the new price; the sticker on the shelf does not." },
    ],
  },
  {
    id: "stocktake",
    title: "Stock count",
    summary: "Counting a shelf and posting the difference.",
    group: "Catalog & stock",
    parent: "inventory",
    modules: ["inventory"],
    permission: "inventory.manage",
    screen: "/tenant/stocktake",
    keywords: ["stock count", "stocktake", "audit", "shelf count", "shrinkage", "variance"],
    body: [
      { type: "steps", items: [
        "Start a count — for the whole shop or one category.",
        "Print the sheet, or count straight onto a phone.",
        "Enter what is actually on the shelf.",
        "Post it. The difference becomes its own stock movement.",
      ]},
      { type: "warn", text: "A count never silently overwrites. The gap between what the system thought and what you counted is recorded as a correction, so a month later you can still see it happened and how big it was." },
    ],
  },
  {
    id: "transfers",
    title: "Transfers",
    summary: "Moving stock between your branches.",
    group: "Catalog & stock",
    parent: "inventory",
    modules: ["inventory"],
    permission: "inventory.manage",
    screen: "/tenant/transfers",
    keywords: ["transfer", "move stock", "branch", "send", "receive"],
    body: [
      { type: "p", text: "Stock leaves one branch and arrives at the other. Both sides are recorded, so neither branch's count is ever quietly wrong." },
      { type: "note", text: "Only useful if you have more than one branch." },
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    summary: "Your vendor directory, and what you owe each one.",
    group: "Catalog & stock",
    parent: "purchases",
    modules: ["inventory", "products"],
    permission: "suppliers.manage",
    screen: "/tenant/suppliers",
    keywords: ["supplier", "vendor", "wholesaler", "payable", "owe", "balance"],
    body: [
      { type: "p", text: "Who you buy from, their contact details, and the running balance you owe them." },
      { type: "p", text: "Record what you pay them here. It shows in the Ledger as its own kind of money-out — not an expense, or a shop that also files the wholesaler's bill would count the same rupees twice." },
      { type: "note", text: "Naming who a delivery came from is stockroom work; editing the directory is not. They are separate permissions on purpose." },
    ],
  },
  {
    id: "promotions",
    title: "Promotions",
    summary: "Offers that apply themselves, with no code.",
    group: "Selling",
    parent: "coupons",
    permission: "coupons.manage",
    screen: "/tenant/promotions",
    keywords: ["promotion", "bogo", "buy one get one", "offer", "automatic discount"],
    body: [
      { type: "p", text: "No code to type. The offer applies whenever the basket qualifies — buy one get one, a percentage off a category, a price break at a quantity." },
      { type: "note", text: "Checked by the server as the sale is rung, so nobody at the counter can make an expired offer work." },
    ],
  },
  {
    id: "reviews",
    title: "Reviews",
    summary: "What customers said, and replying to it.",
    group: "Selling",
    parent: "online-shop",
    modules: ["marketplace"],
    permission: "settings.manage",
    screen: "/tenant/reviews",
    keywords: ["review", "rating", "feedback", "reply", "star"],
    body: [
      { type: "p", text: "Ratings and comments customers left on your shop. Replying is the only action here." },
      { type: "warn", text: "A reply is public and permanent. Everyone reading the review will read your answer too." },
    ],
  },
  {
    id: "sales-new",
    title: "Writing a sale by hand",
    summary: "A sale without the till — for an invoice or a phone order.",
    group: "Selling",
    parent: "sales",
    modules: ["pos", "marketplace"],
    permission: "sales.manage",
    screen: "/tenant/sales/new",
    keywords: ["manual sale", "invoice", "new sale", "phone order", "credit sale"],
    body: [
      { type: "p", text: "Reached from the Sales screen rather than the menu. The same sale the till makes, entered by hand — for an order taken on the phone, or an invoice for a trade customer." },
      { type: "note", text: "It does not need an open shift, because no drawer is involved unless you take cash." },
    ],
  },
  {
    id: "fuel-setup",
    title: "Tanks, pumps & nozzles",
    summary: "The plant. Set up once, then left alone.",
    group: "Selling",
    parent: "forecourt",
    modules: ["fuel"],
    trades: ["petroleum"],
    permission: "settings.manage",
    screen: "/tenant/fuel/setup",
    keywords: ["tank", "pump", "nozzle", "capacity", "plant", "equipment"],
    body: [
      { type: "p", text: "Which tanks you have and what is in them; which pumps draw from which tank; which nozzle sells which fuel." },
      { type: "warn", text: "Get this right before the first shift. Every meter reading, dip and variance is calculated against this layout, and changing it later does not re-explain shifts already closed." },
    ],
  },
  {
    id: "hardware",
    title: "Printers, drawers & scales",
    summary: "Connecting the equipment on your counter.",
    group: "People & setup",
    parent: "settings",
    permission: "settings.manage",
    screen: "/tenant/settings",
    keywords: ["printer", "receipt printer", "cash drawer", "scale", "weighing", "hardware", "device"],
    body: [
      { type: "p", text: "Shop settings → Hardware. Register each device once per till, and set your receipt width (58mm or 80mm) so receipts are not cut off." },
      { type: "list", items: [
        "Receipt printer — prints the receipt after a sale.",
        "Cash drawer — opens when a cash sale completes.",
        "Weighing scale — for anything sold by weight.",
      ]},
    ],
  },
  {
    id: "customers",
    title: "Customers & credit (khata)",
    summary: "Who owes you what, and loyalty points.",
    group: "Money",
    permission: "customers.manage",
    screen: "/tenant/customers",
    keywords: ["customer", "khata", "credit", "udhaar", "owes", "loyalty", "points", "statement"],
    body: [
      { type: "p", text: "Names, numbers, and what each one owes. Selling on credit puts the balance on the customer's account; take payment against it later, and the statement shows every line." },
      { type: "p", text: "Loyalty points earn on sales and are redeemed at the till." },
      { type: "note", text: "A credit sale needs a named customer — you cannot put a balance on nobody." },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    summary: "Sales by product, category, customer and staff — and profit.",
    group: "Money",
    permission: "reports.view",
    screen: "/tenant/reports",
    keywords: ["report", "profit", "best seller", "analysis"],
    body: [
      { type: "p", text: "What sold, who bought it, and who sold it." },
      { type: "p", text: "Profit is takings, plus other income, minus the cost of what was sold, minus expenses." },
    ],
  },

  // ── People & setup ────────────────────────────────────────────────
  {
    id: "staff",
    title: "Staff & what each job can see",
    summary: "Adding people, and picking the job that ticks the right boxes.",
    group: "People & setup",
    permission: "staff.manage",
    screen: "/tenant/staff",
    keywords: ["staff", "permission", "role", "cashier", "waiter", "kitchen", "job", "access"],
    body: [
      {
        type: "h", text: "How permissions work",
      },
      {
        type: "p",
        text: "There are no fixed roles. Each person has a list of permissions, and a JOB is a button that ticks the right boxes so you never have to know which of nineteen checkboxes makes a cashier.",
      },
      { type: "p", text: "Staff → Add staff → pick the job → save. You can change any box afterwards." },
      { type: "h", text: "What each job gets" },
      { type: "p", text: "The jobs offered are already filtered to your shop — you will not be offered Waiter unless you have tables, or Pharmacist unless you are a pharmacy." },
      {
        type: "table",
        head: ["Job", "Gets", "Does not get"],
        rows: [
          ["Cashier", "The till, and can settle any waiter's table", "Voiding a sale, refunds"],
          ["Shift supervisor", "Everything a cashier does, plus void, refund and discount override", "Staff, shop settings"],
          ["Waiter", "The floor — their OWN tables only", "Other waiters' tables, the takings"],
          ["Kitchen", "The kitchen board only", "The till, sales, money — everything else"],
          ["Stock keeper", "Receiving, counting, the catalog", "The till, money"],
          ["Purchasing", "Suppliers and purchase orders", "The till"],
          ["Accounts", "Money in and out, reports", "Selling, stock"],
          ["Manager", "The shop day to day", "Staff and shop settings — those stay yours"],
        ],
      },
      {
        type: "note",
        text: "A job is a starting point and is then forgotten. Changing what 'Cashier' means next month does not change anyone you hired last month — which is deliberate, because silently re-permissioning your existing staff would be a nasty surprise.",
      },
      { type: "h", text: "Who can see what you paid" },
      {
        type: "p",
        text: "The buying price of an item is hidden from anyone whose job does not need it — on the till grid, on a product page, and anywhere else it would otherwise appear. It is the one number a competitor, or somebody leaving, would most like to walk out with.",
      },
      {
        type: "table",
        head: ["Job", "Sees what you paid?"],
        rows: [
          ["Cashier", "No"],
          ["Waiter", "No"],
          ["Kitchen", "No"],
          ["Shift supervisor", "Yes — it reads the shop's reports"],
          ["Stock keeper, Purchasing, Pharmacist", "Yes — cannot price or receive stock without it"],
          ["Accounts, Manager", "Yes"],
        ],
      },
      {
        type: "note",
        text: "The WHOLESALE price is a different thing and stays visible at the till: it is what you charge a trade customer, not what you paid. A cashier has to see it to sell at wholesale.",
      },
      {
        type: "warn",
        text: "Two permissions are never in any job: Staff and Shop settings. A manager runs the shop; you decide who works in it and how it is set up. Tick them by hand only if you mean it.",
      },
    ],
  },
  {
    id: "settings",
    title: "Shop settings",
    summary: "Everything that describes your business rather than what happens in it.",
    group: "People & setup",
    permission: "settings.manage",
    screen: "/tenant/settings",
    keywords: ["settings", "logo", "tax", "receipt", "invoice", "hours", "branch", "printer", "theme"],
    body: [
      {
        type: "list",
        items: [
          "Name, logo, address and map location",
          "Currency and your default tax rate",
          "Receipt and invoice layout, with a live preview as you change it",
          "Your discount ceiling — how far a cashier may go without a supervisor",
          "Business hours",
          "Branches, if you have more than one location",
          "Hardware — printers, cash drawers, weighing scales",
          "Theme colours",
        ],
      },
    ],
  },
  {
    id: "password",
    title: "Changing your password",
    summary: "Your own account, and what happens to your other devices.",
    group: "People & setup",
    screen: "/tenant/security",
    keywords: ["password", "security", "login", "forgot", "locked out", "account"],
    body: [
      { type: "p", text: "The avatar menu, top right → Security." },
      { type: "p", text: "Changing your password keeps you signed in on this device and signs you out everywhere else." },
      {
        type: "note",
        text: "Locked out entirely, with no access to the phone or email on the account? Ask us — an administrator can set a new password for the shop owner, which signs out every device on that account.",
      },
    ],
  },
];

/** The order groups appear in the rail. */
export const HELP_GROUPS = [
  "Start here",
  "Selling",
  "Catalog & stock",
  "Money",
  "People & setup",
] as const;

/**
 * The articles this shop and this person should be offered.
 *
 * Mirrors the three axes the sidebar uses. `can` is passed in rather than read
 * here so the caller decides what "may open" means — the page hands it the
 * auth store's own check, which already treats a shop owner as holding
 * everything.
 */
export function articlesFor(
  features: Record<string, boolean> | undefined,
  trade: string | null | undefined,
  can: (permission: string) => boolean,
): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => {
    if (a.trades && (!trade || !a.trades.includes(trade))) return false;

    // ANY of the listed modules, matching `feature:a,b` on the server. A
    // missing key reads as OFF — a business type that does not offer a module
    // omits the key entirely.
    if (a.modules && !a.modules.some((m) => features?.[m])) return false;

    if (a.permission && !can(a.permission)) return false;

    return true;
  });
}

/** Free-text search across title, summary and the extra keywords. */
export function searchArticles(articles: HelpArticle[], query: string): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (q === "") return articles;

  return articles.filter((a) =>
    [a.title, a.summary, ...(a.keywords ?? [])].some((s) => s.toLowerCase().includes(q)),
  );
}
