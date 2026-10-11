import Select from "../../../components/form/Select";
import { useAuthStore } from "../../../stores/authStore";
import { useBranchStore } from "../../../stores/branchStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../hooks/useBranches";
import type { Branch } from "../services/branchService";
import { byKind, hasSecondPlace, isWarehouse } from "../places";

/**
 * WHERE A DELIVERY IS GOING — said on the order, and again when it arrives.
 *
 * A delivery went into whichever place the person keying it in happened to be
 * looking at. That is one kind of business — the supplier's van comes to each
 * branch — and wrong for the other two: a shop with a godown, where the order
 * is raised at the counter and the cartons go in the back; and a chain with a
 * central warehouse, where everything arrives there first.
 *
 * So an order is ADDRESSED when it is raised (<DeliverTo>), and the receipt
 * starts from that address and may change it (<ReceiveInto>) — the van that
 * was meant for the godown and turned up at the shop.
 *
 * Both are drawn only where there is a choice to make. A business with one
 * place has none.
 */

/** Open places, shops first and then warehouses, as options for a select. */
function useOpenPlaces(enabled: boolean): { places: Branch[]; options: Array<{ value: string; label: string }> } {
  const settings = useShopSettings();
  // Asked only of a business that has a second place: with one, there is no
  // choice to offer and nothing to fetch.
  const branches = useBranches(enabled && hasSecondPlace(settings.data));
  const places = (branches.data ?? []).filter((b) => b.is_active);
  const { shops, warehouses } = byKind(places);

  return {
    places,
    options: [...shops, ...warehouses].map((b) => ({ value: b.id, label: isWarehouse(b) ? `${b.name} — warehouse` : b.name })),
  };
}

/** The place being stood in: an owner's choice at the top of the screen, a keeper's assignment, else Main. */
function useStanding(places: readonly Branch[]): Branch | undefined {
  const role = useAuthStore((s) => s.user?.role);
  const ownPlace = useAuthStore((s) => s.user?.branch_id);
  const chosen = useBranchStore((s) => s.activeBranchId);

  return places.find((b) => b.id === (role === "shop_owner" ? chosen : ownPlace)) ?? places.find((b) => b.is_default) ?? places[0];
}

const FRAME = "rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]";
// The select carries the name itself (`aria-label`): the shared Select takes
// no id for a <label> to point at.
const HEAD = "mb-1.5 text-theme-sm font-medium text-gray-700 dark:text-gray-300";

/**
 * On a NEW order: where the supplier is to bring it.
 *
 * Starts where the server would address it if nothing were chosen — the place
 * the business marked "deliveries come here", else the place it is being
 * raised from — so what is shown is what will happen. `""` sends nothing and
 * lets the server apply that same rule.
 */
export function DeliverTo({ value, onChange }: { value: string; onChange: (placeId: string) => void }) {
  const { places, options } = useOpenPlaces(true);
  const standing = useStanding(places);
  if (places.length < 2) return null;

  const usual = places.find((b) => b.takes_deliveries) ?? standing;

  return (
    <div data-testid="deliver-to" className={FRAME}>
      <p aria-hidden="true" className={HEAD}>Deliver to</p>
      <Select aria-label="Deliver to" options={options} value={value || usual?.id || ""} onChange={onChange} />
      <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">Where the supplier brings it. It can still be received somewhere else if the van turns up there.</p>
    </div>
  );
}

/**
 * On an order already raised: where it was addressed, in a few words.
 *
 * Nothing for a business with one place — every order there is "for Main",
 * and saying so on each would be a line of noise. For the rest it is what
 * tells a shop's keeper why they are not the one to receive this order.
 */
export function AddressedTo({ place }: { place?: { name: string; kind: "shop" | "warehouse" } | null }) {
  const { places } = useOpenPlaces(true);
  if (!place || places.length < 2) return null;

  return (
    <span data-testid="addressed-to">
      {" "}· deliver to <span className="font-medium text-gray-700 dark:text-gray-200">{place.name}</span>
      {place.kind === "warehouse" ? " (warehouse)" : ""}
    </span>
  );
}

/**
 * On a DELIVERY: which place it is being put into.
 *
 * Starts at the place the order was addressed to. Offered only to somebody
 * who may put stock in a place other than their own — a keeper pinned to one
 * place receives into that place, which the header already tells them.
 */
export function ReceiveInto({
  value,
  onChange,
  orderedFor,
}: {
  value: string;
  onChange: (placeId: string) => void;
  /** The place the order was addressed to, when it was addressed. */
  orderedFor?: string | null;
}) {
  const anywhere = useAuthStore((s) => s.hasPermission("inventory.any_place"));
  const { places, options } = useOpenPlaces(anywhere);
  const standing = useStanding(places);
  if (!anywhere || places.length < 2) return null;

  // What is sent when nothing is chosen, shown as chosen so it is not a guess:
  // the order's own address while that place is still open, else here.
  const usual = places.find((b) => b.id === orderedFor) ?? standing;

  return (
    <div data-testid="receive-into" className={`mb-4 ${FRAME}`}>
      <p aria-hidden="true" className={HEAD}>Receive into</p>
      <Select aria-label="Receive into" options={options} value={value || usual?.id || ""} onChange={onChange} />
      <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">The stock, and its batch, go on this place&rsquo;s shelf.</p>
    </div>
  );
}
