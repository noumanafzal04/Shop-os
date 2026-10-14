import type React from "react";

import {
  BarChartIcon,
  BoltIcon,
  BookmarkIcon,
  BoxIcon,
  CalenderIcon,
  CopyIcon,
  DocsIcon,
  DollarLineIcon,
  FileIcon,
  FolderIcon,
  GridIcon,
  GroupIcon,
  InfoIcon,
  ListIcon,
  PaperPlaneIcon,
  PieChartIcon,
  PlugInIcon,
  ShootingStarIcon,
  TableIcon,
  TagIcon,
  TaskIcon,
  TimeIcon,
  TruckIcon,
  UserCircleIcon,
  UserIcon,
} from "../icons";
import type { UiMode } from "../context/UiModeContext";
import { canVisit } from "../common/routing/screenPermissions";
import { tracksSerials } from "../common/tenant/businessType";
import { kindOfBusiness } from "../common/tenant/kindOfBusiness";
import { allItemsWord, itemsWord } from "../modules/catalog/itemsWord";
import { boardWords, hasJobBoard } from "../modules/workshop/words";
import type { NavItem, SubItem } from "./navItem";
import { NO_CHOICE, keepOnly, simplePaths, tidy, type SimpleChoice } from "./simpleMenu";

/** The shop rail's three parts, in the order a day uses them. */
export const DAILY = "Daily work";
export const MANAGE = "Manage";
export const SHOP = "Your shop";

/** Put a run of rows under one heading. */
const under = (section: string, items: NavItem[]): NavItem[] => items.map((i) => ({ ...i, section }));

/** Every screen in a run is part of the day — see `usual` on NavItem. */
const everyDay = (items: NavItem[]): NavItem[] => items.map((item) => ({
  ...item,
  usual: true,
  subItems: item.subItems?.map((sub) => ({ ...sub, usual: true })),
}));

/** A group, if it has anything in it. A heading over nothing is never built. */
const group = (icon: React.ReactNode, name: string, subItems: SubItem[]): NavItem[] =>
  (subItems.length > 0 ? [{ icon, name, subItems }] : []);

/**
 * THE SHOP'S MENU, IN FULL — every screen this shop has and this person may
 * open, grouped the way a shop is run.
 *
 * Three axes decide what a person sees, and all three have to agree:
 *
 *   MODULE  — what the shop bought (`features`)
 *   TRADE   — what the shop is (`businessType`, already resolved to a current
 *             code, so an old `clinic` still gets the chemist's register)
 *   PERSON  — what this user may do (`can`)
 *
 * The third was missing: a cashier with only sales.manage was offered Staff,
 * Reports and Suppliers and got a 403 from each. Which permission each screen
 * needs is NOT written here — it lives in screenPermissions, the one map the
 * dashboard tiles read as well, because two lists of the same rule is how the
 * menu and the dashboard end up disagreeing about the same cashier.
 *
 * ── How it is laid out, and why it changed ─────────────────────────────
 *
 *     "sidebar k label b achy krna — kisi ko catalog ka pta b ni hota — to
 *      achy way menu sub menu banana ta k hr cheez asani sy mile, jo jis k
 *      related, or standard"
 *
 * The folders were named by whoever built them. "Catalog" held the products.
 * "Inventory" held the stock and also the suppliers, the purchase orders and
 * the barcode printer. "Customers" held the customers and also every coupon.
 * "More" held Reports and Staff — the two screens an owner opens most — next
 * to a warranty lookup, under a name that says nothing at all.
 *
 * Each group is now one job, under the word a shopkeeper or any other till
 * system would use for it:
 *
 *   Daily work   what is open all day: the till, the floor, the orders
 *   Manage       Products · Inventory · Purchases · Customers · Offers &
 *                discounts · Expense Manager · Reports
 *   Your shop    Staff · Branches & warehouses · Subscription · Settings · Help
 *
 * A group is named for the MODULE it is sold as wherever there is one, so the
 * word on the plan and the word on the menu are the same word.
 */
