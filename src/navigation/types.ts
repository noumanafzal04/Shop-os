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
  Help: undefined;
  Profile: undefined;
  Browse:
    | { q?: string; business_type?: string; title?: string; filters?: BrowseFilters }
    | undefined;

  // Modals. A guest browses the whole app and is asked to sign in only where an
  // account is genuinely required, without losing the screen they were on.
  SignIn: undefined;
  SignUp: undefined;
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
 * The rider side will be a fourth entry here, reached by a switch in the
 * account menu rather than by a different login — one account, two hats.
 */
export type RootStackParamList = {
  /** Guests and customers alike — see `RootNavigator` for why they share one. */
  Customer: undefined;
  BusinessAccount: undefined;
};
