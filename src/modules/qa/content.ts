import type { QaSection } from "./types";

/**
 * WHAT THIS PRODUCT IS — read this before opening anything.
 *
 * Kept as prose rather than as a step, because a tester who starts clicking
 * without it will spend the first day reporting the rules as bugs.
 */
export const QA_INTRO = {
  title: "What you are testing",
  lines: [
    "CartZe is one system that runs a whole shop: the counter, the stock, the money and, if the shop wants one, its page on the internet. It is multi-tenant — every business has its own data, its own staff and its own settings, and they can never see each other's.",
    "It is not written for one kind of shop. The SAME code runs a kiryana store, a chemist, a restaurant, a workshop, a filling station, a salon and a books-only office, and each of them sees a different product. That is the single most important thing to hold on to while testing: a screen that is missing is usually missing on purpose.",
  ],
  axes: [
    {
      name: "MODULE",
      text: "What this shop was GIVEN. Set by the platform admin when the business is created. Twenty of them — the till, stock, suppliers, disposals, the kitchen pass, online store, and so on. Settings → Your modules shows the shop its own list.",
    },
    {
      name: "TRADE",
      text: "What KIND of business it is (food, mart, pharmacy, retail, services, automotive, petroleum, finance). It decides vocabulary, item types and a handful of trade-only screens — a chemist gets a dispensing register, a workshop gets a bay board.",
    },
    {
      name: "PERMISSION",
      text: "What THIS PERSON may do. There are no job roles: a cashier is a set of permissions, and an owner holds all of them. A cashier is not shown Reports and cannot open them by typing the URL either.",
    },
  ],
  before: [
    "Before reporting anything missing, check all three. Most first-week bug reports are one of them doing its job.",
    "Money is always PKR and prices always come from the SERVER — the till sends what was scanned and how many, never a price. A price you can change in the browser and have accepted is a serious bug; a price you cannot change is the design.",
    "A trading day that has been closed is never rewritten, not even by a sale that arrives late. Figures moving on a closed day is a serious bug; being told about a shortfall instead is the design.",
  ],
};

