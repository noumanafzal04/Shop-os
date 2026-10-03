import type { SessionUser } from "../types/session";

/**
 * DOES THIS PERSON HOLD THIS PERMISSION — answered the way the SERVER answers
 * it, which is not `permissions.includes()`.
 *
 * ── The bug this file exists for ─────────────────────────────────────
 *
 * The app shipped asking `user.permissions?.includes(p)` in two places. It is
 * the obvious question and it is the wrong one, because `App\Models\User`
 * says:
 *
 *     Scope owners (super_admin, shop_owner) implicitly hold every permission
 *     in their scope; staff roles hold only what they were assigned.
 *
 *     return match ($this->role) {
 *         UserRole::SuperAdmin, UserRole::ShopOwner => true,
 *         UserRole::AdminStaff, UserRole::Staff => in_array(...),
 *         UserRole::Customer => false,
 *     };
 *
 * So an owner's `permissions` column is legitimately EMPTY and every server
 * check still passes. The app read the empty array and hid Orders, Menu and
 * Money — from the one person who owns the shop. Signing in as a real tenant
 * gave a two-tab app, and nothing anywhere said why: an absent tab looks like
 * a product decision, which is the exact failure `tabsFor` was written to
 * prevent and then committed itself.
 *
 * It survived 62 tests because every fixture handed `tabsFor` a permissions
 * array. Nobody ever handed it an owner.
 *
 * ── Why this does not reintroduce roles ──────────────────────────────
 *
 * This product has no job roles — cashier, waiter and kitchen are permission
 * SETS, and every screen asks about a permission rather than about a person.
 * That rule is intact: `role` is named HERE and nowhere else, in the one
 * function whose whole job is to mirror the server's answer. It is the same
 * shape as `User::hasPermission()` — the server names the role in exactly one
 * method too, and every caller asks about a permission.
 */

/**
 * The roles that hold everything in their scope, spelled exactly as
 * `App\Enums\UserRole` spells them. `permissionsMirrorServer.test.ts` reads
 * the PHP and fails if these drift.
 */
export const ROLES_HOLDING_EVERY_PERMISSION = ["super_admin", "shop_owner"] as const;

/** The role that holds nothing here — a shopper signed into the wrong app. */
export const ROLES_HOLDING_NO_PERMISSION = ["customer"] as const;

export function holds(user: SessionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  if ((ROLES_HOLDING_EVERY_PERMISSION as readonly string[]).includes(user.role)) return true;
  if ((ROLES_HOLDING_NO_PERMISSION as readonly string[]).includes(user.role)) return false;
  return user.permissions?.includes(permission) ?? false;
}
