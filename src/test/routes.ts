/**
 * Every shop-side route App.tsx declares, written out as the contract.
 *
 * Two things offer these screens — the sidebar and the dashboard — and a third
 * decides who may open them (screenPermissions). Keeping the list in one place
 * means a new screen fails the tests once, here, rather than passing three
 * suites that each hold their own idea of what exists.
 *
 * Parameterised children (`stocktake/:id`, `documents/:id`) are left out: no
 * menu or tile ever produces one.
 */
export const TENANT_ROUTES = new Set([
  "/tenant",
  "/tenant/setup",
  "/tenant/pos",
  "/tenant/dine-in",
  "/tenant/kitchen",
  "/tenant/sales",
  "/tenant/sales/new",
  "/tenant/day",
  "/tenant/documents",
  "/tenant/orders",
  "/tenant/orders/new",
  "/tenant/riders",
  "/tenant/fuel",
  "/tenant/fuel/deliveries",
  "/tenant/fuel/setup",
  "/tenant/cashbook",
  "/tenant/income",
  "/tenant/expenses",
  "/tenant/ledger",
  "/tenant/branches",
  "/tenant/transfers",
  "/tenant/products",
  "/tenant/products/new",
  "/tenant/categories",
  "/tenant/collections",
  "/tenant/inventory",
  "/tenant/disposals",
  "/tenant/stocktake",
  "/tenant/labels",
  "/tenant/suppliers",
  "/tenant/purchases",
  "/tenant/customers",
  "/tenant/coupons",
  "/tenant/promotions",
  "/tenant/bank-offers",
  "/tenant/reviews",
  "/tenant/reservations",
  "/tenant/reports",
  "/tenant/staff",
  "/tenant/pharmacy",
  "/tenant/vehicles",
  "/tenant/workshop",
  "/tenant/warranty",
  "/tenant/portfolio",
  "/tenant/subscription",
  "/tenant/settings",
  "/tenant/activity",
  "/tenant/security",
  "/tenant/help",
]);
