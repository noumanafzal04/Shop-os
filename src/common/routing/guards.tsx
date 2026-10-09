import { Navigate, Outlet, useLocation } from "react-router";
import ThemeCustomizer from "../../components/theme/ThemeCustomizer";
import { ConsoleAppearance } from "../../modules/admin/components/ConsoleAppearance";
import { useConsoleTheme } from "../../modules/admin/hooks/useConsoleAppearance";
import ServiceWorkerHost from "../../modules/offline/pwa/ServiceWorkerHost";
import UpdatePrompt from "../../modules/offline/pwa/UpdatePrompt";
import InstallPrompt from "../../modules/offline/pwa/InstallPrompt";
import { useKeepInSync } from "../../modules/offline/sync/useKeepInSync";
import { useOfflineBoot } from "../../modules/offline/useOfflineBoot";
import { useTenantTheme } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";
import { useMe } from "../../modules/auth/hooks/useAuth";
import type { UserRole } from "../../modules/auth/types";
import { canVisitAdmin } from "./adminScreenPermissions";
import { canBeAt } from "./screenPermissions";

/**
 * Each role's home:
 *   platform roles → /admin · shop roles → /tenant · customers → / (storefront)
 */
export function homeForRole(role: UserRole | undefined): string {
  if (role === "super_admin" || role === "admin_staff") return "/admin";
  if (role === "shop_owner" || role === "staff") return "/tenant";

  // A CUSTOMER GOES TO THE SHOPS, not to the landing page.
  //
  // This said `/` and was right for as long as `/` was the storefront. The
  // moment the base url became the page the PRODUCT is sold from, signing in
  // as a customer started landing them on an advert for a point-of-sale
  // system — which is a different audience's page entirely.
  return "/shops";
}

/**
 * Requires a logged-in user; preserves the attempted URL so login can
 * redirect back (deep-link support).
 */
export function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

/**
 * Requires one of the given roles — e.g. the /admin area for platform roles.
 * Wrong-role users are sent to their own home, not to an error page.
 */
export function RequireRole({ roles }: { roles: UserRole[] }) {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return <Navigate to="/signin" replace />;
  }

  if (!roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  return <Outlet />;
}

/**
 * Shop-side gate: an incomplete shop setup always redirects to onboarding
 * (the "user skips setup" edge case — the app is unreachable until done).
 */
export function RequireSetupComplete() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === "shop_owner" && user.tenant && !user.tenant.setup_completed) {
    return <Navigate to="/tenant/setup" replace />;
  }

  return <Outlet />;
}

/**
 * Module gate: a page whose tenant feature flag is off is unreachable even by
 * typing its URL (hiding the sidebar link is not access control). Applies to
 * shop_owner and staff alike — the flag belongs to the shop, not the person.
 * A missing key reads as OFF, mirroring the server's EnsureFeature middleware.
 *
 * A list of modules reads as ANY of them, exactly like `feature:a,b` on the
 * server: the catalog belongs to a shop that sells goods OR bills labour.
 */
export function RequireFeature({ feature }: { feature: string | string[] }) {
  const features = useAuthStore((s) => s.user?.tenant?.features);
  const wanted = Array.isArray(feature) ? feature : [feature];

  if (!wanted.some((f) => features?.[f])) {
    return <Navigate to="/tenant" replace />;
  }

  return <Outlet />;
}

/**
 * Permission gate: the person, where RequireFeature gates the shop.
 *
 * The sidebar hides what a staff member may not do, but a hidden link is a
 * courtesy, not a lock — without this, a cashier who typed /tenant/staff got
 * the screen, the queries, and a 403 from every one of them. Sending them home
 * is both the honest answer and the readable one.
 *
 * ── Why this takes no permission prop ───────────────────────────────────
 *
 * It used to. Twenty-four `<RequirePermission permission="…">` wrappers named
 * the rule again, beside a map that already held it — and a prop is ONE string,
 * so the four screens whose rule is ANY-of could not be expressed at all. All
 * four had drifted:
 *
 *   /tenant/kitchen    map: sales.manage OR kitchen.manage   guard: sales.manage
 *   /tenant/suppliers  + purchases.manage, inventory.manage  guard: suppliers
 *   /tenant/purchases  + inventory.manage                    guard: purchases
 *   /tenant/activity   + reports.view                        guard: settings
 *
 * The kitchen one had teeth. `kitchen.manage` was split out of `sales.manage`
 * precisely so a kitchen hand could work the pass without being shown the
 * shop's takings, and the shop's own Kitchen preset grants nothing else. The
 * sidebar offered them the board, a notification deep-linked to it — and this
 * guard sent them to the dashboard. The one screen their job is made of.
 *
 * So the gate reads its own location and asks the map, which is what
 * `RequireAdminScreen` below has always done on the other console. Scope owners
 * hold every permission implicitly (see authStore.hasPermission), so this only
 * ever narrows staff.
 */
