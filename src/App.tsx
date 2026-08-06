import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequireFeature,
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
const ShopSettingsPage = lazy(() => import("./modules/shop/pages/ShopSettingsPage"));
const BranchesPage = lazy(() => import("./modules/branches/pages/BranchesPage"));
const TransfersPage = lazy(() => import("./modules/transfers/pages/TransfersPage"));
const WarrantyLookupPage = lazy(() => import("./modules/warranty/pages/WarrantyLookupPage"));
const VehiclesPage = lazy(() => import("./modules/vehicles/pages/VehiclesPage"));
const DayPage = lazy(() => import("./modules/day/pages/DayPage"));
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
const PortfolioPage = lazy(() => import("./modules/shop/pages/PortfolioPage"));
const PurchaseOrdersPage = lazy(() => import("./modules/purchases/pages/PurchaseOrdersPage"));
const InventoryPage = lazy(() => import("./modules/inventory/pages/InventoryPage"));
const SalesPage = lazy(() => import("./modules/sales/pages/SalesPage"));
const NewSalePage = lazy(() => import("./modules/sales/pages/NewSalePage"));
const ExpensesPage = lazy(() => import("./modules/expenses/pages/ExpensesPage"));
const IncomePage = lazy(() => import("./modules/income/pages/IncomePage"));
const CashbookPage = lazy(() => import("./modules/income/pages/CashbookPage"));
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
          {/* ── User side (storefront) is the BASE url ────────────── */}
          <Route path="/" element={<MarketPage />} />
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
              <Route path="/admin" element={<AppLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="tenants" element={<AdminTenantsPage />} />
                <Route path="tenants/new" element={<AdminTenantCreatePage />} />
                <Route path="tenants/:id" element={<AdminTenantDetailPage />} />
                <Route path="payments" element={<AdminPaymentsPage />} />
                <Route path="plans" element={<AdminPlansPage />} />
                <Route path="config" element={<AdminConfigPage />} />
                <Route path="staff" element={<AdminStaffPage />} />
                <Route path="audit-logs" element={<AdminAuditPage />} />
                <Route path="banners" element={<AdminBannersPage />} />
                <Route path="announcements" element={<AdminAnnouncementsPage />} />
              </Route>
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
                  <Route path="/tenant/pos" element={<PosPage />} />
                </Route>

                {/* Dine-in runs full-screen too (floor → tab workspace), and
                    the kitchen board most of all: it hangs on a wall and is
                    read from two metres away. */}
                <Route element={<RequireFeature feature="dine_in" />}>
                  <Route path="/tenant/dine-in" element={<FloorPage />} />
                  <Route path="/tenant/dine-in/tickets/:id" element={<TabPage />} />
                  <Route path="/tenant/kitchen" element={<KitchenPage />} />
                </Route>

                <Route path="/tenant" element={<AppLayout />}>
                  <Route index element={<ShopDashboard />} />
                  <Route path="products" element={<ProductsPage />}>
                    <Route path="new" element={<ProductEditorRoute />} />
                    <Route path=":id/edit" element={<ProductEditorRoute />} />
                  </Route>
                  <Route path="categories" element={<CategoriesPage />} />
                  <Route element={<RequireFeature feature="marketplace" />}>
                    <Route path="collections" element={<CollectionsPage />} />
                  </Route>
                  <Route path="labels" element={<LabelsPage />} />
                  {/* The chemist's paperwork rides the inventory module: the
                      register reads batches and the recall reads stock. */}
                  <Route element={<RequireFeature feature="inventory" />}>
                    <Route path="pharmacy" element={<PharmacyPage />} />
                    <Route path="suppliers" element={<SuppliersPage />} />
                    <Route path="purchases" element={<PurchaseOrdersPage />} />
                  </Route>
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="coupons" element={<CouponsPage />} />
                  <Route path="promotions" element={<PromotionsPage />} />
                  <Route element={<RequireFeature feature="services" />}>
                    <Route path="portfolio" element={<PortfolioPage />} />
                  </Route>
                  <Route element={<RequireFeature feature="inventory" />}>
                    <Route path="inventory" element={<InventoryPage />} />
                  </Route>
                  {/* The forecourt. Only a station has tanks and meters, so the
                      whole thing rides the `fuel` module — on by default for
                      petroleum, off for everyone else. */}
                  <Route element={<RequireFeature feature="fuel" />}>
                    <Route path="fuel" element={<ForecourtPage />} />
                    <Route path="fuel/shifts/:id" element={<ForecourtShiftPage />} />
                    <Route path="fuel/setup" element={<FuelSetupPage />} />
                    <Route path="fuel/deliveries" element={<FuelDeliveriesPage />} />
                  </Route>
                  <Route path="sales" element={<SalesPage />} />
                  <Route path="sales/new" element={<NewSalePage />} />
                  {/* Quotations & advance bookings — counter documents that end
                      in a till transaction, hence the POS module. */}
                  <Route element={<RequireFeature feature="pos" />}>
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="documents/:id" element={<DocumentDetailPage />} />
                    {/* The trading day and the safe-to-bank leg. A day is
                        drawers, so it needs the till module — an online-only
                        shop has none. */}
                    <Route path="day" element={<DayPage />} />
                  </Route>
                  <Route element={<RequireFeature feature="expenses" />}>
                    <Route path="expenses" element={<ExpensesPage />} />
                    <Route path="income" element={<IncomePage />} />
                    <Route path="cashbook" element={<CashbookPage />} />
                  </Route>
                  <Route path="reports" element={<ReportsPage />} />
                  {/* Orders follow PRODUCTS, matching the API. They used to
                      follow marketplace, which locked out the exact shop the
                      phone-order flow exists for: a pharmacy that delivers
                      and sells nothing online could manage riders and never
                      reach an order to give one. */}
                  <Route element={<RequireFeature feature="products" />}>
                    <Route path="orders" element={<OwnerOrdersPage />} />
                  </Route>
                  {/* Riders follow DELIVERY, not marketplace: a pharmacy
                      delivers phone orders without selling online. */}
                  <Route element={<RequireFeature feature="delivery" />}>
                    <Route path="riders" element={<RidersPage />} />
                  </Route>
                  <Route element={<RequireFeature feature="reservations" />}>
                    <Route path="reservations" element={<ReservationsPage />} />
                  </Route>
                  <Route element={<RequireFeature feature="marketplace" />}>
                    <Route path="reviews" element={<OwnerReviewsPage />} />
                  </Route>
                  <Route path="staff" element={<TenantStaffPage />} />
                  <Route path="branches" element={<BranchesPage />} />
                  {/* Vehicles are customer data, so they ride the products
                      gate like the CRM does — the sidebar decides which trades
                      ever see the screen. */}
                  <Route element={<RequireFeature feature="products" />}>
                    <Route path="vehicles" element={<VehiclesPage />} />
                  </Route>
                  <Route element={<RequireFeature feature="inventory" />}>
                    <Route path="transfers" element={<TransfersPage />} />
                    <Route path="warranty" element={<WarrantyLookupPage />} />
                  </Route>
                  <Route path="settings" element={<ShopSettingsPage />} />
                  <Route path="subscription" element={<SubscriptionPage />} />
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
