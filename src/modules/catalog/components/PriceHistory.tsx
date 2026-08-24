import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { apiGet } from "../../../common/api/client";
import { canVisit } from "../../../common/routing/screenPermissions";
import { useAuthStore } from "../../../stores/authStore";

/**
 * WHAT THIS ITEM USED TO COST, AND WHO MOVED IT.
 *
 * Sugar goes from 180 to 210 and the only record of 180 was the screen it was
 * typed over. Every other money authority in the shop has been auditable for a
 * while — a tax rate, a coupon, a customer's credit limit — and the number a
 * shop changes most often was not on the list.
 *
 * ── Why it is here and not on a screen of its own ───────────────────────
 *
 * The question arrives at the item. "Why is this ringing at 210?" is asked with
 * the product open, by somebody who is already looking at the field; a separate
 * history screen is one more place to remember exists. The whole trail is still
 * on Activity, filterable, for the times the question arrives the other way
 * round — "what changed last Tuesday".
 *
 * ── Who may read it ─────────────────────────────────────────────────────
 *
 * The same rule as the Activity screen, from the same map, because they are the
 * same data: `READS_AUDIT` on the server is settings.manage OR reports.view. A
 * stock keeper holds products.manage and neither of those — they can change a
 * price and may not read who else has, which is deliberate and is the shop
 * owner's business, not the catalogue's.
 *
 * Rendering nothing at all for them is the point: a section that appears and
 * then 403s tells them the history exists and refuses it in the same breath.
 */

interface Row {
  id: string;
  event: string;
  actor: { name: string } | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

const money = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : `Rs ${Number(v).toLocaleString()}`;

const WHICH: Record<string, string> = {
  price: "Price",
  discount_price: "Sale price",
  wholesale_price: "Wholesale",
};

export function PriceHistory({ productId }: { productId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const mayRead = canVisit(
    "/tenant/activity",
    (p) => role === "shop_owner" || (permissions?.includes(p) ?? false),
  );

  const history = useQuery({
    queryKey: ["product", productId, "price-history"],
    queryFn: () => apiGet<Row[]>("/audit-logs", {
      params: { type: "Product", record: productId, per_page: 10 },
    }),
    enabled: mayRead && Boolean(productId),
  });

  if (!mayRead) return null;

  const rows = (history.data?.data ?? []).filter((r) => r.event === "updated");
  if (history.isLoading || rows.length === 0) return null;

  return (
    // `data-price-history`, not "the section that says Price history": the
    // words match every ancestor too, and a test locating by them hits three
    // elements and refuses.
    <div data-price-history className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Price history</p>
      <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
        The last few changes, most recent first.{" "}
        {/* The rest of them, actually reachable.
            This panel deliberately shows a handful and has no page two — a
            product form is not a place to browse. That was only honest once
            Activity could be narrowed to ONE item; before this link it filtered
            to Products and no further, so the eleventh-oldest price change
            meant paging every product change in the shop. */}
        <Link
          to={`/tenant/activity?record=${productId}`}
          className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400"
        >
          See every change to this item
        </Link>
      </p>

      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const fields = Object.keys(r.new_values ?? {}).filter((k) => k in WHICH);

          return (
            <li key={r.id} className="text-theme-xs">
              {fields.map((k) => (
                <div key={k} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-gray-500 dark:text-gray-400">{WHICH[k]}</span>
                  <span className="text-gray-400 line-through">{money(r.old_values?.[k])}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-semibold text-gray-800 dark:text-white/90">
                    {money(r.new_values?.[k])}
                  </span>
                  <span className="text-gray-400">
                    · {r.actor?.name ?? "somebody"} · {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
