import { Link, Outlet } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { useBranchStore } from "../../../stores/branchStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../hooks/useBranches";
import { byKind, hasSecondPlace, isWarehouse } from "../places";

/**
 * THE TILL AND THE FLOOR ARE AT A SHOP.
 *
 * A warehouse has no counter. The server refuses a shift, a sale and a table
 * there (`Branch::mustSell`) — but an owner who had picked the godown in the
 * header to check its shelf, then opened the till, got a till: a full screen
 * of products that refused at the very last press, with the customer waiting.
 *
 * So the screens that sell are not drawn at a warehouse at all. In their place
 * is what is wrong and the one press that fixes it.
 *
 * ── It lets the screen through unless it KNOWS ──────────────────────────
 *
 * The till works with no connection, and this must not be the thing that
 * stops it. With the list of places unread — offline, still loading, refused —
 * the answer is "carry on": every such case is a shop far more often than a
 * warehouse, and the server is still there to refuse the rare one.
 */
export function SellsHere() {
  const settings = useShopSettings();
  const role = useAuthStore((s) => s.user?.role);
  const ownPlace = useAuthStore((s) => s.user?.branch_id);
  const { activeBranchId, setActiveBranch } = useBranchStore();
  const qc = useQueryClient();
  // Nobody can be standing in a warehouse in a business that has one place.
  const branches = useBranches(hasSecondPlace(settings.data));

  // The owner stands where the header says; everybody else where they were put.
  const standingAt = role === "shop_owner" ? activeBranchId : ownPlace;
  const place = (branches.data ?? []).find((b) => b.id === standingAt);

  if (!isWarehouse(place)) return <Outlet />;

  const shops = byKind((branches.data ?? []).filter((b) => b.is_active)).shops;
  const goTo = (id: string) => {
    setActiveBranch(id);
    // The place is sent on every request, so every answer on screen is stale.
    void qc.invalidateQueries();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-6 dark:bg-gray-950" data-testid="no-counter-here">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 text-center dark:border-gray-800 dark:bg-white/[0.03]">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">{place!.name} is a warehouse</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          It holds stock and has no till, so nothing is sold or served from here.
          {role === "shop_owner" ? " Choose the shop you are selling at." : " Ask the owner to move you to a shop if you need to sell."}
        </p>

        {role === "shop_owner" && (
          <div className="mt-5 space-y-2">
            {shops.map((shop) => (
              <button
                key={shop.id}
                type="button"
                onClick={() => goTo(shop.id)}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 transition hover:border-brand-300 hover:bg-brand-50 dark:border-gray-800 dark:text-white/90 dark:hover:bg-brand-500/10"
              >
                Sell at {shop.name}
              </button>
            ))}
          </div>
        )}

        <Link to="/tenant" className="mt-5 inline-block text-theme-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