export const QA_SECTIONS: QaSection[] = [
  {
    id: "start",
    title: "Getting in",
    blurb: "Who you are signed in as decides most of what you will see, so establish that first.",
    steps: [
      {
        id: "sign-in",
        title: "Sign in, and know which shop you are in",
        summary: "Everything below depends on the shop and the person. Pin both down before you click anything else.",
        screen: "/signin",
        required: "always",
        what: [
          "One login serves three different products: the shop panel (a shopkeeper), the marketplace (a customer buying something), and the admin console (the platform operator). The role on the account decides which one you land in.",
          "A shop's name, logo and colours are its own. If the panel looks like a different business than the one you signed into, stop — that is a tenancy bug and it is the most serious kind there is.",
        ],
        checks: [
          { do: "Sign in as the shop owner of the shop you are testing.", expect: "You land on that shop's dashboard, with that shop's name in the header." },
          { do: "Read the shop name and, if the shop has more than one branch, the branch shown in the header.", expect: "Both match the shop you meant to sign into. Write them down — every figure you check later belongs to this shop and this branch." },
          { do: "Sign out and sign in as a cashier of the same shop (ask for one, or make one under Staff).", expect: "A much shorter menu. This is the PERMISSION axis and you will use it repeatedly." },
        ],
        wrong: [
          "Any data from another shop, anywhere, ever. One shop's product, customer, sale or figure appearing in another is the highest-severity bug in this product.",
          "A screen a cashier is offered in the menu and then refused when they open it. The menu and the door must agree.",
        ],
      },
      {
        id: "shape",
        title: "The shape of the panel",
        summary: "A rail on the left, a header, and the screen. Two menu depths, and a reason for both.",
        required: "always",
        what: [
          "The sidebar has a Simple view (the five or six screens a shop uses daily) and a Full view (everything it has). New shops start Simple so they are not handed forty links on day one.",
          "On a tablet the rail collapses to icons. That is why two screens must never wear the same icon — at that width the picture is the only label.",
        ],
        checks: [
          { do: "Switch between Simple and Full.", expect: "Full never HIDES something Simple shows. Simple is a smaller menu, not a different business." },
          { do: "Collapse the sidebar to icons.", expect: "No two visible icons are identical." },
          { do: "Open the panel on a phone-sized window (about 390 points wide).", expect: "The rail becomes a drawer, and no screen scrolls sideways. Sideways scroll on any screen is a bug — the page body must never move horizontally." },
        ],
      },
    ],
  },

  {
    id: "modules",
    title: "What this shop has",
    blurb: "The single biggest source of false bug reports. Learn it before anything else.",
    steps: [
      {
        id: "your-modules",
        title: "Your modules",
        summary: "The shop's own list of what it was given — and what it was not.",
        screen: "/tenant/settings",
        required: "always",
        what: [
          "Settings → Your modules lists all twenty modules with a tick or a dash. It is read-only for the shop: modules are the platform admin's decision, because a shop able to switch its own till off would be a support call.",
          "This is the answer to 'why can I not see Purchases'. Open it FIRST whenever a screen you expected is not there.",
          "Modules depend on each other. Suppliers & Purchases needs Inventory, which needs Products. A module standing on one that is off is not enabled, however the list was written.",
        ],
        checks: [
          { do: "Open Settings → Your modules and write down which are on.", expect: "The count at the top matches the ticks. Everything OFF is listed too, with its description." },
          { do: "Compare the list with the sidebar.", expect: "Every module that is ON has its screens in the menu, and no module that is OFF does." },
          { do: "Type the URL of a screen whose module is off — for example /tenant/disposals with Disposals off.", expect: "You are refused, not shown an empty page. A screen hidden from the menu but reachable by URL is a real bug." },
        ],
        wrong: [
          "A screen offered in the menu that answers 'this module is not enabled for your shop' when opened. The menu, the route and the server must agree — all three or none.",
        ],
      },
      {
        id: "admin-modules",
        title: "Turning modules on and off (admin side)",
        summary: "How a shop gets what it has. You will use this constantly to set up test cases.",
        screen: "/admin/tenants",
        required: "always",
        what: [
          "Sign in as the platform admin, open a tenant, and there is a Modules card grouped into sections — Selling, Stock, Customers & offers, Money, Online, Trade-specific.",
          "Switching one ON pulls up everything it stands on and says what else it moved. Switching one OFF drops everything built on it, and says that too.",
          "The same picker appears when a business is created, with its trade's usual set already proposed.",
        ],
        checks: [
          { do: "Switch Suppliers & Purchases ON for a shop that has nothing.", expect: "Inventory and Products come on with it, and the row says 'Also switched on: Products, Inventory'." },
          { do: "Switch Inventory OFF again.", expect: "Suppliers & Purchases, Stocktake and Disposals go with it, and the row names them." },
          { do: "Save, then look at the shop side.", expect: "The sidebar matches immediately. No screen survives whose module you just removed." },
        ],
        wrong: [
          "A save that appears to work and changes nothing. Every save in this product must either succeed visibly or say why it did not — a silent failure is a bug in itself.",
        ],
      },
    ],
  },

  {
    id: "catalog",
    title: "The catalog",
    blurb: "Nothing can be sold, counted or reported on until it exists here, so this is where a shop starts.",
    steps: [
      {
        id: "categories",
        title: "Categories",
        summary: "How the till groups things. Do this before products, or you will be typing them twice.",
        screen: "/tenant/categories",
        module: "products",
        required: "module",
        what: [
          "Categories are what the till's tiles are grouped by and what most reports break down by. A shop's trade proposes a starting set when it is created — a chemist gets Tablets and Syrups, a restaurant gets Starters and Main Course.",
          "They can be reordered by dragging, and hidden without being deleted. Hiding is not deleting: a hidden category's products keep their history.",
        ],
        checks: [
          { do: "Add a category, rename it, hide it, and drag it to a new position.", expect: "Each of the four saves and survives a page reload. A rename that snaps back is a save that failed silently — report it." },
          { do: "Hide a category that has products in it.", expect: "The products are still sellable and still in reports. Hiding groups things on a screen; it does not withdraw stock." },
        ],
      },
      {
        id: "products",
        title: "Products and services",
        summary: "The biggest screen in the product, and the one everything else reads from.",
        screen: "/tenant/products",
        module: "products",
        what: [
          "One record per thing the shop sells. What KIND of thing it may be depends on the trade: a restaurant writes dishes, a chemist dispenses medicine, a mart stocks packaged goods, a salon bills labour. A shop is only offered the item types its trade and its modules allow.",
          "A product carries a selling price and a COST. The cost is what every margin figure in the product is worked out from, and it is re-blended automatically when stock is received at a new price — so it is not a field a shop has to maintain by hand.",
          "Sizes (variants) are a real thing here, not a label: a large pizza and a small one have their own price, their own stock and their own barcode. So does a pack of twelve against a single.",
        ],
        required: "module",
        checks: [
          { do: "Add a plain product with a name, a price and a cost.", expect: "It appears in the list and, if the shop has a till, on the till within a few seconds." },
          { do: "Add a product with two sizes at different prices.", expect: "The till asks WHICH size when you tap it, and refuses to sell the parent on its own. Selling a sized product without choosing a size would be a bug." },
          { do: "Give one size its own barcode and scan it.", expect: "That size lands in the cart — not the other one, and not the parent." },
          { do: "Try to save a product with no name.", expect: "The field is named in an error next to it. A save that fails with nothing on screen is one of the defects this product has had before and must not have again." },
          { do: "Mark a product sold out (86) from the list.", expect: "It is refused at the TILL, on the dine-in tab and in an online order — all three. One of them still selling it is a bug." },
        ],
        wrong: [
          "A price the browser can change. Open the network tab, edit the price in the request, and send it: the sale must be priced by the server anyway.",
        ],
      },
      {
        id: "labels",
        title: "Barcode labels",
        summary: "Printing shelf labels from the catalog. Its own module — most small shops never switch it on.",
        screen: "/tenant/labels",
        module: "labels",
        required: "module",
        what: [
          "A label is printed from the catalog record, not from a shelf. The screen builds a sheet you can print — it does nothing to stock and nothing to prices.",
          "Optional on purpose: it is worth nothing without a label printer, so most shops start without it.",
        ],
        checks: [
          { do: "Select a few products and print to PDF.", expect: "The sheet carries the name, price and barcode of each, and the barcodes scan." },
        ],
      },
    ],
  },

  {
    id: "stock",
    title: "Stock",
    blurb: "What is on the shelf, what it cost, and what happened to what is no longer there.",
    steps: [
      {
        id: "inventory",
        title: "Stock levels and adjustments",
        summary: "What the shop believes it holds, and the only honest way to change it by hand.",
        screen: "/tenant/inventory",
        module: "inventory",
        required: "module",
        what: [
          "Stock is held PER BRANCH. A shop with two shops has two numbers for the same product, and the till sells from the branch it is standing in.",
          "An adjustment is a correction with a reason attached. It is not how goods normally arrive — that is a purchase — and a shop using adjustments to receive stock will have meaningless cost figures.",
          "A product can be marked not-tracked, and then it has no stock number at all. A service always is.",
        ],
        checks: [
          { do: "Adjust a product up by 10 with a reason.", expect: "The number moves by exactly 10, on the branch you are in, and the movement is listed with your name against it." },
          { do: "Adjust a SIZED product from the parent row.", expect: "You are asked which size, or told to pick one. A parent adjustment that reports success and moves nothing is a bug this product has had." },
          { do: "Switch to another branch and read the same product.", expect: "A different number. Stock in one branch must never move because you sold from another." },
        ],
      },
      {
        id: "purchasing",
        title: "Suppliers and purchases",
        summary: "How goods actually arrive, and how cost stays honest.",
        screen: "/tenant/purchases",
        module: "purchasing",
        required: "module",
        what: [
          "A supplier is a vendor with a running balance — what the shop owes them. A purchase order is what was ordered; RECEIVING it is what moves stock and what the shop then owes.",
          "Receiving at a new price re-blends the product's cost (a weighted average per base unit). That is why margins can be trusted without anybody maintaining a cost field.",
          "Raising an order and receiving one are different jobs and different permissions: the buyer orders, the stock keeper checks the goods off the bay.",
        ],
        checks: [
          { do: "Create a supplier, raise a PO for 10 of something at a price different from its current cost, and receive it.", expect: "Stock rises by 10, the product's cost moves to a blend of old and new, and the supplier's balance rises by the order value." },
          { do: "Pay the supplier from their own card.", expect: "The balance falls by what you paid. A Pay button that answers success and moves nothing is a defect this product has had — check the balance, not the message." },
          { do: "Receive only part of an order.", expect: "Stock rises by what arrived, and the order still shows what is outstanding." },
        ],
      },
      {
        id: "stocktake-disposals",
        title: "Stocktake and disposals",
        summary: "Counting the shelf, and recording what left without being sold.",
        screen: "/tenant/stocktake",
        module: "stocktake",
        required: "module",
        what: [
          "A stocktake is a counting sheet: you enter what is actually on the shelf and APPLYING it writes the difference off. Applying is manager-only, because it moves stock against the shop's own books.",
          "A disposal is stock that left without being sold — expired, damaged, or returned to the supplier. Written-off and returned-to-supplier are never added together: one is a loss and the other is a claim.",
        ],
        checks: [
          { do: "Draw a sheet, enter a count lower than the system's, and apply it.", expect: "Stock becomes what you counted, and the difference is recorded as a variance you can find later." },
          { do: "Dispose of a batch as expired, and another as returned to the supplier.", expect: "They appear under different headings, and only the returned one produces a claim against the distributor." },
        ],
      },
    ],
  },

  {
    id: "till",
    title: "The till",
    blurb: "Where the shop's money is actually taken. More of this product runs through here than through everything else put together.",
    steps: [
      {
        id: "pos-basics",
        title: "Ringing a sale",
        summary: "Find the thing, put it in the basket, take the money, hand over a receipt.",
        screen: "/tenant/pos",
        module: "pos",
        required: "module",
        what: [
          "The till runs FULL SCREEN with no sidebar, because a counter is not a place to browse a menu. There is exactly one way out and it is marked Exit.",
          "Three ways to find something: scan a barcode, search by name, or tap a tile. A food shop gets picture tiles by default and a mart gets a dense list of rows, because one has forty dishes and the other has four thousand SKUs. The tester can switch the view and it is remembered per device.",
          "The cart is priced by the SERVER. What the browser sends is the product and the quantity.",
        ],
        checks: [
          { do: "Scan or search an item and add it. Change the quantity. Remove it.", expect: "The running total is right after each action, and every line is visible — a cart that hides its own lines below the fold is a defect this product has had." },
          { do: "Add a weighed item (per kg) and enter 1.25.", expect: "It prices at 1.25 × the kilo price, and the receipt says the weight." },
          { do: "Take cash for more than the total.", expect: "The change is worked out and shown large. Cash rounding, if the shop set any, is applied and stated." },
          { do: "Complete the sale.", expect: "A receipt number, a printable receipt, and the cart cleared ready for the next customer." },
        ],
        wrong: [
          "Any price the browser can dictate.",
          "A tender screen that lets you complete a sale for less than the total without it being a credit (khata) sale.",
        ],
      },
      {
        id: "pos-options",
        title: "Everything else the till can do",
        summary: "Discounts, customers, held tickets, split payment, credit — the options a real counter needs.",
        screen: "/tenant/pos",
        module: "pos",
        required: "module",
        what: [
          "A discount can be a value or a percent, and the shop can set a CEILING on it. The ceiling is checked on the server for every door a sale comes in by, not just the till.",
          "Attaching a customer is how khata (credit), loyalty points and a group's price level reach the sale. The till finds a customer by PHONE — a customer with no phone cannot be found at the counter, which is why a credit limit without a phone is refused.",
          "Holding a ticket parks a basket so the next customer can be served. Online it is shared across every lane and resumed by a locked claim so two lanes cannot ring the same basket. With no line it is parked on THAT TILL and the screen says so.",
          "Tenders: cash, card (recorded, there is no gateway anywhere in this product), split across both, and credit (khata) which needs a customer.",
        ],
        checks: [
          { do: "Apply a discount larger than the shop's ceiling.", expect: "Refused, with the ceiling named. Try the same through a quote and an online order — refused there too." },
          { do: "Attach a customer by phone, then sell on credit.", expect: "The customer's balance rises by exactly the credit part, and the sale cannot give cash change." },
          { do: "Hold a ticket with a name, serve someone else, then resume it.", expect: "The basket comes back exactly as it was — items, discount, customer, table." },
          { do: "Split a bill across cash and card.", expect: "The two must add up to the total, and both appear on the receipt and in the day's tender breakdown." },
        ],
      },
      {
        id: "shift",
        title: "The drawer and shifts",
        summary: "The cash box, who is standing at it, and whether it balances at the end.",
        screen: "/tenant/pos",
        module: "pos",
        required: "module",
        what: [
          "A shift is opened with a float — the change the cashier starts with. Every cash sale, payout, drop and refund on that till belongs to that shift.",
          "Money moves in and out for reasons that are not sales: paid in, paid out, a drop to the safe. Each needs a reason, and each is on the Z-read.",
          "Closing counts the drawer, note by note if the shop wants, and compares it with what the shop's own books say should be there. The difference is the VARIANCE, and it is the number the whole feature exists to produce.",
          "A blind close hides the expected figure until after the count, so the cashier cannot count backwards from it.",
          "Training mode is a practice till: the shift is the unit, so a whole shift is practice. Practice sales take nothing off the shelf and appear in no figure.",
        ],
        checks: [
          { do: "Open a shift with a float of 3,000. Ring a cash sale of 500. Pay out 200 with a reason.", expect: "The X-read shows float 3,000, cash sales 500, paid out 200, expected 3,300." },
          { do: "Close it and count exactly 3,300.", expect: "Variance zero. Count 3,200 instead and the variance is −100, and it is recorded, not hidden." },
          { do: "Open a shift, then try to open a second on the same lane as another cashier.", expect: "Refused — one open shift per lane and one per cashier." },
          { do: "Open a PRACTICE shift and sell.", expect: "Stock does not move, the sale is numbered separately, and it appears in no report or drawer figure." },
        ],
        wrong: [
          "A close that reports a variance the shop cannot reproduce from its own numbers. Every figure in a Z-read must be re-derivable from the sales and movements listed under it.",
        ],
      },
      {
        id: "day",
        title: "The trading day and banking",
        summary: "What the whole shop took today across every drawer, and how much of it went to the bank.",
        screen: "/tenant/day",
        module: "pos",
        required: "module",
        what: [
          "A shift is one cashier's drawer; a DAY is the shop. A day can hold several shifts and several lanes, and it is what gets closed off and banked.",
          "A deposit is money leaving the shop for the bank. It is recorded against the day.",
          "Once a day is closed its figures never change again — not for a correction, and not for a sale that was stuck on an offline till and arrives on Friday. That is deliberate: a variance somebody counted and accepted has to still mean the same thing in six months.",
        ],
        checks: [
          { do: "Close two shifts, then close the day.", expect: "The day's takings equal the shifts' takings, and the day is marked closed by you with a time." },
          { do: "Record a bank deposit.", expect: "It appears against the right day, and the shop can see what is still in the shop against what went to the bank." },
          { do: "Ring a sale dated into a closed day (or let an offline sale arrive after a close).", expect: "The closed day does NOT move. The shortfall is named in rupees on Reports → Offline instead. Figures changing on a closed day is a serious bug." },
        ],
      },
    ],
  },

  {
    id: "customers",
    title: "Customers, khata and offers",
    blurb: "Who owes the shop money, and what the shop takes off a bill.",
    steps: [
      {
        id: "khata",
        title: "Customers and credit",
        summary: "The customer book. In this market it is mostly about who owes what.",
        screen: "/tenant/customers",
        module: "customers",
        required: "module",
        what: [
          "A customer is found at the till BY PHONE and by nothing else. A customer without a phone can be recorded but can never be attached to a sale — which is why a credit limit on a customer with no phone is refused when it is set, rather than discovered at the counter.",
          "A credit (khata) sale puts the amount on the customer's balance. A repayment brings it down. The statement is the running list, and the balance must be re-derivable from it.",
          "Loyalty points, where the shop runs them, are earned on a sale and redeemed at the till.",
        ],
        checks: [
          { do: "Add a customer with a phone and a credit limit. Sell to them on credit up to the limit, then past it.", expect: "The first goes through, the second is refused with the limit named." },
          { do: "Record a repayment.", expect: "The balance falls by exactly that, on the customer card, in the customer list and in the statement — all three, and they must agree." },
          { do: "Try to give a credit limit to a customer with no phone.", expect: "Refused, and told why. Accepting it would create a khata nobody can ever use." },
        ],
      },
      {
        id: "offers",
        title: "Coupons, promotions and bank offers",
        summary: "Three different ways money comes off a bill, and three different people who set them up.",
        screen: "/tenant/coupons",
        module: "promotions",
        required: "module",
        what: [
          "A COUPON is a code the customer hands over. A PROMOTION applies itself when the basket qualifies — buy one get one, a percentage off a category, a happy hour. A BANK OFFER is a discount the BANK funds on its own cards, and it is its own module because almost nobody outside a mid-sized retailer runs one.",
          "All three are checked by the server as the sale is rung, so nobody at a counter can make an expired offer work.",
        ],
        checks: [
          { do: "Make a coupon, use it, and use it again past its limit or its date.", expect: "Accepted the first time, refused after, with the reason." },
          { do: "Make a buy-one-get-one promotion and ring two of the item.", expect: "The discount applies itself with nothing typed, and the receipt says what came off." },
          { do: "Check a coupon at the till as a CASHIER.", expect: "Allowed. Creating one is marketing; checking the one in a customer's hand is the counter's job, and requiring the first to do the second was a real defect here." },
        ],
      },
    ],
  },

  {
    id: "doors",
    title: "The other ways a sale happens",
    blurb: "The counter is not the only door. Every one of these ends in the same Sale row and must move the same drawer.",
    steps: [
      {
        id: "sales-refunds",
        title: "Sales, refunds and exchanges",
        summary: "The record of everything sold, and the two ways money goes back.",
        screen: "/tenant/sales",
        module: "pos",
        required: "module",
        what: [
          "The sales list is every sale by every door. Search it by receipt number, by the customer's phone, or by the OFF- slip number a customer is holding from an offline sale.",
          "A refund gives money back and puts stock back. An EXCHANGE swaps goods and settles the difference — the two are different because one moves money out and the other may move it either way.",
          "A void (cancel) is not a refund: it unwinds a sale that should never have been rung.",
          "Revenue is reported GROSS with refunds as their own dated line. A refund is dated by the day it was handed back, because netting it into the original day would rewrite a day that has been closed and banked.",
        ],
        checks: [
          { do: "Refund one line of a two-line sale.", expect: "Money out matches that line, that line's stock comes back, and the sale is marked partially refunded — and it is STILL counted in the day's sales. A whole ticket vanishing from a report because one item came back is a defect this product has had." },
          { do: "Search for a sale by the customer's phone, then by an OFF- slip number.", expect: "Both find it." },
          { do: "Void a sale.", expect: "Stock returns, the drawer moves back, and the sale reads cancelled rather than disappearing." },
        ],
      },
      {
        id: "documents",
        title: "Quotes and advances",
        summary: "A price promised before there is a sale, and money taken before the goods go.",
        screen: "/tenant/documents",
        module: "documents",
        required: "module",
        what: [
          "A quotation is a price the shop has promised. An advance is money taken against goods not yet handed over. Both end at the counter: converting one produces a real sale and moves the drawer.",
          "Its own module because a counter that only rings and hands over has no use for either.",
        ],
        checks: [
          { do: "Write a quote, then convert it.", expect: "A sale is created for the quoted amount, and the DRAWER moves by it. A door that creates a sale without touching the drawer is a defect this product has had — check the drawer every time." },
          { do: "Take an advance, then complete the order later.", expect: "The advance is deducted from what is still owed, and both movements are on the day." },
        ],
      },
      {
        id: "kitchen",
        title: "Dine-in, the kitchen pass, and takeaway",
        summary: "How a food shop's order reaches the people who have to cook it.",
        screen: "/tenant/kitchen",
        module: "kitchen",
        trades: ["food"],
        required: "module",
        what: [
          "Two different modules, and this is worth understanding before testing either. The KITCHEN PASS is the screen on the kitchen wall — what to cook, oldest first, bumped when it is ready. DINE-IN is a floor of tables with running tabs, settle and split bills.",
          "A takeaway café needs the pass and no floor at all, which is why they are separate. Dine-in depends on the pass, because a Fire button whose ticket lands nowhere would be a floor with no kitchen.",
          "A takeaway rung at the TILL now reaches the pass by itself the moment it is paid. Only the things a kitchen makes are on the docket — a bottle off the chiller is not work for the pass.",
        ],
        checks: [
          { do: "With only the Kitchen module on, ring a takeaway with a dish and a bottle of water.", expect: "A docket appears on the pass carrying the DISH only, headed by the customer's name if one was typed, and carrying the sale's own receipt number." },
          { do: "Mark it served.", expect: "It leaves the board and closes itself. There is no bill left to settle — it was paid at the counter." },
          { do: "Switch Dine-in on as well. Open a tab on a table, add items, fire, settle.", expect: "The tab appears on the FLOOR; the takeaway orders do not. A paid counter order showing up on the floor as an open table would be a bug." },
          { do: "Cancel a tab that has fired dockets.", expect: "Its dockets leave the pass. A docket outliving its tab is a defect this product has had." },
        ],
      },
      {
        id: "online",
        title: "Online orders, delivery and the storefront",
        summary: "The shop's page on the internet, and the orders that come from it.",
        screen: "/tenant/orders",
        module: "marketplace",
        required: "module",
        what: [
          "The marketplace is a shopper's view across shops. A customer builds a basket, checks out, and the shop sees an order. Delivery adds riders; a shop can take phone and WhatsApp orders through the same screen with no storefront at all.",
          "An order for a multi-branch shop is filled by the nearest branch that holds the WHOLE basket — not by splitting it.",
          "Where the MONEY was taken is not the same question as where the order came from. A pickup order collected at the counter moves the drawer; a delivery does not.",
        ],
        checks: [
          { do: "Place an order from the storefront as a customer, then accept it in the shop.", expect: "It appears with the right items and total, and the customer's own order screen follows its status." },
          { do: "Collect a pickup order at the counter.", expect: "The drawer moves. A delivery order settled elsewhere must NOT move it." },
          { do: "Order something the shop has none of.", expect: "Refused with the item named, not accepted and silently short." },
        ],
      },
    ],
  },

  {
    id: "money",
    title: "Money in and money out",
    blurb: "Everything that is not a sale: bills, other income, the cashbook and the ledger.",
    steps: [
      {
        id: "expenses",
        title: "Expenses, income and the cashbook",
        summary: "What the shop spends and takes that has nothing to do with selling.",
        screen: "/tenant/expenses",
        module: "expenses",
        required: "module",
        what: [
          "Rent, salaries, electricity, a chai run — and other income like a rebate or scrap sale. Categories come from the trade when the shop is created.",
          "An expense can be linked to the DRAWER (money physically out of the till) or not. Only the linked ones affect a shift.",
          "Recurring entries fall DUE and are posted by somebody — they never post themselves silently.",
          "The cashbook is the day-by-day version of all of it, and the ledger is the running balance underneath.",
        ],
        checks: [
          { do: "Record a cash expense against the open shift.", expect: "The drawer's expected cash falls by it, and it is on the Z-read as a payout." },
          { do: "Record a non-cash expense (a bank transfer).", expect: "It is in the books and the drawer does NOT move." },
          { do: "Set a recurring monthly bill and travel past its date.", expect: "It shows as DUE. It must not post itself — a bill that pays itself is a bug." },
          { do: "Check the totals with two shops in the system.", expect: "Each shop's totals are its own. A total that sums every tenant is a defect this product has had." },
        ],
      },
      {
        id: "reports",
        title: "Reports",
        summary: "The numbers an owner actually reads, and the rules behind them.",
        screen: "/tenant/reports",
        required: "always",
        what: [
          "Sales, margins, tax, top products, staff, stock valuation. Every one of them must be re-derivable from the sales underneath it — that is the test.",
          "Revenue is GROSS with refunds shown as their own line. The margin report is the exception and nets at line level, because it is keyed to the day of SALE and has no per-item refund column.",
          "The tax year here runs 1 July to 30 June, beside the calendar year. Both are offered; quarters are unchanged.",
        ],
        checks: [
          { do: "Ring a known set of sales, then read the sales report for that day.", expect: "The total equals what you rang. Do the arithmetic by hand once — this is the single most valuable hour a tester spends on this product." },
          { do: "Refund part of a sale and re-read.", expect: "Revenue stays gross, a refunds line appears with the amount, and profit has the refund taken off." },
          { do: "Read the same day on the dashboard, the cashbook, the Z-read and the sales report.", expect: "They agree. Where they cannot (gross vs net), the screen says which it is showing." },
          { do: "Switch to the tax year.", expect: "The window is 1 Jul – 30 Jun, and the figures inside it add up to the months it covers." },
        ],
      },
    ],
  },

  {
    id: "people",
    title: "People, branches and trades",
    blurb: "Who works here, where, and what a shop of this kind gets that others do not.",
    steps: [
      {
        id: "staff",
        title: "Staff and permissions",
        summary: "There are no job roles in this product. A job is a set of permissions.",
        screen: "/tenant/staff",
        required: "always",
        what: [
          "Adding a cashier means granting the permissions a cashier needs. There are PRESETS — cashier, waiter, kitchen, stock keeper — but they are shortcuts that fill in a set, not roles with rules of their own.",
          "This matters for testing: every question about what somebody can do is answered by the permission list on their own record, and nowhere else.",
          "A staff member belongs to a BRANCH. That is which stock their till sells from, so it is not a cosmetic field.",
          "Activity is the audit trail — who changed what, including the things that move money like a credit limit.",
        ],
        checks: [
          { do: "Create a staff member with the Cashier preset.", expect: "Every screen the preset needs is reachable and every screen it does not is refused — both, from the same login. A job offered whose screens all bounce is a defect this product has had." },
          { do: "Change somebody's branch, sign in as them and ring a sale.", expect: "Stock moves in the NEW branch." },
          { do: "Change a customer's credit limit, then open Activity.", expect: "The change is there with the old and new value. A permission change being logged while a money change is not was a real defect." },
        ],
      },
      {
        id: "branches",
        title: "Branches",
        summary: "A shop with more than one site. Most of the hard bugs in this product live here.",
        screen: "/tenant/branches",
        required: "optional",
        what: [
          "Every shop has one branch called Main from the moment it exists, even if it never adds another. The Branches screen only appears once the shop's plan allows more than one.",
          "Stock, tills, shifts, days and prices can all be per-branch. A transfer moves stock between them.",
          "The header says which branch you are operating. Nearly every wrong-branch bug in this product's history has been a screen that ignored it.",
        ],
        checks: [
          { do: "Add a second branch, put stock in it, and switch to it in the header.", expect: "Stock, sales and reports all follow the switch." },
          { do: "Adjust stock while operating branch two.", expect: "Branch two moves. Adjustments always landing on Main is a defect this product has had." },
          { do: "Transfer stock from one branch to the other.", expect: "One falls by exactly what the other rises by." },
        ],
      },
      {
        id: "trades",
        title: "What each trade gets that others do not",
        summary: "The screens that exist for one kind of shop. Do not report them missing elsewhere.",
        required: "trade",
        what: [
          "PHARMACY — a dispensing register, batches with expiry (a medicine batch MUST have one), oldest-expiring sold first, near-expiry alerts, and prescription capture. Schedule-controlled medicine is refused through every door, not just the till.",
          "AUTOMOTIVE — vehicles by number plate with a service history, a bay board of cars taken in, trade-in as a TENDER (not a discount), and DOT date reading on tyres so the oldest stock goes first.",
          "PETROLEUM — tanks, pumps and nozzles, a forecourt shift that reads every meter and dips every tank, tanker deliveries, and rates that must not reprice a pump before the day they start.",
          "FOOD — dishes with recipes and per-size recipes, modifiers, the kitchen pass and dine-in.",
          "SERVICES — labour billed with or without a catalog, and a public portfolio.",
          "FINANCE — a books-only office: no till, no catalog, no stock. It still keeps a cashbook, and that is the whole product for them.",
        ],
        checks: [
          { do: "Open a shop of each trade you have access to and read its sidebar.", expect: "Each gets its own daily screen — the pass for a restaurant, the bay board for a workshop, the register for a chemist, the forecourt for a station." },
          { do: "Try to add a medicine batch with no expiry date.", expect: "Refused. For a chemist an expiry is not optional." },
          { do: "Look for Dine-in on a pharmacy.", expect: "Not there, and that is correct. This is the TRADE axis, not a bug." },
        ],
      },
    ],
  },

  {
    id: "offline",
    title: "Selling with no internet",
    blurb: "The hardest part of this product to test, and the part a shop notices most.",
    steps: [
      {
        id: "offline-ready",
        title: "Getting a till ready",
        summary: "A device has to be registered and primed before it can trade through a cut.",
        screen: "/tenant/settings",
        module: "pos",
        required: "optional",
        what: [
          "The till keeps its own copy of the catalog, the barcodes, the tax rules and the shop's settings. Without that copy there is nothing to sell from.",
          "Each tablet is a DEVICE with a name. Name them: the offline report puts that name against every late sale, and three tills all reading 'Unnamed till' tell an owner nothing.",
          "It is best installed to the home screen. A browser tab holds its data far less reliably, and on an iPad it is the only thing that makes a real difference.",
        ],
        checks: [
          { do: "Open Settings → Point of Sale → the till devices panel.", expect: "This device is listed, can be named, and the readiness line says whether it can sell offline yet." },
          { do: "Let it finish its first sync.", expect: "It reports what it saved — products, barcodes, settings — and says plainly what it did NOT save (photos, past sales, reports)." },
        ],
      },
      {
        id: "offline-selling",
        title: "Trading through a cut",
        summary: "Pull the plug and keep selling. This can only be tested in a real browser.",
        screen: "/tenant/pos",
        module: "pos",
        required: "optional",
        what: [
          "With the line down the till keeps selling from its own copy. Each sale gets an OFF- slip number that is unique to that device, so two tills can never print the same one.",
          "A shift can be opened and counted out offline too. The Z-read is PROVISIONAL until the queue has drained, and the till says so.",
          "When the line returns the queue drains by itself. Sales are filed against the day they HAPPENED, not the day they arrived.",
          "A ticket parked while offline is parked on that till only, and the till says so — it cannot be picked up at another lane until the line is back.",
        ],
        checks: [
          { do: "Turn the network off in the browser's dev tools (not the wifi — the browser must believe it is offline), then reload the till.", expect: "It still opens, still lists products, and still lets you open a shift and sell." },
          { do: "Ring three sales and read the slip numbers.", expect: "All OFF-, all different, and the customer can be found by one of them later." },
          { do: "Count the drawer out, still offline.", expect: "Accepted, and the till says the figures are provisional until the queue drains." },
          { do: "Turn the network back on.", expect: "The badge counts down and empties. Every sale lands on the day it was rung." },
          { do: "Open Reports → Offline the next morning.", expect: "What came in late, from which till, what broke a rule, what landed after a day was closed (in rupees), which shifts ran with no server, and which tablets have the wrong clock." },
        ],
        wrong: [
          "A sale that reaches the server twice. Ring one, sync, then sync again — there must still be one sale.",
          "Stock going negative without the recount list on Reports → Offline naming the item. Two tills each selling the last carton is not a bug; not being told is.",
        ],
      },
    ],
  },

  {
    id: "settings",
    title: "Settings, one tab at a time",
    blurb: "What every switch is for, and whether a shop has to touch it. This is the section testers usually skip and should not.",
    steps: [
      {
        id: "settings-tabs",
        title: "The tabs, and who gets which",
        summary: "A shop is only shown the settings it can use.",
        screen: "/tenant/settings",
        required: "always",
        what: [
          "BUSINESS — name, contact, address and the map pin. Every shop has this, including a books-only office: it still puts its name on what it sends out. REQUIRED.",
          "YOUR MODULES — read-only, what this shop was given. Always there.",
          "TAX & DELIVERY — tax rates, whether prices include tax, and delivery charges. Only for a shop that sells something.",
          "POINT OF SALE — how the till behaves: whether a shift is required before selling, cash rounding, the drawer ceiling, note-by-note counting, blind close, idle lock, receipt printing, the kitchen's own sub-tab. Needs the till module.",
          "LOYALTY — how points are earned and redeemed. Needs the customer book, because there is nobody to award them to without one.",
          "RECEIPT — what the printed receipt says and shows, previewed live. Only for a shop that sells.",
          "HARDWARE — the counter's own kit: receipt printer, label printer, scanner, cash drawer. Needs the till.",
          "BARCODES — how labels are laid out. Follows the Labels module.",
        ],
        checks: [
          { do: "Open Settings on shops of different trades and modules.", expect: "The tabs differ, and no tab appears whose module is off. A books-only office being offered Point of Sale and Loyalty was a real defect." },
          { do: "Change one switch on each tab, save, and reload.", expect: "It sticks. Then check it actually DOES something — a switch nothing reads is a defect this product has had (an entire 'require an open shift' setting was read by nothing)." },
          { do: "Change the receipt settings.", expect: "The live preview changes with them, and a printed receipt matches the preview." },
        ],
        wrong: [
          "A setting that saves and changes no behaviour anywhere. Test the switch by its EFFECT, never by whether the save succeeded.",
        ],
      },
    ],
  },

  {
    id: "admin",
    title: "The admin console",
    blurb: "The platform side. This is where shops are created and where most of your test setup happens.",
    steps: [
      {
        id: "admin-tenants",
        title: "Businesses, plans and billing",
        summary: "Creating a shop, giving it modules and limits, and what it pays.",
        screen: "/admin/tenants",
        required: "always",
        what: [
          "Creating a business asks four things in the order the decisions actually happen: who it is (name, type, city), what it can DO (modules), how big it is (branches, staff, lanes) and what it PAYS (plan).",
          "A plan decides price and ceilings only. It grants no modules — so a renewal can never take away something an admin granted.",
          "There is no payment gateway anywhere in this product. Billing is recorded, not collected.",
        ],
        checks: [
          { do: "Create a business of each trade.", expect: "Its modules are proposed for that trade and can be adjusted before saving. What you saved is what the shop then has." },
          { do: "Change a shop's plan.", expect: "Its modules do not move. A plan change silently revoking a module would be a serious bug." },
          { do: "Count the businesses on the console against the tenant list.", expect: "Demo shops are not counted as businesses. They were once, and it made the number wrong by more than half." },
        ],
      },
    ],
  },

  {
    id: "reporting",
    title: "Reporting what you find",
    blurb: "How to write it up so it can be fixed rather than argued about.",
    steps: [
      {
        id: "how-to-report",
        title: "Before you file it",
        summary: "Three questions that resolve most reports before they are written.",
        required: "always",
        what: [
          "Ask the three axes first: is the MODULE on, does this TRADE have the screen, and does this PERSON hold the permission? Most first-week reports answer themselves here.",
          "Then ask whether the figure you disagree with is GROSS or NET, and which day it belongs to. Revenue is gross with refunds as their own line; a refund belongs to the day it was handed back.",
          "A count with no denominator is not evidence. 'Three screens are wrong' means nothing without 'out of how many I checked'.",
        ],
        checks: [
          { do: "Write the shop, the branch, the person, the screen and the exact time.", expect: "Somebody else can reproduce it without asking you a single question." },
          { do: "Say what you EXPECTED and where that expectation came from — a figure you added up by hand, another screen, or this walkthrough.", expect: "The report names the disagreement, not just the screen." },
          { do: "For anything about money, include the sales it should be derived from.", expect: "The fix can be checked against the same arithmetic you did." },
        ],
      },
    ],
  },
];