export function shopMenuInFull(
  features: Record<string, boolean> | undefined,
  businessType: string | null | undefined,
  /** May the business have more than one place — or has it already. Who gets the places screen. */
  multiBranch: boolean,
  can: (permission: string) => boolean = () => true,
  /**
   * Is there a second place open TODAY. Left out, it follows `multiBranch` —
   * what every caller meant before the two were told apart.
   */
  secondPlace: boolean = multiBranch,
): NavItem[] {
  // A capability shows only when its flag is explicitly on. Types that don't
  // offer a feature omit its key entirely (e.g. pharmacy has no `dine_in`), so
  // a missing key must read as OFF — never default to true, or a pharmacy ends
  // up with a Dine-in link.
  const has = (key: string) => features?.[key] ?? false;

  // A books-only tenant (Finance Manager) sells nothing and has no till, so it
  // must not see a Sales ledger or a product list it can never fill. Derive
  // both from capability, not business type — a shop that later buys the POS
  // module gets them back automatically.
  const canSell = has("pos") || has("marketplace");
  const hasCatalog = has("products") || has("services");
  const hasSomethingToSell = canSell || hasCatalog;

  /**
   * The one screen this trade's day actually runs on, beside the till.
   *
   * A restaurant's is the kitchen pass; a workshop's is the board of cars in
   * the bay; a chemist's is the dispensing register; a station's is the shift.
   * These used to live in "More" — a dropdown — while Simple mode dropped them
   * altogether, so a workshop's calm view offered Products and withheld the
   * board its whole day is spent on.
   */
  const tradeDaily: NavItem[] = [
    // The pass lives on a different wall from the till: same shop, two people,
    // two displays. Its own module now — a takeaway counter needs a slip to the
    // kitchen and does not need a floor of tables, and used to have to switch
    // on the whole restaurant to get one.
    ...(has("kitchen") ? [{ icon: <TaskIcon />, name: "Kitchen", path: "/tenant/kitchen" }] : []),
    // The board of work TAKEN IN — every car in the bay, or every job on the
    // rail. A laundry, a tailor and a repair counter all run exactly this.
    ...(has("pos") && hasJobBoard(businessType)
      ? [{ icon: <TaskIcon />, name: boardWords(businessType).board, path: "/tenant/workshop" }]
      : []),
    // The chemist's paperwork: the dispensing register and batch recall.
    // Pharmacy-only — a mart that happens to stock paracetamol keeps no
    // register, and the page would be an empty table forever.
    ...(has("inventory") && businessType === "pharmacy"
      ? [{ icon: <ListIcon />, name: "Dispensary", path: "/tenant/pharmacy" }]
      : []),
  ];

  // The forecourt. A station runs its day off the shift, so it sits with the
  // daily screens rather than buried in setup — the equipment page is its
  // sub-item because it's touched once and then left alone.
  const forecourt: NavItem[] = has("fuel")
    ? [{
        icon: <BoltIcon />,
        name: "Forecourt",
        subItems: [
          // A forecourt shift ends by setting fuel stock to the dip, so it is a
          // stock correction; a tanker is goods received; the plant is
          // configuration. Three screens, three different people.
          { name: "Shifts", path: "/tenant/fuel", home: true },
          { name: "Deliveries & rates", path: "/tenant/fuel/deliveries" },
          { name: "Tanks & pumps", path: "/tenant/fuel/setup" },
        ],
      }]
    : [];

  // The Expense & Income module — one home for all money in/out. All four are
  // part of the day: what was spent is written down when it is spent.
  const expenseManager: NavItem[] = has("expenses")
    ? everyDay([{
        icon: <PieChartIcon />,
        name: "Expense Manager",
        subItems: [
          { name: "Cashbook", path: "/tenant/cashbook" },
          // The book itself: every movement, balance carried down. Sits beside
          // the day summary because they answer the same question at two depths.
          { name: "Ledger", path: "/tenant/ledger" },
          { name: "Income", path: "/tenant/income" },
          { name: "Expenses", path: "/tenant/expenses" },
        ],
      }])
    : [];

  // An office that keeps only its books here has no till and no counter: the
  // cashbook IS its daily work. Under "Manage" it left that business a day
  // with one row in it — the dashboard — and its whole job filed as upkeep.
  const booksAreTheDay = kindOfBusiness(features).noun === "business";

  const daily: NavItem[] = everyDay([
    { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
    // POS till is only for shops on a plan that includes it (not online-only).
    ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
    ...(has("dine_in") ? [{ icon: <TableIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
    // The kitchen pass, the bay board, the dispensing register — whichever of
    // them this trade runs its day on.
    ...tradeDaily,
    ...(canSell ? [{ icon: <FileIcon />, name: "Sales", path: "/tenant/sales" }] : []),
    // The 10pm question: what did the shop take today across every drawer, and
    // how much of it went to the bank. No shift answers it, however well
    // counted — so it sits with the daily screens, not in a reports folder.
    // A cashier is entitled to the record of their own drawer, so it carries
    // the same permission as ringing a sale; the day CLOSE is manager-only,
    // checked on the server.
    ...(has("pos") ? [{ icon: <CalenderIcon />, name: "Day & banking", path: "/tenant/day" }] : []),
    // Promises outstanding: prices quoted, and goods held on advance. Sits
    // beside Sales because it is the same ledger one step earlier — and a
    // shopkeeper holding customers' money needs it where they'll see it daily.
    ...(has("documents") ? [{ icon: <DocsIcon />, name: "Quotes & Advances", path: "/tenant/documents" }] : []),
    ...(has("marketplace") || has("delivery") ? [{ icon: <PaperPlaneIcon />, name: "Orders", path: "/tenant/orders" }] : []),
    // Somebody asked for a table or an appointment and is waiting to hear. It
    // was the last row of the Customers folder — a queue of people, filed with
    // the address book. Still needs something to sell first.
    ...(hasSomethingToSell && has("reservations")
      ? [{ icon: <BookmarkIcon />, name: "Reservations", path: "/tenant/reservations" }]
      : []),
    ...(has("delivery") ? [{ icon: <UserIcon />, name: "Riders", path: "/tenant/riders" }] : []),
    ...forecourt,
    ...(booksAreTheDay ? expenseManager : []),
  ]);

  const manage: NavItem[] = [
    // A books-only business is shown no product list it can never fill and no
    // coupons for sales it never makes — in either view, or the switch between
    // them changes what the business IS, not just how much of it is on screen.
    ...(hasCatalog
      ? group(<BoxIcon />, itemsWord(features), [
          { name: allItemsWord(features), path: "/tenant/products", home: true, usual: true },
          { name: "Categories", path: "/tenant/categories" },
          // Collections merchandise the ONLINE storefront — pointless without it.
          ...(has("marketplace") ? [{ name: "Collections", path: "/tenant/collections" }] : []),
          // A label is printed from the product's record, not from the shelf —
          // which is why it is here and not under Inventory, where it used to
          // sit between the stocktake and the suppliers.
          ...(has("labels") ? [{ name: "Barcode labels", path: "/tenant/labels" }] : []),
          // The public service menu belongs to service businesses — petroleum
          // has the `services` flag for pump labour, but no portfolio to show
          // off. It is what the shop shows the world of what it does, so it
          // sits with the services themselves.
          ...(has("services") && businessType === "services"
            ? [{ name: "Portfolio", path: "/tenant/portfolio" }]
            : []),
        ])
      : []),

    // Stock itself is the module; everything under it is a TOOL a shop can
    // decline. They used to arrive as passengers — switch inventory on for a
    // chemist and it was handed all five, whether or not it had ever disposed
    // of anything.
    ...(has("inventory")
      ? group(<FolderIcon />, "Inventory", [
          { name: "Stock levels", path: "/tenant/inventory", home: true, usual: true },
          // Knowing what each place holds and moving stock between them is
          // stock work, done by whoever keeps the stock — so it is here, and
          // the list of places themselves is with the shop's own settings.
          //
          // Only once there IS a second place. Every plan allows a godown and
          // most shops never have one; shown on the allowance alone, a
          // one-counter grocer got a table with one column in it and a screen
          // for moving stock to nowhere. Add a place and these appear — the
          // way every other stock system does it.
          ...(secondPlace
            ? [
                { name: "Stock by place", path: "/tenant/stock-by-place", usual: true },
                { name: "Stock transfers", path: "/tenant/transfers", usual: true },
              ]
            : []),
          // Counting the shelves against the books. The only way a shop finds
          // out what it is actually losing.
          ...(has("stocktake") ? [{ name: "Stocktake", path: "/tenant/stocktake" }] : []),
          // Where stock went when it left without being sold — and what a
          // distributor still owes for the part that went back.
          ...(has("disposals") ? [{ name: "Disposals", path: "/tenant/disposals" }] : []),
        ])
      : []),

    // Buying is its own job with its own permission: the person who raises an
    // order and pays a supplier is not always the one who counts the shelf.
    // It was the last two rows of a six-row Inventory folder.
    ...(has("inventory") && has("purchasing")
      ? group(<TruckIcon />, "Purchases", [
          { name: "Purchase orders", path: "/tenant/purchases", home: true },
          { name: "Suppliers", path: "/tenant/suppliers" },
        ])
      : []),

    // The people the shop sells to, and what it knows about them. Each row is
    // its own module or its own trade, and the folder exists only if one of
    // them does — a cash-only takeaway counter was once handed a customer
    // book on the strength of having a till.
    ...group(<GroupIcon />, "Customers", [
      ...(hasSomethingToSell && has("customers")
        ? [{ name: "Customer list", path: "/tenant/customers", home: true }]
        : []),
      // A tyre or auto shop's real customer key: the plate, what the car
      // takes, and what was fitted last time. Only the trades that work on
      // vehicles — a grocery would never open it twice. A vehicle IS customer
      // data, so it carries the CRM permission and sits beside the customers.
      //
      // Narrower than the bay board above on purpose: a fuel station keeps
      // vehicle records for its account customers but has no bay.
      ...(has("products") && (businessType === "automotive" || businessType === "petroleum")
        ? [{ name: "Vehicles", path: "/tenant/vehicles" }]
        : []),
      // Serialized goods (phones, electronics, batteries) — a customer brings
      // a unit back and its serial is looked up. The trades that sell a unit
      // somebody returns with; a grocery or pharmacy never does. Same list the
      // product form gates the serial toggle on, so where you turn it on and
      // where you look it up cannot disagree.
      ...(has("pos") && has("inventory") && tracksSerials(businessType)
        ? [{ name: "Warranty desk", path: "/tenant/warranty" }]
        : []),
      // Replying is the only thing anyone does on the reviews screen, and the
      // server asks for settings.manage to do it.
      ...(hasSomethingToSell && has("marketplace") ? [{ name: "Reviews", path: "/tenant/reviews" }] : []),
    ]),

    // What the shop is running to bring people in. It was inside Customers,
    // three rows deep — and a shop looking for "our offers" looks for offers.
    ...(hasSomethingToSell
      ? group(<TagIcon />, "Offers & discounts", [
          ...(has("promotions")
            ? [
                { name: "Coupons", path: "/tenant/coupons" },
                { name: "Promotions", path: "/tenant/promotions" },
              ]
            : []),
          // A bank funding a discount on its own cards: the same kind of thing
          // as a promotion, and the same permission.
          ...(has("bank_offers") ? [{ name: "Bank card offers", path: "/tenant/bank-offers" }] : []),
        ])
      : []),

    ...(booksAreTheDay ? [] : expenseManager),

    // The shop's own numbers. An owner opens this more than anything else in
    // the back office, and it was the first row of a folder called "More".
    { icon: <BarChartIcon />, name: "Reports", path: "/tenant/reports" },

    /**
     * BASIC HR — shown, not yet built.
     *
     * Every screen behind these links renders a "not built yet" notice and
     * talks to nothing. It is here so the module's shape can be reviewed on a
     * real sidebar before any of it exists. `staff.manage` keeps a cashier out
     * of the wage bill, and filterByPermission below applies it.
     *
     * ── Gated now, and the gate was the missing half ───────────────────
     *
     * This used to be ungated "because there is no `hrm` key on the server
     * yet" — true when it was written, still true months later, which is how
     * a placeholder becomes furniture. Every shop on the platform carried a
     * nine-screen HR department in its sidebar: a one-person accountancy
     * office, a filling station, a tyre shop. Eight of those screens say
     * "Not built yet" and the ninth is a dashboard of them.
     *
     * There is an `hrm` key now and no trade gets it by default, so the area
     * appears only where somebody decided it should.
     */
    ...(has("hrm") ? [{
      icon: <TimeIcon />,
      name: "HRM",
      subItems: [
        { name: "Dashboard", path: "/tenant/hrm", home: true },
        { name: "Attendance", path: "/tenant/hrm/attendance" },
        { name: "Leaves", path: "/tenant/hrm/leaves" },
        { name: "Shifts & roster", path: "/tenant/hrm/shifts" },
        { name: "Advances", path: "/tenant/hrm/advances" },
        { name: "Commission", path: "/tenant/hrm/commission" },
        { name: "Payroll", path: "/tenant/hrm/payroll" },
        { name: "Reports", path: "/tenant/hrm/reports" },
        // Last, the way the module's own settings should sit — inside it,
        // not buried among the shop's.
        { name: "HR settings", path: "/tenant/hrm/settings" },
      ],
    }] : []),
  ];

  // The business itself: who works in it, where it is, what it pays, how it is
  // set up — and the way out when somebody is stuck.
  const shop: NavItem[] = [
    ...group(<UserCircleIcon />, "Staff", [
      { name: "Staff list", path: "/tenant/staff", home: true },
      // Who changed what. Beside Staff because it answers the question Staff
      // raises — you granted somebody a permission, and later you want to
      // know what they did with it.
      { name: "Activity log", path: "/tenant/activity" },
    ]),
    // The places a shop has. Adding one is configuration, done once — what
    // each holds is under Inventory. Appears when the plan allows a second
    // place (this is where one is added) or there already is one; a shop
    // that can only ever be one counter is shown no locations manager.
    //
    // On the Simple view only once there is a second place to look after:
    // until then it is a screen for something the shop does not have.
    //
    // Two of the same thing, which is what a branch IS. It wore the cube that
    // Products wears — different components, near-identical pictures, and the
    // icon-uniqueness test cannot see that because it compares names. Some of
    // this only a pair of eyes finds.
    ...(multiBranch
      ? [{ icon: <CopyIcon />, name: "Branches & warehouses", path: "/tenant/branches", usual: secondPlace }]
      : []),
    // What the shop pays the platform is the owner's (2026-10-14, Q7) — the
    // server asks for settings.manage, and screenPermissions says the same.
    { icon: <ShootingStarIcon />, name: "Subscription", path: "/tenant/subscription" },
    { icon: <PlugInIcon />, name: "Settings", path: "/tenant/settings", usual: true },
    // Last, and never gated: anyone in the shop can get stuck, and what the
    // Help Centre SHOWS is already filtered to this shop's modules and to what
    // the reader can open.
    { icon: <InfoIcon />, name: "Help Centre", path: "/tenant/help", usual: true },
  ];

  return filterByPermission([...under(DAILY, daily), ...under(MANAGE, manage), ...under(SHOP, shop)], can);
}

/**
 * The menu the rail draws.
 *
 * Full view is everything. Simple is the same menu with rows left out — the
 * day's work, or whatever this person chose instead — so the two can never
 * disagree about what a screen is called, where it is filed or who may open
 * it. See `simpleMenu.ts`.
 */
export function shopNav(
  features: Record<string, boolean> | undefined,
  businessType: string | null | undefined,
  mode: UiMode,
  multiBranch: boolean,
  can: (permission: string) => boolean = () => true,
  mine: SimpleChoice = NO_CHOICE,
  secondPlace: boolean = multiBranch,
): NavItem[] {
  const full = shopMenuInFull(features, businessType, multiBranch, can, secondPlace);

  return tidy(mode === "basic" ? keepOnly(full, simplePaths(full, mine)) : full);
}

/**
 * Drops the screens this person may not open, per screenPermissions.
 *
 * A dropdown whose every child was dropped goes with them — a group that
 * opens onto nothing is worse than no group at all. A parent with its own
 * path keeps it (nothing today has both).
 */
function filterByPermission(items: NavItem[], can: (permission: string) => boolean): NavItem[] {
  return items
    .filter((item) => item.path === undefined || canVisit(item.path, can))
    .map((item) => (item.subItems
      ? { ...item, subItems: item.subItems.filter((sub) => canVisit(sub.path, can)) }
      : item))
    .filter((item) => item.path !== undefined || (item.subItems?.length ?? 0) > 0);
}
