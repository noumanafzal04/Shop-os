// ── Guest (unauthenticated) ─────────────────────────────────────────
export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  Market: undefined;
  MarketShop: { slug: string };
};

// ── Business side (shop owner / staff) ──────────────────────────────
export type ShopTabParamList = {
  HomeTab: undefined;
  ProductsTab: undefined;
  SalesTab: undefined;
  ExpensesTab: undefined;
};

export type ShopStackParamList = {
  Tabs: undefined;
  ProductForm: undefined;
  NewSale: undefined;
  AddExpense: undefined;
  AdjustStock: {
    productId: string;
    productName: string;
    stock: number;
  };
};

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
  MarketShop: { slug: string };
  Checkout: { slug: string };
  Search: undefined;
  ShopList: { business_type?: string; title?: string } | undefined;
  Order: { id: string };
  Location: undefined;
  Favorites: undefined;
  Reservations: undefined;
  Notifications: undefined;
  Addresses: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Shop: undefined;
  Customer: undefined;
  ShopSetup: undefined;
};
