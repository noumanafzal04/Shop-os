import { useAuthStore } from "../../../stores/authStore";
import { useBranchStore } from "../../../stores/branchStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../hooks/useBranches";
import { hasSecondPlace, isWarehouse } from "../places";

/**
 * THE PLACE A WRITE WILL LAND ON — the one being stood in.
 *
 * The server puts stock where the person is standing: the place an owner chose
 * at the top of the screen, the place a staff member is assigned to, and Main
 * when neither says. A form that writes stock should say which that is BEFORE
 * the press, because "all sixty went to the shop and I meant the godown" is
 * found a week later, by a count.
 *
 * Null for a business with one place: there is nothing to tell apart, and a
 * line reading "goes on Main" under every form would be noise.
 */
export function useStandingAt(): { name: string; warehouse: boolean } | null {
  const settings = useShopSettings();
  const role = useAuthStore((s) => s.user?.role);
  const ownPlace = useAuthStore((s) => s.user?.branch_id);
  const chosen = useBranchStore((s) => s.activeBranchId);
  const branches = useBranches(hasSecondPlace(settings.data));

  const places = (branches.data ?? []).filter((b) => b.is_active);
  if (places.length < 2) return null;

  const at = places.find((b) => b.id === (role === "shop_owner" ? chosen : ownPlace)) ?? places.find((b) => b.is_default);

  return at ? { name: at.name, warehouse: isWarehouse(at) } : null;
}

/** "Goes on Godown's shelf." — under a field that puts stock somewhere. */
export function GoesOnShelf() {
  const at = useStandingAt();
  if (!at) return null;

  return (
    <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400" data-testid="goes-on-shelf">
      Goes on <span className="font-medium text-gray-700 dark:text-gray-200">{at.name}</span>&rsquo;s shelf
      {at.warehouse ? " (warehouse)" : ""}. To put it somewhere else, choose that place at the top of the screen first.
    </p>
  );
}
