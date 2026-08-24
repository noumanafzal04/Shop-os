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
    title: "How CartZe fits together",
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
      { type: "h", text: "Simple and Full view" },
      {
        type: "p",
        text: "At the bottom of the menu is a Simple / Full view switch. This one is not a gate — it changes how much of the SAME shop is on screen, never what the shop is. Nothing appears in Simple that Full withholds.",
      },
      {
        type: "p",
        text: "Simple keeps the screens your trade's day actually runs on, which is not the same list for everybody: a restaurant keeps the kitchen pass, a workshop keeps its job board, a chemist keeps the dispensing register, a filling station keeps the forecourt. Full view adds everything else your shop has — reports, staff, suppliers, coupons, the record of who changed what.",
      },
      {
        type: "note",
        text: "If a screen has gone missing, check this switch before anything else. It is the one reason a screen can vanish that has nothing to do with modules, trade or permissions.",
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
          "Tab 2 — Media & online: photos, and which collections it belongs to.",
          "Tab 3 — Sizes & options: the same product in sizes or colours (each with its own price and stock), or add-ons like 'extra cheese' that change the price. Name what varies — Size, Colour — list the values, and every combination is made for you, priced in one go.",
          "Tab 4 — Codes & packs: extra barcodes for the same product, and pack sizes — sell as a piece, a dozen or a carton while stock is held in the base unit. 'Still selling this' is at the bottom of it.",
        ],
      },
      { type: "h", text: "Stopping an item without losing its history" },
      { type: "p", text: "Codes & packs → turn OFF 'Still selling this'. The item leaves the till and your online shop, but stays in the catalog marked Inactive, and every past sale still points at it. Turn it back on whenever you stock it again." },
      {
        type: "note",
        text: "Use that rather than Delete for anything you have ever sold. Deleting removes the item its old receipts and reports refer to; switching it off keeps the record and simply stops it being sold.",
      },
      {
        type: "note",
        text: "Editing a product never changes its stock. That is deliberate: stock moves for a reason — a sale, a delivery, a count — and every movement is recorded.",
      },
      { type: "h", text: "Selling the same item in sizes and colours" },
      { type: "p", text: "A shirt in three colours and four sizes. A pizza in Small, Medium and Large. A drink in 500ml and 1 litre. On the item form, open Sizes & options and name what varies — then list the values, and the combinations are made for you." },
      {
        type: "steps",
        items: [
          "Press 'Add sizes or colours' and name what varies — Colour, Size, Volume, Strength, whatever your trade calls it. The form suggests the ones shops like yours use.",
          "Type the values. One per press of Enter, or paste them all at once: Red, Blue, Black.",
          "For common ones — S/M/L, 500ml, 250mg — tap the suggestion instead of typing.",
          "Add a second one if you need it. Three colours and four sizes makes twelve rows, and you did not type any of them.",
          "Fill 'Same price for all', press Apply to all, then change only the rows that differ.",
        ],
      },
      { type: "keys", items: [
        ["Its own price", "A size's price replaces the item's price — it is not an amount added on top. Large at 900 means 900."],
        ["Its own stock", "Selling a Large takes one off Large. The item's own stock figure stops being used the moment it has sizes, and every count you see is the sizes added together."],
        ["Its own code", "Whatever you put in the Code column is what a scanner reads. If each size has its own barcode, put it there and scanning goes straight to that size."],
        ["Changing your mind", "Open the item again and the grid comes back exactly as you built it. Correct a price, add a colour, or remove a combination you never stocked."],
        ["Removing a size", "It is retired, never erased. Sales that already went out keep it, so last month's figures do not change under you."],
      ]},
      { type: "warn", text: "One size must always stay switched on. An item with sizes has no price of its own, so an item with none of them left would sit on the till looking available and refuse every tap." },
      { type: "note", text: "Sizes or add-ons? A size is a different THING on your shelf — it has its own stock and its own code, like a large bottle beside a small one. An add-on (extra cheese, no ice) changes the price of the same thing and counts nothing. A cooked dish's half and full portion can be either; if you count portions in stock, make them sizes." },
      { type: "note", text: "An existing size's quantity is changed in Inventory, not here — that way every unit that moves is written down and your counts stay explainable." },

      { type: "h", text: "Cost keeps itself up to date" },
      { type: "p", text: "Type a cost when you first add an item. After that, every delivery you receive on a purchase order corrects it for you — you never have to remember to edit it when your wholesaler's rate moves." },
      { type: "p", text: "It is blended, not replaced. Forty kilos already on the shelf at Rs 140 plus sixty new at Rs 160 makes the cost Rs 152, because that is what the stock you are holding actually cost you. As the old stock sells through, the figure settles on what you are paying now." },
      { type: "warn", text: "This is the figure every profit and margin report is built on. Before it, a cost typed in March was still being used in December — and the reports quietly told shopkeepers they were earning far more than they were." },
      { type: "h", text: "What a dish costs to make" },
      { type: "p", text: "For anything you buy in, Cost is what you paid — type it once and it stays true. A cooked dish has no such number: it costs half a kilo of chicken, some onions and oil, and those prices move every week." },
      { type: "p", text: "So a dish with a recipe costs itself. Put a cost price on each ingredient and the recipe section shows what one portion costs and your food cost percentage — the ratio a kitchen is actually run on. Around 30% is healthy here; past 50% the dish is losing money while looking busy." },
      { type: "warn", text: "If any ingredient has no cost price, the dish says it cannot be costed and names which ones — rather than showing a smaller figure. A part-costed dish looks more profitable than it is, and that is how a menu gets underpriced." },
      { type: "note", text: "This is also what your Margins report uses, so fixing an ingredient's cost corrects every report that dish appears in. The figure on the form refreshes when you save and reopen." },
      { type: "note", text: "The ingredient list — and the item list on a deal — offers your WHOLE catalog, not the first screenful. Start typing while the dropdown is open and it jumps to what you want." },
      { type: "h", text: "If you have more than one branch" },
      { type: "p", text: "Sold out is about ONE kitchen. Marking something off at Gulberg leaves DHA selling it, because DHA still has a tray of it — a branch runs out, a chain does not. The sheet names the branch you are marking so there is no doubt which evening you are describing." },
      { type: "note", text: "Putting it back is the same: one press puts it back where you pressed it, and nowhere else. Each branch's kitchen keeps its own list." },
      { type: "warn", text: "Your online shop answers from your MAIN branch, because that is where an online order takes its stock from. If Main has run out, the online shop says sold out even when another branch has some. Until an order can say which branch is making it, your online shop is your main branch's shop." },
      { type: "h", text: "When a Large uses more than a Small" },
      { type: "p", text: "If your dish comes in sizes, each ingredient line can say which size it is for. Leave it on \"Every size\" and the line applies to all of them — that is how every recipe worked before, and nothing you have already written needs changing." },
      { type: "p", text: "Set a line to \"Large only\" and the Large is made from those lines instead: they replace the every-size lines for that size, they do not add to them. That is how a chef writes it down — a Large uses more of the same flour, not extra flour on top of the Small's." },
      { type: "note", text: "A size you never spell out keeps using the every-size lines, so you only have to describe the sizes that are genuinely different." },
      { type: "warn", text: "Before this, one recipe served every size: a Small and a Large both took the same flour out of stock, and your food cost was right for one of them at most. If your dish has sizes and no line names one, the save tells you so." },
      { type: "note", text: "The size choice appears once the dish is saved — a size still being typed into the grid does not exist yet for a recipe line to point at." },
      { type: "h", text: "A deal that contains something with sizes" },
      { type: "p", text: "If an item in your deal comes in sizes, a second box appears asking which one — a Family Deal has a Large pizza in it, not just \"a pizza\". Selling the deal then takes that size off the shelf and nothing else." },
      { type: "warn", text: "The deal will not save until you answer it, and that is deliberate: without a size there is no shelf to take from, and the till used to refuse the sale with \"no stock\" while the shop had twenty. Better asked here, once, than found at the counter." },
      { type: "note", text: "You can put two sizes of one thing in the same deal — two Small and one Large is an ordinary offer. What you cannot do is list the same item AND size twice; add it once with the quantity you mean." },
          { type: "h", text: "Ordering what is running out" },
      { type: "p", text: "The reorder view lists everything at or below the level you set, and next to each one it shows who you last bought it from. Press Order these items and the shop raises the purchase orders for you — one per supplier, because a Monday list usually holds lines from three or four different distributors and a single order containing all of them is not something you can send to anybody." },
      { type: "p", text: "Each order arrives as a DRAFT: the quantity is enough to get you back above your reorder level, and the price is what you last actually paid that supplier — not what your own stock is valued at. Both are starting points. Nothing is placed until you place it." },
      { type: "warn", text: "An item you have never bought before has no supplier to order from, so it is left out and named. Raise its first order by hand and the list will know next time." },
      { type: "h", text: "Sold out for today" },
      { type: "p", text: "A dish or a counter item that does not count its stock — samosas, the daily curry, anything made to order — can be marked sold out from the circle-and-slash button on its row. The till stops offering it at once and refuses it even if a tablet still has the old menu in memory." },
      { type: "p", text: "Your online shop follows the same press. The item stays on the menu marked sold out, so a customer can see you normally have it, and an order for it is refused — the counter and the app never disagree about what you have tonight." },
      { type: "note", text: "This is not the same as switching a product off. Switching off is a catalog change: the item leaves your online shop, your menu and your reports altogether. Sold out is for today — it stays where it is, marked, and one press puts it back when the delivery lands." },
      { type: "note", text: "An order a customer placed BEFORE you pressed it still goes through. Food somebody already committed to has to stay billable — refusing to close a bill because the kitchen has since run out would leave you unable to take money for a meal you already served. Sold out stops new orders, not orders you already have." },
      { type: "p", text: "If the item comes in sizes, the same button asks which one has run out. Marking the Large off leaves Small and Medium selling all evening — a kitchen runs out of large bases, not of pizza, and taking the whole item off used to cost you every other size on your busiest line." },
      { type: "note", text: "\"All of it — take the item off\" is still there at the bottom of that list, because \"no pizza tonight\" is a real sentence and it is not the same one as \"no large\"." },
      { type: "warn", text: "Nothing turns it back on by itself. That is on purpose: an item that un-sold-out overnight while the kitchen still had none puts a customer in front of a dish that never arrives. The row shows how long it has been off, so a forgotten one is easy to spot." },
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
      { type: "h", text: "Putting them in the right order" },
      { type: "p", text: "The order on this screen is the order your till and your storefront show — so the things you sell all day belong at the top. Drag a row by the handle on its left, with a finger on a tablet or the mouse on a desk. A category only ever moves among its own brothers and sisters; it never jumps to another parent." },
      { type: "keys", items: [
        ["Subcategories", "The arrow beside a name opens and closes what is under it. A closed one still tells you how many are inside, so tidying the list never hides the fact that there is more."],
        ["The item count", "Press it to see those items — it opens your product list already filtered to that category."],
        ["Hide", "Takes a category off your storefront and till without deleting it or touching the products in it. Hidden ones stay on this screen with a grey label."],
      ]},
      { type: "note", text: "While you are searching this screen, the order is locked and the drag handles disappear. That is on purpose: dragging a row in a filtered list would renumber the ones the search is hiding, and you would not see it happen." },
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
      { type: "p", text: "You are also told without having to look. Each morning, any lot that has just crossed your expiry window sends the owner a notification, and any lot that has actually expired sends another. A lot speaks exactly twice in its life — once while there is still time to sell it down or agree a return, and once when it can no longer be sold." },
      { type: "note", text: "Twice, and never again, on purpose. A message that arrives every morning saying the same thing stops being read within a week — and then the morning the number changes, nobody notices that either." },
      { type: "note", text: "Press either message and it opens Disposals, which is where you record whether the stock was binned or went back to the supplier. Most notifications work this way now — a low-stock warning opens Inventory, an order update opens Orders. If pressing one does nothing but mark it read, there is no screen on this side for it." },
      { type: "p", text: "How far ahead the first warning looks is your own setting: Settings → Inventory → expiring-soon window. A chemist starts at 90 days, everyone else at 30, and a shop whose distributor works to six months sets it there and stops guessing." },
      { type: "h", text: "How far ahead you are warned" },
      { type: "p", text: "A medical store is warned 90 days ahead; every other shop, 30. That is not a guess: your distributor takes medicine back for credit inside a window that closes months before the printed date, so a warning at thirty days would reach you after the claim was already lost. A bakery warned ninety days ahead is warned about nothing." },
      { type: "note", text: "If your distributor works to six months, set your own number in Settings → POS → Warn about expiry this many days ahead. Clear it and you go back to your trade's default." },
      { type: "h", text: "Taking a lot off the shelf" },
      { type: "p", text: "Every expiring row has a Remove next to it, and it asks one question: where is this going? Binned, or back to the supplier. Those are opposite answers — one is a loss, the other is money somebody owes you — and the shop could not tell them apart until it started asking." },
      {
        type: "steps",
        items: [
          "Inventory → the expiring-stock panel at the top → Remove.",
          "Written off, or Sent back. Then why: expired, damaged, recalled.",
          "If it is going back, name the supplier. Put in the credit you expect if it has been agreed — you can leave it blank and fill it in when the credit note arrives.",
          "The quantity comes out of stock either way.",
        ],
      },
      { type: "note", text: "An empty lot needs no explanation — that is just tidying up a batch number keyed wrong." },
    ],
  },
  {
    id: "disposals",
    title: "Disposals & supplier credit",
    summary: "What expiry cost you, and what your distributor still owes you back.",
    group: "Catalog & stock",
    modules: ["inventory"],
    permission: "inventory.manage",
    screen: "/tenant/disposals",
    keywords: ["write off", "wastage", "expired", "return to supplier", "credit note", "claim", "loss"],
    body: [
      { type: "p", text: "Everything you have taken off the shelf without selling it, in two lists that are never added together." },
      {
        type: "table",
        head: ["Tab", "What it is"],
        rows: [
          ["To claim", "Sent back and not yet credited. This is money you can still get, and only if somebody chases it. Work this list with your distributor's rep."],
          ["Written off", "Binned. Money already gone. Its total is what expiry actually cost you — the number that tells you whether you are over-ordering."],
          ["Everything", "Both, for a full record."],
        ],
      },
      { type: "warn", text: "The two totals are kept apart on purpose. Adding them would give you a loss figure overstated by everything the distributor is about to pay back, and you would price against it." },
      { type: "h", text: "When the credit arrives" },
      {
        type: "steps",
        items: [
          "Disposals → To claim → Credit received, on the right row.",
          "Type what actually came, not what you asked for. A credit note that comes back short is normal.",
          "Add the credit note number if there is one, and it leaves the list.",
        ],
      },
      { type: "warn", text: "A credit is recorded once. The button goes as soon as it is entered, and a second attempt is refused rather than quietly replacing the first — the figure on that row is what you said the distributor actually paid, and it has to stay provable. So check the amount before you save it: there is no editing it afterwards, and the audit log records who entered it and when." },
      { type: "note", text: "A lot with no cost recorded against it is counted but not valued, and the screen says so — because unknown is not the same as zero." },
    ],
  },
  {
    id: "stock-ageing",
    title: "Stock that ages instead of expiring",
    summary: "Tyres, and everything else where the date is an age rather than a deadline.",
    group: "Catalog & stock",
    modules: ["inventory"],
    trades: ["automotive"],
    permission: "inventory.manage",
    screen: "/tenant/inventory",
    keywords: ["dot", "dot code", "sidewall", "tyre", "tire", "age", "ageing", "aging", "old stock", "rubber", "manufactured"],
    body: [
      { type: "p", text: "A tyre has no expiry date and it still gets too old to sell. Rubber ages sitting on a shelf whether or not anyone drives on it, and the only honest answer to how old a tyre is comes off its own sidewall: four digits, week then year. 2224 is week 22 of 2024." },
      { type: "p", text: "Type those four digits into the lot when you book the stock in and the shop works out the age from then on. You never update it — it changes on its own." },
      { type: "warn", text: "An age is not an expiry and is never treated as one. Nothing here is ever blocked from sale. A seven-year-old tyre is a tyre you are entitled to sell, priced accordingly, to a customer who has been told — and blocking that sale would be worse than useless." },
      { type: "h", text: "The oldest set leaves first" },
      { type: "p", text: "When you sell, the oldest lot on the shelf is the one that comes off it — same rule as expiry, only measured from the sidewall week instead of a printed date. That is the whole point of writing the code down: the pallet that arrived on Tuesday should not go out while the 2019 set ages quietly behind it." },
      { type: "note", text: "A lot with no code recorded goes last, not first. \u201cWe don\u2019t know when this was made\u201d is not the same as \u201cit\u2019s new\u201d, and it is not the same as \u201cit\u2019s ancient\u201d either." },
      { type: "h", text: "What the counter is told" },
      { type: "p", text: "Scan a tyre at the till and if the lot it would hand over is past your ageing threshold, the cashier is told so — the lot number and how old it is. It is a line of text, not a refusal: the decision stays with whoever is standing there." },
      { type: "h", text: "The shelf sweep" },
      { type: "p", text: "Inventory shows an Ageing stock panel at the top: every lot past your threshold, oldest first, with what is left on each. That is the list to work from when you decide what to discount, move to another branch, or send back — before a customer reads the sidewall for you." },
      { type: "note", text: "It is deliberately a quieter colour than the expiry panel. Expired stock is money already gone and cannot be sold; an old tyre is saleable stock in the wrong order. Painting them the same red teaches you to ignore both." },
      { type: "h", text: "Where you set the numbers" },
      { type: "p", text: "Settings → POS → Stock ageing, two figures: when a lot starts counting as ageing, and when it counts as old. Out of the box, five years and six — the industry's rough consensus. A fleet contract may hold you to less and a shop in Sukkur has its own view of what a summer does to rubber." },
      { type: "note", text: "Offline, the till sells the tyre without the age line — the same as it does without the expiry line. The sale is correct either way; only the warning needs the server." },
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
      { type: "p", text: "The screen is three parts: the product browser on the left with search and category tabs, the cart on the right, and the total with the pay button running full width along the bottom. A barcode scanner types into the search box and adds the item on Enter." },
      { type: "p", text: "Two buttons beside the search box switch the browser between picture tiles and compact rows. Tiles answer \"which one is it?\", rows answer \"is it in stock, and at what price?\" — a kitchen usually wants the first, a shop with thousands of lines the second. Your shop starts on whichever suits its trade, and the choice is remembered on this device only, so the touchscreen at the counter and the computer in the back office can each be set the way the person using it works." },

      { type: "h", text: "Items that come in sizes" },
      { type: "p", text: "Small, Medium, Large. A 250mg and a 500mg. A half plate and a full plate. If an item was set up with sizes, the till asks which one before it puts anything in the cart — it never guesses, because each size has its own price and its own stock." },
      { type: "keys", items: [
        ["Where it asks", "In a small window, in both views. Tap the item and the sizes come up with their prices — pick one and it goes straight in the cart."],
        ["Reading the tile", "An item with sizes shows \"from\" in front of its price, because the price you see is the cheapest size, not the one you are about to sell."],
        ["A size that has run out", "Still listed, struck through, and cannot be picked. You need to see that it is the LARGE that has gone, not wonder whether you ever stocked one."],
        ["Sizes and extras together", "Size first, then the extras — a large karahi with extra naan is two questions and they have an order."],
        ["Scanning a size", "A size with its own barcode goes straight in — no window, nothing to pick. That is the fastest route and it always was."],
      ]},
      { type: "note", text: "The number beside each size is what is on the shelf AT THIS BRANCH, not across the whole business. A size stacked high at your other shop is not something this counter can hand over." },
      { type: "note", text: "Sizes are set up on the item itself — see Products. You can go back and change a price, add a colour or retire one whenever you need to." },
      { type: "note", text: "It changes nothing but what is drawn. The same products, the same prices, the same search — and an item that is out of stock cannot be added in either view." },
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
      { type: "note", text: "The grey key hints printed on the buttons only appear on a wide screen. On a tablet there are no function keys to press, so the hints stay off — every one of those actions still has a button you can tap." },
      { type: "h", text: "On a phone" },
      { type: "p", text: "A phone shows one half of the till at a time. Products and Cart sit as two buttons across the top: ring items from Products, then tap Cart to check the lines, change a quantity or take one off. The Cart button carries the number of lines, and the Grand Total and Tender button stay on screen the whole time — you never have to go looking for the money." },
      { type: "note", text: "On a phone the cart also drops its Discount and Tax columns and prints those on the item's own line instead, but only where they are not zero. Nothing is hidden: a line with a discount still says so. A tablet keeps the full table." },

      { type: "h", text: "If your shop has tables" },
      { type: "p", text: "A Floor button sits next to Exit at the top of the till. It takes you straight to the tables, the running tabs and the kitchen board without going back through the dashboard. The till itself has no table box — a table's order belongs on the Floor, where it can run a tab, fire to the kitchen and split a bill." },
      { type: "note", text: "A food shop WITHOUT the Dine-in module sees the opposite: a Takeaway / Dine-in switch on the till with a plain table number to type, because a typed number is genuinely all there is to record." },
      { type: "h", text: "Taking payment" },
      { type: "p", text: "Press F9 to take payment. You can split it across cash, card and credit — add a line for each way the customer pays. Cash amounts are suggested in notes that actually exist." },
      {
        type: "warn",
        text: "Prices are decided by the server, never by the browser. That is why a discount past your ceiling needs a supervisor, and why nothing on the page can change what a customer is charged.",
      },
      { type: "note", text: "Your ceiling follows the bill, not the screen. It applies to a line discount on a dine-in tab and to a discount keyed when the tab is settled, exactly as it does at the counter — and it is judged on the whole bill, so ten lines at ten percent are treated as the ten percent they add up to." },
      { type: "h", text: "Served by" },
      { type: "p", text: "If your shop has switched this on, a Served by box sits above the payment methods. Pick the person who actually sold it — which is not necessarily you, if you are the one at the counter. It starts on Nobody and stays there unless you change it." },
      { type: "note", text: "Leaving it on Nobody is fine and is never treated as you. The sale is simply reported as unattributed rather than credited to whoever typed it." },
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
          "Add what they ordered. If a dish comes in sizes, the tab asks which — half or full, small or large — and each one has its own price.",
          "Then any modifiers (extra cheese, no ice). Size first, extras second.",
          "Press Fire. The order appears on the Kitchen board immediately — nobody needs to refresh anything.",
          "The kitchen marks it ready, and your floor screen updates on its own.",
          "Settle: the whole bill, split evenly, or split by item. A partial settlement leaves the rest open on the table.",
        ],
      },
      {
        type: "note",
        text: "A tab belongs to the waiter who opened it. A cashier can settle anyone's tab so payment can be taken at the counter; another waiter cannot, unless you tick 'Serve any table' on them.",
      },
      {
        type: "note",
        text: "The size travels with the order: the kitchen ticket and the kitchen screen both say Half or Full, so nobody cooks the wrong one, and the bill carries it too.",
      },
      {
        type: "warn",
        text: "A dish that is off tonight, or one that has run out, is now marked on the menu grid and cannot be tapped — the kitchen refused it before, but only after a waiter had already promised it to a table.",
      },
      { type: "h", text: "When a table leaves without eating" },
      {
        type: "p",
        text: "Cancel the tab and the kitchen stops being told to cook it. The dockets already fired come off the pass, and the waiting count on your dashboard comes down with them.",
      },
      {
        type: "warn",
        text: "Before this, a cancelled tab left its dockets on the board for good. A cook kept looking at food nobody was going to eat, and the owner's dashboard counted it as work still owed — one more every time anybody cancelled anything, and never coming down.",
      },
      {
        type: "note",
        text: "Anything the kitchen had already sent out stays recorded as served. Cancelling a bill cannot un-cook food, and the kitchen's own record of what it made has to stay true.",
      },
      {
        type: "note",
        text: "Settling works the same way from the board's side: a paid table stops being work on the pass. The dockets themselves are left exactly as the kitchen left them — a bill being paid says nothing about whether anyone pressed Ready.",
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
      { type: "h", text: "Schedule-controlled medicines" },
      { type: "p", text: "Give a medicine a drug schedule on its product page and it becomes prescription-only automatically — you cannot mark something Schedule G and leave the prescription box unticked, because a controlled drug that needs no prescription is not a thing." },
      { type: "warn", text: "A controlled medicine is dispensed in person, over your counter, and nowhere else. The till will not ring one until you have recorded the prescription number and the prescriber — and it cannot be put on a delivery or a telephone order at all, for anyone. That is deliberate: a pharmacist has to sight the script." },
      { type: "note", text: "Everything you dispense against a prescription lands in Pharmacy → Dispensing register, with the lot it came from, the patient and the prescriber. That is the list a regulator asks to see, so the two rules above exist to keep it complete." },
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
    keywords: ["fuel", "pump", "nozzle", "dip", "tank", "meter", "petrol", "diesel", "attendant", "handover"],
    body: [
      {
        type: "steps",
        items: [
          "Start a shift. Say who is on which hose — that part is optional, and the meters open where the equipment already stands.",
          "Fuel sells through the shift, priced at the rate in force at the time.",
          "Test litres are recorded and are not a sale — they went back in the tank.",
          "Close the shift: meter readings again, then dip the tank and set stock to the dip.",
          "The difference between what the meters say sold and what the dip says is left is the variance.",
        ],
      },
      { type: "p", text: "Where you named the men, the closed shift carries a Handover table: each attendant's litres and what they come to, straight off their own meters. That is the figure you count their cash against, the same evening." },
      { type: "note", text: "The unbilled litres are never split between attendants. A till sale doesn't record which nozzle it came from, so that gap belongs to the station as a whole — a per-man share of it would be a guess, and you couldn't stand behind it if the man denied it." },
      { type: "note", text: "Assigning nobody is normal. A one-man pump has nothing to assign, and the shift opens and closes exactly the same either way." },
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
      { type: "p", text: "A deposit you record goes against the day the counter is trading — the one shown at the top of this screen. If last night was never closed off, you will see more than one day still open; the money still lands on today, and last night stays open until someone signs it off." },
      { type: "warn", text: "Close the day every night. A day left open is not just untidy: nothing about it is final, so its variance is never signed off and the figures keep moving." },
      { type: "warn", text: "Once a day is closed off, its figures never change again — not when a correction is made, and not when a sale that was stuck on an offline till finally arrives. That is on purpose: a variance you counted and accepted has to still mean the same thing months later. If late sales do land against a day you have already closed, Reports → Offline names the amount so you can post an adjustment." },
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
          ["Recurring", "Rent, salaries, the internet bill — and on the income side, the flat upstairs or a let shutter. A template falls DUE and you post it; nothing files itself on a schedule. A posted row is marked so you can tell it from one you typed."],
          ["Budgets", "A ceiling per category per month, warning you when you go past it."],
          ["Categories", "Your own vocabulary, seeded from your business type."],
        ],
      },
      { type: "h", text: "Picking a period" },
      { type: "p", text: "The date shortcuts above the list include Tax year — 1 July to 30 June, the twelve months your return is filed against. This year, next to it, is the calendar year. Both are kept because they answer different questions; use Tax year for anything that goes to FBR or an auditor." },
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
      { type: "note", text: "A slip printed while the till was offline works in the search box too. Type the OFF-… number the customer is holding and the sale comes up under its real receipt number, with the slip number shown beneath it so you can check it is the right one before you refund anything." },
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
      {
        type: "note",
        text: "'Money you are holding' at the top of this screen counts every advance you have taken — on goods held for a customer AND on a job in the workshop. The two are the same thing from your drawer's point of view: cash that is in the till and is not yours yet.",
      },
      {
        type: "note",
        text: "Only a quote goes out of date. A quote carries the number of days you set in Settings and shows as expired after that; goods on advance carry your collect-by window. A workshop job card has neither — it has the time you promised the car back, and nothing else.",
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
      { type: "h", text: "Who works where" },
      { type: "p", text: "Staff → Add or edit somebody → Which branch do they work at. They can only work that one: its stock, its till, its day. The choice only appears once you have more than one branch, and leaving it unset puts them at Main." },
      { type: "note", text: "This is not a preference they can change. Their branch is shown beside the search box at the top of the screen so they can check where they are, and nothing they do can move them — which is the point, because it is what stops a second branch's cashier selling the first branch's shelf." },
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
      { type: "h", text: "Which branch a record belongs to" },
      { type: "p", text: "Expenses, income, stock write-offs and stock movements each show the branch they happened at, once you have more than one. In the all-branches view that is the only thing telling two otherwise identical rows apart." },
      { type: "note", text: "Purchase orders and the cashbook do not show one, and that is the honest answer rather than an omission: an order is raised for the shop, and the cashbook is built from entries that carry their own branch already." },
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
      { type: "p", text: "Search the box at the top of the list by code — a season of campaigns leaves more codes than fit on one screen, and the code is the only thing anybody remembers about a coupon. Previous and Next at the foot of the list walk the rest." },
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
      { type: "warn", text: "This is holding STOCK, not booking an appointment. CartZe does not do appointment booking." },
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
        "Details — the only tab you must fill in. Name, category, price, description.",
        "Media & online — photos, and which collections it belongs to. Only if you sell online or use images.",
        "Sizes & options — sizes and colours, or add-ons that change the price.",
        "Codes & packs — extra barcodes, and selling the same thing by piece or carton.",
      ]},
      { type: "note", text: "Save from the first tab and come back later. A half-filled product is more useful than one you never finished." },
      { type: "h", text: "What an item's price used to be" },
      { type: "p", text: "Open any item you have re-priced and its recent price changes sit under the price boxes: what it was, what it became, who changed it and when. It is the answer to \"why is this ringing at 210?\" asked where the question comes up." },
      { type: "note", text: "Only the people who can open Activity see it — the same rule, because it is the same record. Somebody who keys the catalogue can change a price and is not shown who else has; that is the owner's business rather than the catalogue's. Adding an item is not a price change and is not recorded, and a price list imported over hundreds of items files ONE line rather than hundreds, so your own changes stay easy to find." },
      { type: "h", text: "Items you show online" },
      { type: "p", text: "A new item that customers will see online cannot be created without a description — they have nothing else to go on. The Description box is on the Details tab and is marked with a red star when that applies to the item you are adding." },
      { type: "note", text: "On an item you already have, it is a warning rather than a block: it saves, and tells you the listing is blank. Otherwise correcting one price would mean writing marketing copy first, and an item that is already online without a description stays online either way." },
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
    id: "workshop",
    title: "The board of work taken in",
    summary: "Everything in the shop right now, and what stage it is at.",
    group: "Selling",
    permission: "sales.manage",
    screen: "/tenant/workshop",
    keywords: ["workshop", "job card", "bay", "board", "car", "vehicle", "repair", "mechanic", "ready", "laundry", "tailor", "job"],
    body: [
      { type: "p", text: "Three columns — taken in, being worked on, ready — and everything you have accepted sits in one of them. It is the whiteboard on the wall, in a place the person answering the phone can also see." },
      { type: "note", text: "For any shop that takes work IN and hands it back later. An Auto & Tyre shop calls it the Workshop and works in cars; a laundry, tailor, cobbler or repair counter calls it Jobs and is never asked for a registration number. Same board, same three stages — only the words change. Shops that sell off a shelf never see it." },
      { type: "note", text: "This is not appointment booking and never becomes it. Nothing here schedules a future slot; the board only holds work that is already in your shop." },
      { type: "p", text: "Your dashboard carries the same board as a summary — how many are taken in, how many are being worked on, how many are past the time you promised, and one figure worth checking every evening: Ready, not billed." },
      { type: "warn", text: "Ready, not billed is finished work nobody has charged for yet. A car handed back without turning its job card into an invoice is work you will not be paid for, and that total is the only place it shows up." },

      { type: "h", text: "Booking a car in" },
      { type: "p", text: "Press 'Book a car in' when it arrives. It asks for four things and none of them is a price — nobody knows the price yet, and that is exactly why this is a job card and not a quotation." },
      { type: "keys", items: [
        ["The registration", "Start typing and pick the car if you have seen it before. That is what keeps its history together — 'what did we do last time' is only answerable if the same car is one record. A new plate is registered for you."],
        ["What is wrong", "In the customer's words. 'Noise from front left when braking' — not your diagnosis. It is the first thing the mechanic reads and the thing most likely to get lost."],
        ["Promised back", "When you told them to come and collect. The board turns the card amber once that time has passed, which is the one thing on it worth a colour. This is the ONLY date on a job card — a job does not go out of date the way a quoted price does, so it will never show as expired or turn up on the list of documents you are chasing."],
        ["One opening item", "The diagnostic hour, or the part you already know it needs. Everything else goes on afterwards."],
      ]},

      { type: "h", text: "While the car is with you" },
      { type: "p", text: "Open the job from the board to add parts and labour as you fit them. Prices come from your catalog — you cannot type a price on a job, for the same reason you cannot type one at the till." },
      { type: "keys", items: [
        ["Moving it along", "One tap on the card. Cars go backwards too — a job you marked ready that fails its road test goes straight back to 'being worked on'. Nothing is one-way."],
        ["Taking money up front", "You can record an advance against a job, the same as goods held on advance. Useful when you are about to order a part. It shows in the 'money you are holding' figure on Documents — that cash is in your drawer and it is not yours yet."],
      ]},
      { type: "note", text: "The board shows every job in the shop, however many there are — not the newest screenful. If a shop ever passes 500 open jobs it says so at the top rather than quietly leaving some off." },

      { type: "h", text: "When they collect" },
      { type: "p", text: "'Bill it' turns the whole job into a real invoice — every part, every hour, the advance already paid deducted. Stock comes off then, not before." },
      { type: "warn", text: "Bill it and the car leaves the board. That is deliberate: the board is what is IN the shop, and a car you have been paid for is not. The job is still there under Documents, and the work now shows in that car's history." },
      { type: "note", text: "That history is the whole reason this is worth doing. A year later somebody asks what you did to this plate last time, and the answer is on the car's own record instead of in somebody's memory." },
    ],
  },
  {
    id: "bank-offers",
    title: "Bank card offers",
    summary: "When a bank pays for the discount, not you.",
    group: "Selling",
    parent: "coupons",
    permission: "coupons.manage",
    screen: "/tenant/bank-offers",
    keywords: ["bank", "card", "hbl", "meezan", "ubl", "discount", "claim", "reimburse", "credit card", "debit card"],
    body: [
      { type: "p", text: "Customers → Bank offers. A bank runs a deal on its own cards — say 10% off on HBL cards through Ramadan. The customer pays 10% less, and THE BANK PAYS YOU THE DIFFERENCE. You are not giving the discount; you are the counter it happens at." },
      { type: "warn", text: "That one sentence is the whole feature. If you set the offer up here and never claim it back from Reports → Bank claims, you have simply given customers a discount out of your own pocket. Claim monthly." },

      { type: "h", text: "Setting one up" },
      { type: "p", text: "Add the bank first — it is a relationship you keep for years. Then add an offer to it, which is a campaign with dates that you will replace every few months." },
      { type: "keys", items: [
        ["Name it properly", "The cashier sees this name and the claim is filed under it. 'Ramadan 10%' — not 'Offer 1', which is a name you will regret in March."],
        ["Put the cap in", "If the bank's letter names a maximum per transaction, enter it. Without one, 10% off a Rs 400,000 sale gives away Rs 40,000 and the bank will refuse the claim."],
        ["Put the end date in", "A campaign with no end runs until somebody remembers to switch it off. Every day past the real end is a discount you fund yourself."],
        ["Which cards", "Leave both unticked for any card, which is the commonest deal. Tick one only if the bank's deal really is credit-only — it makes the cashier answer an extra question at the till."],
      ]},
      { type: "note", text: "Days and times work exactly like Promotions, including a window that crosses midnight. Set it up once and it applies itself." },

      { type: "h", text: "At the till" },
      { type: "p", text: "When a customer pays by card, the cashier picks the bank from a short list and the discount appears. Everything about it is optional — the bank, and the last 4 digits of the card. A cashier who ignores it takes the payment exactly as before." },
      { type: "keys", items: [
        ["The list is short on purpose", "Only banks with an offer running right now appear. A bank whose campaign ended is not offered."],
        ["Last 4 digits", "Optional, and never blocks a sale. But the bank matches your claim on it, so a sale without one may be harder to collect — the claims report flags those separately."],
        ["The amount due drops", "The customer taps less. What YOU are owed has not changed; the bank pays the rest."],
      ]},
      { type: "warn", text: "Never type a full card number anywhere in CartZe. The box takes four digits and nothing else, deliberately — holding full card numbers is a serious legal obligation, and this is not the place for them." },

      { type: "h", text: "Getting the money back" },
      { type: "p", text: "Reports → Bank claims. Per campaign, with every invoice number, date and last-4 the bank will ask for. Export it and send it to them." },
      { type: "note", text: "A shop promotion and a bank offer both apply to the same sale — they are two different people's money. Your promotion comes off the bill; the bank's comes off the card payment of whatever is left." },
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
      { type: "note", text: "A review belongs to the customer who wrote it. They can change it or take it down at any time, and your rating is worked out again without it — so a review you replied to can disappear, and your reply goes with it. Editing a review also clears the reply, because an answer to something that has since changed is worse than no answer." },
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

      { type: "h", text: "Which paper size actually gets used" },
      { type: "p", text: "There are two places a paper size can be set, and they answer different questions. Shop settings → Point of Sale sets the size for the WHOLE shop. The size on a registered printer, here, is for THAT printer." },
      { type: "keys", items: [
        ["A printer with a size set", "That printer's size wins for the receipts it prints. This is what you want when the shop issues A4 invoices from the office but the counter has an 80mm roll."],
        ["A printer with no size set", "The shop-wide setting decides, exactly as before. Leaving it alone is a perfectly good answer."],
        ["No printer registered at all", "The shop-wide setting decides. Most shops never register a printer and never need to."],
      ]},
      { type: "note", text: "The receipt you see in the preview under Point of Sale is the real receipt — the same page the counter prints, not a drawing of one. What it cannot know is which lane you will print from, so if one counter has a different roll to the shop default, set that size on the printer here." },
    ],
  },
  {
    id: "tills",
    title: "Your tills & offline pricing checks",
    summary: "The devices your POS runs on, and whether they could sell without the internet.",
    group: "People & setup",
    parent: "settings",
    permission: "settings.manage",
    screen: "/tenant/settings",
    keywords: ["till", "device", "tablet", "offline", "internet", "pricing", "variance", "sign out", "lost tablet"],
    body: [
      { type: "h", text: "Your tills" },
      { type: "p", text: "Shop settings → Point of Sale → Lanes & PINs. Every device that opens the POS adds itself to this list on its own — there is nothing to register by hand. Each row shows which lane it stands at and when it last reached us." },
      { type: "p", text: "A till that goes quiet is a till that has lost its connection, so 'last reached us' is the number worth reading. It updates while the POS is open, not only when the browser is reloaded." },
      { type: "note", text: "Signing a till out is not a delete. The tablet stops being usable, but its row stays and every sale it already sent still points at it — which is exactly what you will want to look up afterwards. 'Allow again' brings it back if it turns up." },
      { type: "p", text: "Name each one. 'Name it' beside a till lets you call it what the staff call it — 'Counter tablet', 'Lane 2'. It is worth the ten seconds: the offline report puts this name against every sale that came in late, and a problem on ONE tablet is a very different thing from a problem in the shop. Three tills all reading 'Unnamed till' tell you nothing." },
      { type: "warn", text: "One device belongs to one shop. If a tablet has already signed itself in somewhere else, this screen will say so instead of listing it — it is not a fault, it is the tablet still being registered to the other shop." },

      { type: "h", text: "Offline pricing checks" },
      { type: "p", text: "CartZe is being prepared to keep selling when the internet drops. Before a till is allowed to work out prices on its own, it has to prove it gets the same answer your server does." },
      { type: "p", text: "So every sale is priced TWICE — once by the server, which is what the customer pays, and again by the offline engine, purely to compare. Nothing on the receipt changes, and nobody is ever charged the second figure." },
      { type: "keys", items: [
        ["Carts checked", "How many sales have actually been compared. This is the number that matters — zero disagreements means nothing if nothing was checked."],
        ["Matched exactly", "Both engines agreed to the paisa."],
        ["Couldn't be priced", "The till could not price the cart, usually an item it had not downloaded yet. This is not agreement, and a large number here needs looking at."],
        ["Tills reporting", "How many of your devices have contributed. One busy till does not speak for four."],
      ]},
      { type: "warn", text: "A disagreement never means a customer was overcharged. They paid the server's price. It means the offline engine is not ready, and it is far better to find that here than on a day the internet is down." },
      { type: "p", text: "Disagreements are grouped by what actually went wrong, not listed one per sale. Nine carts with the same fault are one problem shown once, with the carts folded underneath — fixing one fixes all of them." },
      { type: "note", text: "Your automatic offers ARE worked out by the till, including buy-one-get-one. If you ever set up an offer of a kind the till does not recognise, it will refuse to sell offline rather than print a wrong price — the shop is told, not the customer. The same applies to a customer whose group gets a percentage off, and to a bank card offer: the till says so at the tender screen and the customer keeps the discount if you wait for the connection." },
      { type: "p", text: "If a till's browser data is cleared, its count starts again from zero and the totals here go down. That is deliberate — the evidence really did go with it, and a figure that only ever climbed would claim more than it could show." },

      { type: "h", text: "Selling when the internet is down" },
      { type: "p", text: "Once the checks above are clean and support has turned offline selling on for your shop, a till keeps trading through a power cut or a dead connection. Nothing for you to switch on at the counter — the POS notices and carries on. Your whole product list and its categories are already on the tablet, so you can browse and search them exactly as you do online; the only thing missing is product photos, which are not stored on the device." },
      { type: "warn", text: "A shift still has to be OPENED and CLOSED with a connection. If the internet is already down when you arrive in the morning, the till cannot start a shift — and it cannot count the drawer out while it is still down. Selling in between is what works offline." },
      { type: "note", text: "Offline selling is off until it is granted. That is deliberate: it is turned on for your shop once the pricing checks above have run over YOUR OWN sales for long enough to prove the till prices exactly as the server does. Until then the POS will say so at the tender screen rather than at the end." },
      { type: "keys", items: [
        ["The receipt", "Prints a slip numbered OFF-… instead of an invoice number. Keep it: when the connection returns, the sale gets its real invoice number and BOTH are searchable, so a customer holding the slip can always be found."],
        ["Stock", "Counts down as you sell, so the shelf figure stays honest through a long outage — not stuck on whatever the server last said."],
        ["The queue", "The counter at the top shows how many sales are still waiting. They send themselves the moment the line is back — you never have to remember to send them."],
        ["Sync now", "Tap the green or red badge at the top of the till to sync straight away, instead of waiting for the next automatic one. It tells you what happened: syncing, up to date, or still no connection."],
        ["Holding a sale", "Not while the line is down. A held ticket is shared across every counter, and picking one up is a locked step so two lanes cannot ring the same basket twice — neither is possible without the connection. The till says so when you press Hold, and the held list tells you it cannot be read rather than pretending to be empty. Finish the sale, or leave the basket on screen."],
        ["Opening the drawer", "You can open a shift with no connection at all — which matters most on the morning the line is already down. Type the opening float as usual; the shift is kept on the tablet and sent when the line returns."],
        ["Counting it out", "You can close the drawer offline too, note by note, at the moment the cashier hands over rather than whenever the internet comes back. What you counted is kept and sent. The Z-read and the variance are worked out by the shop once every waiting sale has arrived, so any figure on screen before then is provisional — the till says so on the close screen."],
        ["If the till restarts", "The shift stays. A tablet that sleeps, restarts after a power cut, or has the app closed and reopened comes back knowing which shift it was on, and keeps selling into it."],
        ["A practice shift", "Training a new cashier works offline too, and it still takes nothing off the shelf — neither on the till nor in your books when it syncs. Practice sales keep their own TRN- numbering and stay out of every figure you read."],
      ]},
      { type: "warn", text: "Some things still need the connection, and the till will say so before you take the money — never after. Khata (a customer's balance is shared between tills), spending loyalty points, coupons, dine-in tables, medicines, and anything tracked by serial number. Take cash or card instead, or wait." },
      { type: "note", text: "A sale that has been rung is never lost. Close the browser, flatten the battery, come back three days later — it is still there and it still sends. It is safest of all if you have installed CartZe to the home screen rather than leaving it in a browser tab." },
      { type: "p", text: "When they arrive, the shop records them against the time they actually happened — a Tuesday sale counts in Tuesday's takings and Tuesday's cashier's figures, not the day it finally reached us." },
      { type: "note", text: "That is true even when the tablet's own clock is wrong. A device that has been flat for a week can come back believing it is the day it was made; the till corrects itself against the shop's time, and the shop refuses to file a sale into tomorrow or into a moment before that till was last in touch. You are told which tablet was out and by how much — see 'The morning after' below." },
      { type: "note", text: "The sale is also credited to the cashier who RANG it, not to whoever happened to be signed in when the queue finally sent. And a tablet carried to another branch still files its waiting sales at the branch it belongs to — the goods left that shelf, not this one." },
      { type: "warn", text: "Your shop can also set a point past which a till stops selling altogether — say five days with no internet. Most shops have none, and that is the sensible default: for most of us a fifth day offline is not worse than turning customers away. If you do want one, ask support. A cart already on the counter always finishes; only a NEW sale is refused." },

      { type: "h", text: "The morning after" },
      { type: "p", text: "Reports → Offline answers one question: what happened while we were out of contact. Open it the morning after a power cut." },
      { type: "keys", items: [
        ["Count these again", "Items whose stock went below zero. Two tills with no connection can each sell the last one and BOTH are telling the truth — the goods really did leave. Nothing here is a mistake; the shelf just needs counting."],
        ["Need a decision", "Sales that broke one of the offline rules and were recorded anyway. They are never quietly corrected — a credit sale turned into a cash one would leave you thinking you had been paid. Where the ITEM was the problem, the medicine or the serial-numbered item is named, because that one needs a look on the shelf: check which batch actually went out, or which handset."],
        ["The slip number", "Shown next to the real invoice number, so a customer holding an OFF-… receipt can always be found."],
        ["The same slip number twice", "Every till has its own four-letter code in the middle of the number, and its own running count, so two tills can never print the same slip. If one does appear here it means a tablet lost its saved data and started counting again — the sale is recorded either way, filed under the same number with a marker on the end, and searching the number the customer is holding still finds it. Worth telling whoever looks after the tablets."],
        ["Arrived after the day was closed", "Sales that reached us after you had already counted the drawer, closed the day and banked the cash. The amount is shown in rupees, because that is exactly how much that day's takings now read short of that day's sales."],
        ["A till with the wrong time", "Named by tablet, not by sale — one tablet three days out is still only one thing to fix. Your figures are already correct; this is telling you to go and set that device's clock before it drifts further. 'Behind' and 'ahead' are both shown, because they go wrong in opposite directions."],
      ]},
      { type: "warn", text: "A day you have signed off is never changed behind your back — a day closed in March has to still read the same in September, or a variance you accepted stops meaning anything. So when late sales land against a closed day, the day holds still and the shortfall is named instead. Post an adjustment for it; the sales themselves are already in your books under the right date." },
      { type: "note", text: "On most days this screen says your tills were in touch the whole time. That is the answer you want, and it is worth a glance." },

      { type: "h", text: "If a till runs out of space" },
      { type: "p", text: "A till holds its unsent sales on the device itself, so it needs room. You will see a warning long before it matters — free some space and carry on." },
      { type: "warn", text: "If the device genuinely fills up, the till will not let you open a shift. That is deliberate: a sale rung with no room to save it is a sale lost with the customer already gone, and refusing before the shift starts costs nothing. Connect the till and let it sync — that sends what is waiting and frees the space." },
      { type: "note", text: "Add CartZe to the home screen and open it from there. An installed till holds onto its data far better than a browser tab, and on an iPad it is the only thing that makes a real difference." },
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
    keywords: ["report", "profit", "best seller", "analysis", "tax year", "financial year", "year", "staff", "salesman", "commission", "target"],
    body: [
      { type: "p", text: "What sold, who bought it, and who sold it." },
      { type: "p", text: "Profit is takings, plus other income, minus the cost of what was sold, minus expenses." },
      { type: "p", text: "Two different years are on offer, and they are different questions. This Year is January to December — what you made, the way you'd say it out loud. Tax Year is 1 July to 30 June, which is the window FBR's return, your audited accounts and your advance tax all sit inside. For anything you file, use Tax Year." },
      { type: "note", text: "The dates under the buttons always say which twelve months you are looking at, so you never have to remember which is which." },
      { type: "h", text: "Who sold it vs who rang it" },
      { type: "p", text: "The Staff tab counts who ENTERED each sale. In a shop where one person serves the customer and takes the money, that is the same thing. In a showroom where salesmen work the floor and one cashier types, it is not — the cashier would show as having sold everything." },
      { type: "p", text: "Switch on Settings → POS → “Ask who served the customer” and the till adds a Served by box. The Staff tab then shows both: who sold it, and who rang it, as separate tables." },
      { type: "warn", text: "Sales where nobody was named are shown as unattributed and are never quietly credited to whoever was at the till. If a figure looks low, check that line first — it usually means the box was skipped, not that somebody sold less." },
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
      {
        type: "p",
        text: "Select all ticks every box at once — useful for a partner or a second manager. It warns you when you do, because it includes shop settings and hiring staff. Clear empties the list to start again.",
      },
      {
        type: "h", text: "Stopping someone working",
      },
      {
        type: "p",
        text: "Suspend on the row. They stay on the list with their permissions intact, and they cannot sign in until you press Activate. Use this when somebody leaves, rather than Remove, if you may want their history to keep making sense.",
      },
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
    id: "activity",
    title: "Who changed what",
    summary: "Your shop's own record of every change that matters, and who made it.",
    group: "People & setup",
    permission: "settings.manage",
    screen: "/tenant/activity",
    keywords: ["audit", "audit log", "history", "who changed", "trail", "activity", "log", "accountability", "record"],
    body: [
      { type: "p", text: "Some changes are worth being able to prove afterwards. Somebody raised a customer's credit limit to ninety thousand. Somebody moved the tax rate from 17% to 5%, which re-rates every product on it. Somebody made a coupon for half off. Activity records all of it — who, what, when, and what the value was before." },
      { type: "p", text: "It is kept whether or not anyone ever asks. That is the point of a record: the day you need it is not a day you can go back and start keeping one." },
      { type: "p", text: "Opening it from an item narrows it to that item, and a bar at the top says so with a Show everything link. That is how the Price history panel on a product gets you the rest of its changes — the panel shows the last few, the link shows all of them." },
      { type: "h", text: "What is recorded" },
      { type: "keys", items: [
        ["Credit limits", "How much a customer may take on khata without paying. The limit itself, not the rest of the record — a phone number corrected at the counter is not an event."],
        ["Tax rates", "Change a rate once and every product on that group re-rates. The difference between the old rate and the new one is money owed to FBR."],
        ["Customer groups", "The members' discount. One edit changes the price for everybody in the group, and nobody at the counter sees it happen."],
        ["Coupons", "Every coupon is money off every bill that quotes it — and a coupon deliberately sits outside your discount ceiling, so the ceiling's own record says nothing about it."],
        ["Staff & permissions", "Who was given what, who was suspended, who was let back in."],
        ["Shop settings", "Including your discount ceiling and everything else on the Settings screen."],
        ["Sales, stock written off, banking, the trading day", "The money trail, which has always been kept."],
      ]},
      { type: "h", text: "What is NOT recorded, and why" },
      { type: "warn", text: "Product prices are not in here. A shop importing five thousand rows would bury its own trail in one afternoon, and a record nobody can read to the bottom of protects nobody. If you need to know who repriced something, that is worth asking for — it needs a different shape from this list, not a bigger one." },
      { type: "h", text: "Reading a row" },
      { type: "p", text: "Each row says who, what changed, and the value before and after — the old one struck through, the new one beside it. \u201cSystem\u201d in the Who column is honest: a recurring expense posting itself on the 1st has no person behind it." },
      { type: "note", text: "Filter by what you are looking for rather than scrolling. Credit limits, tax rates, coupons and staff each have their own filter, and the two date boxes narrow it to the week something went wrong." },
      { type: "h", text: "Who can open it" },
      { type: "p", text: "Anyone who may look at how the shop performed, or who sets the shop's rules — the same people who can open Reports or Settings. A cashier cannot. That is deliberate in both directions: the person most often being asked about is the one holding Settings, and a record only they could open would not be a record." },
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
      { type: "p", text: "Settings is a row of tabs. You are only shown the ones your shop can use — a books-only business has no till, so it is not offered Point of Sale, Receipt or Barcodes." },
      {
        type: "table",
        head: ["Tab", "What it holds"],
        rows: [
          ["Business", "Name, logo, contact, map location, and whether your online shop is open."],
          ["Tax & Delivery", "Your default tax rate, whether prices already include tax, and how customers get their orders."],
          ["Point of Sale", "Four sub-tabs: Counter (till defaults, discount ceiling, whether a shift is required), Lanes & PINs, Quotes & advances, and Kitchen if you take dine-in orders."],
          ["Loyalty", "Points — what a customer earns, what a point is worth, and the least they can redeem."],
          ["Receipt", "Receipt and invoice layout, with a live preview as you change it, plus your NTN / STRN."],
          ["Point of Sale → Lanes & PINs", "Also lists YOUR TILLS — every device the POS runs on, when each last reached us, and how to sign out one that went missing."],
          ["Hardware", "Printers, cash drawers, scanners and weighing scales."],
          ["Barcodes", "What prints on a label, and scale barcodes for items sold by weight."],
        ],
      },
      { type: "p", text: "Branches live on their own screen, and theme colours in the Appearance panel reachable from anywhere." },
      {
        type: "note",
        text: "Every tab shares one Save. Change something on one tab, move to another, and it is still waiting to be saved — pressing Save anywhere saves the lot.",
      },
      { type: "h", text: "Your tills" },
      { type: "p", text: "Settings → Point of Sale → Lanes & PINs. Every device that opens CartZe signs itself in here, so you can see which tablets and computers your shop runs on and when each last reached us." },
      { type: "p", text: "Lost a tablet, or lent one out and never got it back? Sign it out. It stops being usable straight away, but it stays on the list — the sales it already sent still belong to it, and you may want to see what happened. If it turns up, allow it again." },
      {
        type: "note",
        text: "Sales rung on a till are never lost. If a till is out of contact, they wait on the device and send themselves the moment it gets a connection again — however long that takes.",
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

      { type: "h", text: "Wrong passwords, and what they can and cannot do" },
      { type: "p", text: "Five wrong passwords in a row on an account and further WRONG passwords stop being accepted for fifteen minutes. Your own correct password always works — nobody can shut you out of your own till by typing rubbish at the login screen." },
      { type: "note", text: "A one-time code works too, for the same reason: proving you own the phone or email is proof enough. That is the door to use if you have genuinely forgotten the password." },

      { type: "h", text: "Who can reset somebody else's password" },
      { type: "p", text: "You can, for anyone on your team — you are the owner. A staff member who is allowed to manage staff can only reset the password of someone who can do LESS than they can." },
      { type: "warn", text: "That limit is deliberate and worth knowing before you tick 'Manage staff' for a manager. Setting someone's password means being able to sign in as them, so without it a manager could quietly reach anything you had decided not to give them. The same applies to changing a colleague's email or phone, because a one-time code goes to whichever one is on the account." },
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
