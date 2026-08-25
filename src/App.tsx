import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequireFeature,
  RequireAdminScreen,
  RequireTenantScreen,
  RequireRole,
  RequireSetupComplete,
  TenantThemed,
} from "./common/routing/guards";

// Route-level code-splitting: each page ships in its own chunk and loads on
// demand, so the initial bundle stays small (ApexCharts, dropzone, etc. only
// download when their page is visited).
const SignIn = lazy(() => import("./pages/AuthPages/SignIn"));
const SignUp = lazy(() => import("./pages/AuthPages/SignUp"));
const NotFound = lazy(() => import("./pages/OtherPage/NotFound"));
const MarketPage = lazy(() => import("./modules/marketplace/pages/MarketPage"));
const LandingPage = lazy(() => import("./modules/landing/pages/LandingPage"));
const DemoPage = lazy(() => import("./modules/landing/pages/DemoPage"));
const MarketShopPage = lazy(() => import("./modules/marketplace/pages/MarketShopPage"));
const MyOrdersPage = lazy(() => import("./modules/orders/pages/MyOrdersPage"));
const OwnerOrdersPage = lazy(() => import("./modules/orders/pages/OwnerOrdersPage"));
const RidersPage = lazy(() => import("./modules/orders/pages/RidersPage"));
const AdminDashboard = lazy(() => import("./pages/Dashboard/AdminDashboard"));
const AdminTenantsPage = lazy(() => import("./modules/admin/pages/AdminTenantsPage"));
const AdminTenantCreatePage = lazy(() => import("./modules/admin/pages/AdminTenantCreatePage"));
const AdminTenantDetailPage = lazy(() => import("./modules/admin/pages/AdminTenantDetailPage"));
const AdminPaymentsPage = lazy(() => import("./modules/admin/pages/AdminPaymentsPage"));
const AdminPlansPage = lazy(() => import("./modules/admin/pages/AdminPlansPage"));
const AdminConfigPage = lazy(() => import("./modules/admin/pages/AdminConfigPage"));
const AdminStaffPage = lazy(() => import("./modules/staff/pages/AdminStaffPage"));
const TenantStaffPage = lazy(() => import("./modules/staff/pages/TenantStaffPage"));
const AdminAuditPage = lazy(() => import("./modules/admin/pages/AdminAuditPage"));
const AdminBannersPage = lazy(() => import("./modules/admin/pages/AdminBannersPage"));
const AdminAnnouncementsPage = lazy(() => import("./modules/admin/pages/AdminAnnouncementsPage"));
// One screen, mounted on both consoles. Changing your own password has nothing
// role-specific about it, and a second copy is a second copy to forget.
const SecurityPage = lazy(() => import("./modules/auth/pages/SecurityPage"));
// The Help Centre runs FULL-SCREEN, outside the dashboard shell, for the same
// reason the POS does: somebody opens it when they are stuck, and wrapping it
// in the navigation they could not work out is not help.
const HelpCenterPage = lazy(() => import("./modules/help/pages/HelpCenterPage"));
const ShopSettingsPage = lazy(() => import("./modules/shop/pages/ShopSettingsPage"));
const ActivityPage = lazy(() => import("./modules/activity/pages/ActivityPage"));
const BranchesPage = lazy(() => import("./modules/branches/pages/BranchesPage"));
const TransfersPage = lazy(() => import("./modules/transfers/pages/TransfersPage"));
const WarrantyLookupPage = lazy(() => import("./modules/warranty/pages/WarrantyLookupPage"));
const VehiclesPage = lazy(() => import("./modules/vehicles/pages/VehiclesPage"));
const DayPage = lazy(() => import("./modules/day/pages/DayPage"));
const StocktakePage = lazy(() => import("./modules/stocktake/pages/StocktakePage"));
const StockCountSheetPage = lazy(() => import("./modules/stocktake/pages/StockCountSheetPage"));
const SubscriptionPage = lazy(() => import("./modules/shop/pages/SubscriptionPage"));
const ShopDashboard = lazy(() => import("./pages/Dashboard/ShopDashboard"));
const ShopSetupPage = lazy(() => import("./modules/shop/pages/ShopSetupPage"));
const ProductsPage = lazy(() => import("./modules/catalog/pages/ProductsPage"));
const ProductEditorRoute = lazy(() => import("./modules/catalog/pages/ProductEditorRoute"));
const CategoriesPage = lazy(() => import("./modules/catalog/pages/CategoriesPage"));
const CollectionsPage = lazy(() => import("./modules/catalog/pages/CollectionsPage"));
const LabelsPage = lazy(() => import("./modules/catalog/pages/LabelsPage"));
const ForecourtPage = lazy(() => import("./modules/fuel/pages/ForecourtPage"));
const ForecourtShiftPage = lazy(() => import("./modules/fuel/pages/ForecourtShiftPage"));
const FuelSetupPage = lazy(() => import("./modules/fuel/pages/FuelSetupPage"));
const FuelDeliveriesPage = lazy(() => import("./modules/fuel/pages/FuelDeliveriesPage"));
const PosPage = lazy(() => import("./modules/pos/pages/PosPage"));
const FloorPage = lazy(() => import("./modules/dinein/pages/FloorPage"));
const TabPage = lazy(() => import("./modules/dinein/pages/TabPage"));
const KitchenPage = lazy(() => import("./modules/kitchen/pages/KitchenPage"));
const PharmacyPage = lazy(() => import("./modules/pharmacy/pages/PharmacyPage"));
const DocumentsPage = lazy(() => import("./modules/documents/pages/DocumentsPage"));
const DocumentDetailPage = lazy(() => import("./modules/documents/pages/DocumentDetailPage"));
const SuppliersPage = lazy(() => import("./modules/purchases/pages/SuppliersPage"));
const CustomersPage = lazy(() => import("./modules/customers/pages/CustomersPage"));
const CouponsPage = lazy(() => import("./modules/coupons/pages/CouponsPage"));
const PromotionsPage = lazy(() => import("./modules/promotions/pages/PromotionsPage"));
const BankOffersPage = lazy(() => import("./modules/banks/pages/BankOffersPage"));
const WorkshopPage = lazy(() => import("./modules/workshop/pages/WorkshopPage"));
const PortfolioPage = lazy(() => import("./modules/shop/pages/PortfolioPage"));
const PurchaseOrdersPage = lazy(() => import("./modules/purchases/pages/PurchaseOrdersPage"));
const InventoryPage = lazy(() => import("./modules/inventory/pages/InventoryPage"));
const DisposalsPage = lazy(() => import("./modules/inventory/pages/DisposalsPage"));
const SalesPage = lazy(() => import("./modules/sales/pages/SalesPage"));
const NewSalePage = lazy(() => import("./modules/sales/pages/NewSalePage"));
const ExpensesPage = lazy(() => import("./modules/expenses/pages/ExpensesPage"));
const IncomePage = lazy(() => import("./modules/income/pages/IncomePage"));
const CashbookPage = lazy(() => import("./modules/income/pages/CashbookPage"));
const LedgerPage = lazy(() => import("./modules/income/pages/LedgerPage"));
const ReportsPage = lazy(() => import("./modules/expenses/pages/ReportsPage"));
const ReservationsPage = lazy(() => import("./modules/reservations/pages/ReservationsPage"));
const OwnerReviewsPage = lazy(() => import("./modules/reviews/pages/OwnerReviewsPage"));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <ScrollToTop />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* ── The storefront lives under /shops ─────────────────────
              It used to BE the base url, which meant cartze.shop answered a
              shopkeeper evaluating the product with a list of somebody else's
              shops. Two audiences were sharing one address and only one of
              them pays for it.

              `/` redirects here until the landing page lands, so nothing a
              customer has bookmarked breaks in between. */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/shops" element={<MarketPage />} />
          <Route path="/shop/:slug" element={<MarketShopPage />} />

          {/* Public auth (bounce authenticated users to their home) */}
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
          </Route>

          {/* Customer orders (auth required, lives on the storefront) */}
          <Route element={<RequireAuth />}>
            <Route element={<RequireRole roles={["customer"]} />}>
              <Route path="/my-orders" element={<MyOrdersPage />} />
            </Route>
          </Route>

          {/* ── Admin console: /admin ─────────────────────────────── */}
          <Route element={<RequireAuth />}>
            <Route element={<RequireRole roles={["super_admin", "admin_staff"]} />}>
              {/* Every screen but the dashboard and your own password is gated
                  on the SAME map the rail and the quick actions read. Hiding a
                  link is a courtesy, not a lock: a banner scheduler who typed
                  /admin/payments used to get the whole billing page and watch
                  it fill with 403s. */}
              <Route path="/admin" element={<AppLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route element={<RequireAdminScreen path="/admin/tenants" />}>
                  <Route path="tenants" element={<AdminTenantsPage />} />
                  <Route path="tenants/:id" element={<AdminTenantDetailPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/tenants/new" />}>
                  <Route path="tenants/new" element={<AdminTenantCreatePage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/payments" />}>
                  <Route path="payments" element={<AdminPaymentsPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/plans" />}>
                  <Route path="plans" element={<AdminPlansPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/config" />}>
                  <Route path="config" element={<AdminConfigPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/staff" />}>
                  <Route path="staff" element={<AdminStaffPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/audit-logs" />}>
                  <Route path="audit-logs" element={<AdminAuditPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/banners" />}>
                  <Route path="banners" element={<AdminBannersPage />} />
                </Route>
                <Route element={<RequireAdminScreen path="/admin/announcements" />}>
                  <Route path="announcements" element={<AdminAnnouncementsPage />} />
                </Route>
                {/* Your own password — never gated. */}
                <Route path="security" element={<SecurityPage />} />
              </Route>
              {/* Full screen, so it sits OUTSIDE the AppLayout route above. */}
              <Route path="/admin/help" element={<HelpCenterPage />} />
            </Route>

            {/* ── Shop owner/staff console: /tenant ────────────────── */}
            {/* TenantThemed paints the shop's own brand colours over the
                default palette for every screen below — panel, POS and floor. */}
            <Route element={<RequireRole roles={["shop_owner", "staff"]} />}>
              <Route element={<TenantThemed />}>
              {/* Onboarding lives OUTSIDE the setup gate */}
              <Route path="/tenant/setup" element={<ShopSetupPage />} />

              <Route element={<RequireSetupComplete />}>
                {/* POS runs FULL-SCREEN — no sidebar/header — so the cashier
                    gets the whole viewport. It has its own in-page top bar. */}
                <Route element={<RequireFeature feature="pos" />}>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="/tenant/pos" element={<PosPage />} />
                  </Route>
                </Route>

                {/* The Help Centre is full screen and open to everyone in the
                    shop — anyone can get stuck. What it SHOWS is filtered by
                    this shop's business type and modules, and by what the
                    reader personally can open, so a restaurant is never told
                    how to count stock. */}
                <Route path="/tenant/help" element={<HelpCenterPage />} />

                {/* Dine-in runs full-screen too (floor → tab workspace), and
                    the kitchen board most of all: it hangs on a wall and is
                    read from two metres away. */}
                <Route element={<RequireFeature feature="dine_in" />}>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="/tenant/dine-in" element={<FloorPage />} />
                    <Route path="/tenant/dine-in/tickets/:id" element={<TabPage />} />
                    <Route path="/tenant/kitchen" element={<KitchenPage />} />
                  </Route>
                </Route>

                <Route path="/tenant" element={<AppLayout />}>
                  <Route index element={<ShopDashboard />} />
                  {/* The catalog belongs to a shop that sells goods OR bills
                      labour — either module alone is enough, neither means
                      there is nothing to catalogue. Mirrors the server's
                      `feature:products,services`. */}
                  <Route element={<RequireFeature feature={["products", "services"]} />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="products" element={<ProductsPage />}>
                        <Route path="new" element={<ProductEditorRoute />} />
                        <Route path=":id/edit" element={<ProductEditorRoute />} />
                      </Route>
                      <Route path="categories" element={<CategoriesPage />} />
                      <Route path="labels" element={<LabelsPage />} />
                      <Route element={<RequireFeature feature="marketplace" />}>
                        <Route path="collections" element={<CollectionsPage />} />
                      </Route>
                    </Route>
                  </Route>
                  {/* The chemist's paperwork rides the inventory module: the
                      register reads batches and the recall reads stock. */}
                  <Route element={<RequireFeature feature="inventory" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="pharmacy" element={<PharmacyPage />} />
                    </Route>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="suppliers" element={<SuppliersPage />} />
                    </Route>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="purchases" element={<PurchaseOrdersPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="customers" element={<CustomersPage />} />
                  </Route>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="coupons" element={<CouponsPage />} />
                    <Route path="promotions" element={<PromotionsPage />} />
                    <Route path="bank-offers" element={<BankOffersPage />} />
                  </Route>
                  <Route element={<RequireFeature feature="services" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="portfolio" element={<PortfolioPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireFeature feature="inventory" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="inventory" element={<InventoryPage />} />
                      <Route path="disposals" element={<DisposalsPage />} />
                      {/* Counting the shelves. Rides the stock module — a shop
                          that doesn't track stock has nothing to count against. */}
                      <Route path="stocktake" element={<StocktakePage />} />
                      <Route path="stocktake/:id" element={<StockCountSheetPage />} />
                    </Route>
                  </Route>
                  {/* The forecourt. Only a station has tanks and meters, so the
                      whole thing rides the `fuel` module — on by default for
                      petroleum, off for everyone else. */}
                  <Route element={<RequireFeature feature="fuel" />}>
                    {/* A shift ends by setting fuel stock to the dip, so it is
                        a stock correction; the plant is configuration; a
                        tanker is goods received. */}
                    <Route element={<RequireTenantScreen />}>
                      <Route path="fuel" element={<ForecourtPage />} />
                      <Route path="fuel/shifts/:id" element={<ForecourtShiftPage />} />
                    </Route>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="fuel/setup" element={<FuelSetupPage />} />
                    </Route>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="fuel/deliveries" element={<FuelDeliveriesPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="sales" element={<SalesPage />} />
                    <Route path="sales/new" element={<NewSalePage />} />
                  </Route>
                  {/* Quotations & advance bookings — counter documents that end
                      in a till transaction, hence the POS module. */}
                  <Route element={<RequireFeature feature="pos" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="documents" element={<DocumentsPage />} />
                      <Route path="documents/:id" element={<DocumentDetailPage />} />
                      {/* The trading day and the safe-to-bank leg. A day is
                          drawers, so it needs the till module — an online-only
                          shop has none. Reading it is a cashier's right to the
                          record of their own drawer; closing it off is
                          manager-only, checked on the server. */}
                      <Route path="day" element={<DayPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireFeature feature="expenses" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="expenses" element={<ExpensesPage />} />
                      <Route path="income" element={<IncomePage />} />
                      <Route path="cashbook" element={<CashbookPage />} />
                      {/* The cashbook at line level — the book itself, for a
                          business whose whole job is checking the lines. */}
                      <Route path="ledger" element={<LedgerPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="reports" element={<ReportsPage />} />
                  </Route>
                  {/* Orders follow PRODUCTS, matching the API. They used to
                      follow marketplace, which locked out the exact shop the
                      phone-order flow exists for: a pharmacy that delivers
                      and sells nothing online could manage riders and never
                      reach an order to give one. */}
                  <Route element={<RequireFeature feature="products" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="orders" element={<OwnerOrdersPage />} />
                    </Route>
                  </Route>
                  {/* Riders follow DELIVERY, not marketplace: a pharmacy
                      delivers phone orders without selling online. */}
                  <Route element={<RequireFeature feature="delivery" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="riders" element={<RidersPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireFeature feature="reservations" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="reservations" element={<ReservationsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireFeature feature="marketplace" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="reviews" element={<OwnerReviewsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="staff" element={<TenantStaffPage />} />
                  </Route>
                  <Route element={<RequireTenantScreen />}>
                    <Route path="branches" element={<BranchesPage />} />
                    <Route path="settings" element={<ShopSettingsPage />} />
                    <Route path="activity" element={<ActivityPage />} />
                  </Route>
                  {/* Vehicles are customer data, so they ride the products
                      gate like the CRM does — the sidebar decides which trades
                      ever see the screen. */}
                  <Route element={<RequireFeature feature="products" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="vehicles" element={<VehiclesPage />} />
                    </Route>
                  </Route>
                  {/* The bay board. Rides the till's own permission, not the
                      CRM one: moving a car along the board is what a mechanic
                      does all day, and a workshop that had to hand out customer
                      permissions to do it would hand them to everybody. */}
                  <Route element={<RequireFeature feature="pos" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="workshop" element={<WorkshopPage />} />
                    </Route>
                  </Route>
                  <Route element={<RequireFeature feature="inventory" />}>
                    <Route element={<RequireTenantScreen />}>
                      <Route path="transfers" element={<TransfersPage />} />
                    </Route>
                    {/* A counter lookup — the person holding the phone is the
                        person on the till. */}
                    <Route element={<RequireTenantScreen />}>
                      <Route path="warranty" element={<WarrantyLookupPage />} />
                    </Route>
                  </Route>
                  {/* What the shop pays is not a secret from the people who
                      work in it, and the server asks for no permission. */}
                  <Route path="subscription" element={<SubscriptionPage />} />
                  {/* Your own password. Ungated on purpose — every person
                      signed in to the shop has one, from the owner to the
                      newest cashier. */}
                  <Route path="security" element={<SecurityPage />} />
                </Route>
              </Route>
              </Route>
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
