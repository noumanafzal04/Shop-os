import { useCallback } from "react";

import { useAuthStore } from "./authStore";

/**
 * "May this person open that?"
 *
 * ── Why it is a hook and not three copies ────────────────────────────
 *
 * The sidebar had this rule, the notification dropdown had it again with a
 * comment saying it "mirrors authStore.hasPermission, the same way the sidebar
 * does it", and order alerts were about to be the fourth. A rule copied with a
 * note admitting it is a copy is a rule waiting to disagree with itself — and
 * the disagreement would show as a menu offering a screen the notification
 * beside it refuses to open.
 *
 * An OWNER holds everything. A staff member holds what they were given. That
 * is the whole rule, and it lives here now.
 */
export function useCan(): (permission: string) => boolean {
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);

  return useCallback(
    (permission: string) => role === "shop_owner" || (permissions?.includes(permission) ?? false),
    [role, permissions],
  );
}