export function RequireTenantScreen() {
  // Subscribe to the permission LIST, not to the store's hasPermission — that
  // is a stable closure, so a fresh /me changing what a staff member holds
  // would not re-run this gate.
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const { pathname } = useLocation();

  const can = (p: string) => role === "shop_owner" || (permissions?.includes(p) ?? false);

  if (!canBeAt(pathname, can)) {
    return <Navigate to="/tenant" replace />;
  }

  return <Outlet />;
}

/**
 * The platform-side twin of RequireTenantScreen.
 *
 * Filtering the rail stops a screen being OFFERED; it does not stop it being
 * reached. A banner scheduler who types /admin/payments got the whole billing
 * page, which then filled with 403s — a broken screen rather than a closed
 * door, and one that still tells them the screen exists.
 *
 * The permission per path is read from the same map the rail and the dashboard
 * shortcuts use, so all three can only ever agree.
 */
export function RequireAdminScreen({ path }: { path: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);

  if (!canVisitAdmin(path, role === "super_admin", permissions)) {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}

/**
 * Applies the tenant's own brand colours to every shop-side screen — the
 * panel, the full-screen POS and the dine-in floor alike. Mounted once as a
 * layout route so there is a single place theming can come from.
 *
 * It is also where the offline boot runs, for the same reason: this is the one
 * component every shop screen sits under, POS included. The till has to know
 * which device it is and whether its storage is safe wherever the cashier
 * happens to be standing, not only on the screen that sells.
 */
/**
 * The admin console's half of the same job.
 *
 * `ServiceWorkerHost` may be mounted exactly once per page — `useRegisterSW`
 * registers again on a second call — so the two consoles get one mount each
 * and the two never overlap. TenantThemed covers /tenant, this covers /admin,
 * and AppLayout (which both consoles share) covers neither.
 */
export function AdminShell() {
  // The console wears the platform's own look — and takes it off on the way
  // out, the same as a shop's screens do.
  useConsoleTheme();

  return (
    <>
      <ServiceWorkerHost />
      <Outlet />
      {/* The canvas a shop has always had, kept in the platform's settings.
          Drawn for a super admin only; everybody else simply wears it. */}
      <ConsoleAppearance />
    </>
  );
}

export function TenantThemed() {
  useTenantTheme();
  // Shop-side only. An admin browsing the platform console has no till, no
  // device identity to announce and nothing queued to protect.
  //
  // And only for a shop WITH a till. Device registration, the till's
  // bootstrap and its catalog are all `pos` routes, so an online-only shop
  // and a books-only one fired three refused requests on every screen —
  // again on reconnect, on tab focus and every fifteen minutes.
  // WHO AM I, AND WHAT DOES MY SHOP HAVE — asked on every shop screen.
  //
  // `useMe()` lived only in AppLayout, the shell with the sidebar. The till,
  // the floor, a tab and the kitchen board render OUTSIDE that shell, and the
  // installed app opens straight on the till — so a counter machine kept the
  // module map from its last sign-in for as long as nobody visited another
  // screen. Every "does this shop have X" check on the till read that copy.
  useMe();
  const hasTill = useAuthStore((st) => st.user?.tenant?.features?.pos ?? false);
  useOfflineBoot(hasTill);
  // …and keeps it current afterwards: on reconnect, on a slow heartbeat, and
  // when the tab comes back to the front.
  useKeepInSync(hasTill);

  return (
    <>
      {/* REGISTERED HERE, NOT IN AppLayout.
          AppLayout is the shell; the till, the floor, the tab and the kitchen
          board render outside it. A cashier who opened /tenant/pos directly —
          which is exactly how a till is opened — registered no worker,
          precached nothing, and got ERR_INTERNET_DISCONNECTED on the first
          reload after the line dropped. The one screen built to survive an
          outage was the one screen with no offline shell.
          TenantThemed wraps every shop screen, shell or not, and already owns
          the rest of the offline boot above. */}
      <ServiceWorkerHost />
      <Outlet />
      {/* Appearance is reachable from every shop screen except the till — its
          rail button is `fixed right-0 top-1/2`, which lands on a page margin
          everywhere but the full-bleed POS, where it sat on the cart's TOTAL. */}
      <ThemeCustomizer />
      {/* A new version waits here until somebody chooses a moment for it —
          never mid-sale, and never while the outbox is being written. */}
      <UpdatePrompt />
      {/* …and the offer to put the till on the home screen in the first
          place, which is the difference between a shop that can sell through
          a dropped line and one that cannot. Fences itself off the POS. */}
      <InstallPrompt />
    </>
  );
}

/**
 * Public-only pages (signin/signup) — an authenticated user is bounced to
 * their home.
 */
export function RedirectIfAuthenticated() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated && user) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  return <Outlet />;
}
