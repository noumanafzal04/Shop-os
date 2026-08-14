import { Navigate, Outlet, useLocation } from "react-router";
import ThemeCustomizer from "../../components/theme/ThemeCustomizer";
import UpdatePrompt from "../../modules/offline/pwa/UpdatePrompt";
import { useKeepInSync } from "../../modules/offline/sync/useKeepInSync";
import { useOfflineBoot } from "../../modules/offline/useOfflineBoot";
import { useTenantTheme } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";
import type { UserRole } from "../../modules/auth/types";
import { canVisitAdmin } from "./adminScreenPermissions";

/**
 * Each role's home:
 *   platform roles → /admin · shop roles → /tenant · customers → / (storefront)
 */
export function homeForRole(role: UserRole | undefined): string {
  if (role === "super_admin" || role === "admin_staff") return "/admin";
  if (role === "shop_owner" || role === "staff") return "/tenant";
  return "/";
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
 * Scope owners hold every permission implicitly (see authStore.hasPermission),
 * so this only ever narrows staff.
 */
export function RequirePermission({ permission }: { permission: string }) {
  // Subscribe to the permission LIST, not to the store's hasPermission — that
  // is a stable closure, so a fresh /me changing what a staff member holds
  // would not re-run this gate.
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);

  const allowed = role === "shop_owner" || (permissions?.includes(permission) ?? false);

  if (!allowed) {
    return <Navigate to="/tenant" replace />;
  }

  return <Outlet />;
}

/**
 * The platform-side twin of RequirePermission.
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
export function TenantThemed() {
  useTenantTheme();
  // Shop-side only. An admin browsing the platform console has no till, no
  // device identity to announce and nothing queued to protect.
  useOfflineBoot(true);
  // …and keeps it current afterwards: on reconnect, on a slow heartbeat, and
  // when the tab comes back to the front.
  useKeepInSync(true);

  return (
    <>
      <Outlet />
      {/* Appearance is reachable from every shop screen, POS included. */}
      <ThemeCustomizer />
      {/* A new version waits here until somebody chooses a moment for it —
          never mid-sale, and never while the outbox is being written. */}
      <UpdatePrompt />
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
