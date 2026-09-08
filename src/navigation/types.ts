import type { BrowseFilters } from "../modules/marketplace/services/marketplaceService";

// ── Customer side ───────────────────────────────────────────────────
// Footer (user-approved): Food · Grocery · [Cart FAB] · Orders · Account
export type CustomerTabParamList = {
  FoodTab: undefined;
  GroceryTab: { business_type?: string; title?: string } | undefined;
  CartTab: undefined;
  OrdersTab: undefined;
  AccountTab: undefined;
};

export type CustomerStackParamList = {
  Tabs: undefined;
  MarketShop: { slug: string; productId?: string };
  Checkout: { slug: string };
  Search: undefined;
  ShopList: { business_type?: string; title?: string } | undefined;
  Order: { id: string };
  Location: undefined;
  Favorites: undefined;
  Reservations: undefined;
  Notifications: undefined;
  Addresses: undefined;
  Settings: undefined;
  Security: undefined;
  Reviews: undefined;
  Help: undefined;
  Profile: undefined;
  Browse:
    | { q?: string; business_type?: string; title?: string; filters?: BrowseFilters }
    | undefined;
  /**
   * Every trade on one page.
   *
   * No params: it reads the same cached home feed the tiles came from, so
   * there is nothing to pass and nothing that could disagree with what the
   * home screen showed.
   */
  Categories: undefined;

  // The rider hat. Same stack as the shopping screens on purpose — one
  // account wears both, and a separate navigator would mean signing out of
  // one to reach the other.
  RiderApply: undefined;
  RiderHome: undefined;
  RiderJob: { id: string };
  RiderEarnings: undefined;

  // Modals. A guest browses the whole app and is asked to sign in only where an
  // account is genuinely required, without losing the screen they were on.
  SignIn: undefined;
  SignUp: undefined;
};

/**
 * RIDER MODE — a different app in the same binary.
 *
 * Not a section of the shopping stack. A rider on shift had Food, Grocery and
 * a basket along the bottom of every screen: five controls that have nothing
 * to do with the job in their hand, and no way to put the shopping half away.
 *
 * Three tabs, because a working day has three questions: what am I carrying,
 * what have I made, and who am I. The basket is gone on purpose — somebody
 * delivering is not shopping, and if they want to be, they switch back.
 */
export type RiderTabParamList = {
  RiderBoardTab: undefined;
  RiderEarningsTab: undefined;
  RiderAccountTab: undefined;
};

/**
 * What a rider can reach while on shift.
 *
 * Deliberately short. Everything here is either the job, the money, or the
 * account — and the account screens are the SAME components the shopping side
 * uses, because a person's name and their settings do not change with the hat.
 */
export type RiderStackParamList = {
  RiderTabs: undefined;
  RiderJob: { id: string };
  RiderApply: undefined;
  Profile: undefined;
  Settings: undefined;
  Security: undefined;
  Help: undefined;
  Notifications: undefined;
};

/**
 * Three destinations, not four.
 *
 * The business side USED to live here — a shop's dashboard, items, sales and
 * expenses, plus the onboarding gate in front of them. It is gone on purpose:
 * this app is for customers and riders, and a shop is run from the web panel,
 * which already sells with no network. See `BusinessAccountScreen`, which is
 * what a shop's account now lands on.
 *
 * The rider side is NOT a fourth entry: it lives inside `Customer`, on the
 * same stack, reached by a link in the side menu. One account, two hats — and
 * a separate root would have meant signing out of one to reach the other.
 */
export type RootStackParamList = {
  /** Guests and customers alike — see `RootNavigator` for why they share one. */
  Customer: undefined;
  /** The same account, on shift. Only reachable while the server approves it. */
  Rider: undefined;
  BusinessAccount: undefined;
};
