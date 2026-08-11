/**
 * Which permission each ADMIN screen needs — the platform-side twin of
 * screenPermissions.ts, and it exists for the same reason that one does.
 *
 * The admin rail was a flat list with no filter at all. Platform staff are
 * given an explicit permission list precisely so the person scheduling banner
 * ads is not a finance person — but every one of them was offered Tenants,
 * Plans, Billing, Platform Staff and the Audit Log, and found out which were
 * real by clicking them and reading a 403.
 *
 * The rule lives HERE rather than in the sidebar, because the sidebar is not
 * the only surface that offers these screens: the dashboard's Quick Actions
 * offer the same nine. Two lists of the same rule is how a menu and a dashboard
 * end up disagreeing about the same person — which is the note already written
 * at the top of screenPermissions.ts, learned the hard way on the shop side.
 *
 * A path absent from this map is open to any platform role. That is true of
 * exactly one screen: /admin, which is where the console lands and can never be
 * gated. Its CONTENTS are filtered instead — the server withholds the revenue
 * figures from staff without `billing.view`.
 */
const ADMIN_SCREEN_PERMISSIONS: Record<string, string> = {
  "/admin/tenants": "tenants.view",
  "/admin/tenants/new": "tenants.create",
  // Plans price the platform; reading them is part of reading a tenant.
  "/admin/plans": "tenants.view",
  "/admin/payments": "billing.view",
  "/admin/config": "tenants.update",
  "/admin/banners": "banners.manage",
  "/admin/announcements": "announcements.manage",
  "/admin/staff": "platform_staff.manage",
  // Super-admin only on the server, and no permission grants it.
  "/admin/audit-logs": SUPER_ADMIN_ONLY(),
};

/**
 * The sentinel for "no permission opens this — the server asks for the role".
 * A function so the constant cannot be confused for a real permission key.
 */
function SUPER_ADMIN_ONLY(): string {
  return "__super_admin_only__";
}

/**
 * May this person open this admin screen?
 *
 * A super admin holds everything by ROLE — the server says exactly that in
 * User::hasPermission, and a rail stricter than the API it fronts hides
 * screens that work.
 *
 * An undefined permission list fails CLOSED. It arrives that way only before
 * /me has answered, and failing open there flashes every screen on first paint.
 */
export function canVisitAdmin(
  path: string,
  isSuperAdmin: boolean,
  permissions: string[] | undefined,
): boolean {
  if (isSuperAdmin) return true;

  const needed = ADMIN_SCREEN_PERMISSIONS[path];

  if (needed === undefined) return true;
  if (needed === SUPER_ADMIN_ONLY()) return false;

  return permissions?.includes(needed) ?? false;
}
