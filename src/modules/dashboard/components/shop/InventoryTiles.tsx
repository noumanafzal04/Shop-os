import { Link } from "react-router";

import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";

type Tone = "brand" | "warning" | "error" | "gray";

const TILE: Record<Tone, string> = {
  brand: "bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/15",
  warning: "bg-warning-50 hover:bg-warning-100 dark:bg-warning-500/10 dark:hover:bg-warning-500/15",
  error: "bg-error-50 hover:bg-error-100 dark:bg-error-500/10 dark:hover:bg-error-500/15",
  gray: "bg-gray-50 hover:bg-gray-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]",
};

const NUMBER: Record<Tone, string> = {
  brand: "text-brand-600 dark:text-brand-400",
  warning: "text-warning-600 dark:text-warning-500",
  error: "text-error-600 dark:text-error-500",
  gray: "text-gray-800 dark:text-white/90",
};

interface Props {
  data: TenantDashboard;
  caps: Capabilities;
}

/** Whether this tenant has any counter at all — the page needs it to size the row. */
export function hasInventoryTiles(caps: Capabilities): boolean {
  return caps.tracksStock || caps.pos;
}

/**
 * The stock/till counters, each one a link to the screen that lists the items
 * behind it. Tiles only appear for modules the tenant runs: no inventory
 * feature means no stock counters at all, not four zeroes.
 */
export function InventoryTiles({ data, caps }: Props) {
  const { inventory } = data;

  const tiles: Array<{ key: string; label: string; value: number; caption: string; tone: Tone; to: string }> = [];

  if (caps.tracksStock) {
    tiles.push({
      key: "low",
      label: "Low stock",
      value: inventory.low_stock,
      caption: "at or below reorder level",
      tone: inventory.low_stock > 0 ? "warning" : "gray",
      to: "/tenant/inventory",
    });
    tiles.push({
      key: "out",
      label: "Out of stock",
      value: inventory.out_of_stock,
      caption: "nothing left to sell",
      tone: inventory.out_of_stock > 0 ? "error" : "gray",
      to: "/tenant/inventory",
    });
    tiles.push({
      key: "expiring",
      label: "Expiring soon",
      value: inventory.expiring_soon,
      caption: "batches within 30 days",
      tone: inventory.expiring_soon > 0 ? "warning" : "gray",
      to: "/tenant/inventory",
    });
  }

  if (caps.pos) {
    tiles.push({
      key: "parked",
      label: "Parked tickets",
      value: inventory.pending_pos,
      caption: "held at the till",
      tone: inventory.pending_pos > 0 ? "brand" : "gray",
      to: "/tenant/pos",
    });
  }

  if (tiles.length === 0) return null;

  return (
    <SectionCard
      title={caps.tracksStock ? "Stock & till" : "Till"}
      subtitle={data.branch_scope ? "This branch" : undefined}
      to={caps.tracksStock ? "/tenant/inventory" : undefined}
      toLabel="Open Stock"
    >
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
          tiles.length >= 4 ? "xl:grid-cols-4" : tiles.length === 3 ? "xl:grid-cols-3" : ""
        }`}
      >
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            to={tile.to}
            className={`rounded-xl p-4 transition-colors ${TILE[tile.tone]}`}
          >
            <p className={`text-2xl font-bold tabular-nums ${NUMBER[tile.tone]}`}>{tile.value}</p>
            <p className="mt-1 text-theme-sm font-medium text-gray-700 dark:text-gray-300">{tile.label}</p>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{tile.caption}</p>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}
