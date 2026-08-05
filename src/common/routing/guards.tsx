import { Navigate, Outlet, useLocation } from "react-router";
import ThemeCustomizer from "../../components/theme/ThemeCustomizer";
import { useTenantTheme } from "../../modules/shop/hooks/useShop";
import { useAuthStore } from "../../stores/authStore";
import type { UserRole } from "../../modules/auth/types";

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
 */
export function RequireFeature({ feature }: { feature: string }) {
  const features = useAuthStore((s) => s.user?.tenant?.features);

  if (!features?.[feature]) {
    return <Navigate to="/tenant" replace />;
  }

  return <Outlet />;
}

/**
 * Applies the tenant's own brand colours to every shop-side screen — the
 * panel, the full-screen POS and the dine-in floor alike. Mounted once as a
 * layout route so there is a single place theming can come from.
 */
export function TenantThemed() {
  useTenantTheme();

  return (
    <>
      <Outlet />
      {/* Appearance is reachable from every shop screen, POS included. */}
      <ThemeCustomizer />
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
