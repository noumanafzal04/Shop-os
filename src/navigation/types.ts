import type { NavigatorScreenParams } from "@react-navigation/native";
import type { PartnerTab } from "./tabsFor";

/**
 * The tab names ARE the route names, and each tab that holds a stack declares
 * that stack's params.
 *
 * `NavigatorScreenParams` is what makes `navigate("Menu", { screen:
 * "Categories" })` type-check — the sidebar reaches INTO another tab's stack,
 * which is its whole point: a shopkeeper opening Categories should not have to
 * know it lives behind Menu.
 *
 * The `satisfies` below is what keeps the old guarantee: a tab that exists in
 * the bar and not here is a type error rather than a dead press.
 */
export type PartnerTabParamList = {
  Dashboard: undefined;
  Orders: NavigatorScreenParams<OrdersStackParamList> | undefined;
  Menu: NavigatorScreenParams<MenuStackParamList> | undefined;
  Money: NavigatorScreenParams<MoneyStackParamList> | undefined;
  Account: NavigatorScreenParams<AccountStackParamList> | undefined;
};

/** Every tab the bar can draw has params declared above. */
export type TabsAreCovered = PartnerTab extends keyof PartnerTabParamList ? true : never;
const _tabsAreCovered: TabsAreCovered = true;
void _tabsAreCovered;

/**
 * Orders is a STACK inside its tab, not a screen.
 *
 * An order's detail belongs behind its own row — pushed, so Back returns to
 * the queue at the scroll position it was left at, and so the tab bar stays
 * visible while somebody works through several orders in a row.
 */
export type OrdersStackParamList = {
  OrdersQueue: undefined;
  OrderDetail: { id: string };
};

/** The menu list, and one item behind it. Same shape and reason as Orders. */
export type MenuStackParamList = {
  MenuList: undefined;
  ProductDetail: { id: string };
  /** Add an item. Editing an existing one is `ProductDetail`. */
  ProductForm: undefined;
  Categories: undefined;
  Collections: undefined;
};

/** The figures, with commission and expense entry behind them. */
export type MoneyStackParamList = {
  MoneyHome: undefined;
  Commission: undefined;
  ExpenseEntry: undefined;
};

/**
 * Shop settings live behind Account, not in a sixth tab.
 *
 * Six tabs on a phone is a row of icons nobody reads, and settings are opened
 * once a month. The one setting that IS urgent during a shift — whether the
 * shop is open — is not a setting at all: it comes from the opening hours.
 */
export type AccountStackParamList = {
  AccountHome: undefined;
  Shop: undefined;
  Hours: undefined;
  Help: undefined;
};

export type RootStackParamList = {
  SignIn: undefined;
  /**
   * NESTED, because the sidebar addresses a screen two levels down.
   *
   * `DrawerHost` wraps the tab navigator, so its `useNavigation` is the ROOT
   * stack's — not the tabs'. Asking the root to `navigate("Menu", ...)` is
   * asking for a route it does not have: react-navigation quietly does
   * nothing, the panel closes, and the shopkeeper is left on the screen they
   * started on with no error. The whole path has to be spelled out from where
   * the navigator actually is.
   */
  Tabs: NavigatorScreenParams<PartnerTabParamList> | undefined;
};
