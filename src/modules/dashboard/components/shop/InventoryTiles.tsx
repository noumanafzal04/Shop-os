import { BoxIconLine } from "../../../../icons";
import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";
import { StatTile } from "./StatTile";
import { tileGrid, type Tone } from "./tone";

interface Props {
  data: TenantDashboard;
  caps: Capabilities;
}

/** Whether this tenant has any counter at all — the page needs it to size the row. */
export function hasInventoryTiles(caps: Capabilities): boolean {
  return (caps.tracksStock && caps.visit("/tenant/inventory"))
    || (caps.pos && caps.visit("/tenant/pos"));
}

/**
 * The stock/till counters, each one a link to the screen that lists the items
 * behind it. Tiles only appear for modules the tenant runs: no inventory
 * feature means no stock counters at all, not four zeroes.
 *
 * Every tile IS its link, so a person who cannot open the screen behind it is
 * not offered the tile — a stock counter that bounces you home is worse than
 * no counter.
 */
export function InventoryTiles({ data, caps }: Props) {
  const { inventory } = data;
  const stock = caps.tracksStock && caps.visit("/tenant/inventory");

  const tiles: Array<{ key: string; label: string; value: number; caption: string; tone: Tone; to: string }> = [];

  if (stock) {
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

  if (caps.pos && caps.visit("/tenant/pos")) {
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
      title={stock ? "Stock & till" : "Till"}
      subtitle={data.branch_scope ? "This branch" : undefined}
      icon={<BoxIconLine className="size-5" />}
      to={stock ? "/tenant/inventory" : undefined}
      toLabel="Open Stock"
    >
      <div className={tileGrid(tiles.length)}>
        {tiles.map(({ key, value, ...tile }) => (
          <StatTile key={key} value={value.toLocaleString()} {...tile} />
        ))}
      </div>
    </SectionCard>
  );
}
