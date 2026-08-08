import type { ReactNode } from "react";

import { BoxIconLine, GroupIcon, ShootingStarIcon, UserCircleIcon } from "../../../../icons";
import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";
import { tileGrid } from "./tone";

interface Props {
  highlights: TenantDashboard["highlights"];
  caps: Capabilities;
  money: (n: string | number) => string;
}

/**
 * This month's leaders. Each entry is nullable in the contract — a shop that
 * only served walk-ins genuinely has no top customer — and a null card is
 * dropped rather than filled with a dash.
 */
export function HighlightsRow({ highlights, caps, money }: Props) {
  const cards: Array<{ key: string; label: string; name: string; meta: string; icon: ReactNode }> = [];

  const { top_product, top_category, top_customer, top_staff } = highlights;

  if (top_product) {
    cards.push({
      key: "product",
      label: caps.products ? "Top product" : "Top service",
      name: top_product.name,
      meta: `${top_product.units.toLocaleString()} sold · ${money(top_product.revenue)}`,
      icon: <ShootingStarIcon className="size-5" />,
    });
  }

  if (top_category) {
    cards.push({
      key: "category",
      label: "Top category",
      name: top_category.name,
      meta: money(top_category.revenue),
      icon: <BoxIconLine className="size-5" />,
    });
  }

  if (top_customer) {
    cards.push({
      key: "customer",
      label: "Top customer",
      name: top_customer.name,
      meta: `${top_customer.sales_count.toLocaleString()} ${
        top_customer.sales_count === 1 ? "sale" : "sales"
      } · ${money(top_customer.revenue)}`,
      icon: <UserCircleIcon className="size-5" />,
    });
  }

  if (top_staff) {
    cards.push({
      key: "staff",
      label: "Top seller",
      name: top_staff.name,
      meta: `${top_staff.sales_count.toLocaleString()} ${
        top_staff.sales_count === 1 ? "sale" : "sales"
      } · ${money(top_staff.revenue)}`,
      icon: <GroupIcon className="size-5" />,
    });
  }

  if (cards.length === 0) return null;

  return (
    <SectionCard title="This month's leaders" icon={<ShootingStarIcon className="size-5" />}>
      <div className={tileGrid(cards.length)}>
        {cards.map((card) => (
          <div
            key={card.key}
            className="rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200 transition-colors hover:bg-gray-100 dark:bg-white/[0.03] dark:ring-gray-800 dark:hover:bg-white/[0.06]"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25">
                {card.icon}
              </span>
              <span className="truncate text-theme-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {card.label}
              </span>
            </div>
            <p
              className="mt-3 truncate font-semibold tracking-tight text-gray-800 dark:text-white/90"
              title={card.name}
            >
              {card.name}
            </p>
            <p className="mt-0.5 truncate text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
              {card.meta}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
