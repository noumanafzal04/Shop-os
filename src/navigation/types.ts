import type { PartnerTab } from "./tabsFor";

/**
 * The tab names ARE the route names. One list, so a tab that exists in the bar
 * and not in the navigator is a type error rather than a dead press.
 */
export type PartnerTabParamList = Record<PartnerTab, undefined>;

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
};

export type RootStackParamList = {
  SignIn: undefined;
  Tabs: undefined;
};
