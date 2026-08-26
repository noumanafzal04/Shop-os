import { useEffect, useState } from "react";

import type { AisleFacets, AisleFilters } from "../services/marketplaceService";
import { money, tradeLabel } from "./format";
import { CheckIcon, CloseIcon, StarIcon } from "./MarketIcons";

/**
 * THE RAIL, DRIVEN BY THE SHELVES.
 *
 * Not one option here is written down in this file. Every city, trade,
 * category and size comes back from the server with the number of products
 * behind it, computed from the same query the grid runs — so the rail can
 * never offer a city with nothing in it, can never hide one with forty, and
 * the number beside an option is what clicking it produces.
 *
 * A hardcoded rail is the alternative, and it is wrong the day after it is
 * written: a shop opens in a city nobody listed, a trade is renamed, a
 * category is retired, and the rail goes on offering the old world.
 */

/** One collapsible block. Open by default — a rail of closed drawers hides
 *  the very thing it exists to advertise. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b border-gray-100 py-4 last:border-0 dark:border-white/5">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
          {title}
        </span>
        <span className="flex items-center gap-2">
          {count !== undefined && count > 0 && (
            <span className="text-[11px] tabular-nums text-gray-400">{count}</span>
          )}
          <svg viewBox="0 0 24 24" className={`size-4 text-gray-400 transition ${open ? "" : "-rotate-90"}`} aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** A row that behaves like a radio: pressing the chosen one clears it. */
function Choice({
  label,
  count,
  chosen,
  onClick,
}: {
  label: string;
  count?: number;
  chosen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
        chosen
          ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
      }`}
    >
      <span
        className={`grid size-4 shrink-0 place-items-center rounded border transition ${
          chosen ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 dark:border-white/20"
        }`}
      >
        {chosen && <CheckIcon className="size-3" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{count}</span>
      )}
    </button>
  );
}

function Chip({
  label,
  count,
  chosen,
  onClick,
}: {
  label: string;
  count?: number;
  chosen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
        chosen
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-300"
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-1 tabular-nums opacity-60">{count}</span>}
    </button>
  );
}

export function FilterRail({
  value,
  facets,
  onChange,
  onClear,
}: {
  value: AisleFilters;
  facets?: AisleFacets;
  onChange: (patch: Partial<AisleFilters>) => void;
  onClear: () => void;
}) {
  // The price boxes are typed into, so they hold their own text and only
  // report when the field is left or Enter is pressed. Reporting on every
  // keystroke re-queries the whole aisle after "1", "12", "120".
  const [low, setLow] = useState(value.min_price?.toString() ?? "");
  const [high, setHigh] = useState(value.max_price?.toString() ?? "");

  // Cleared from outside (the "Clear all" button, or a chip in the summary
  // row) — without this the boxes keep showing numbers that no longer filter.
  useEffect(() => setLow(value.min_price?.toString() ?? ""), [value.min_price]);
  useEffect(() => setHigh(value.max_price?.toString() ?? ""), [value.max_price]);

  const commitPrice = () =>
    onChange({
      min_price: low.trim() === "" ? undefined : Math.max(0, Number(low)),
      max_price: high.trim() === "" ? undefined : Math.max(0, Number(high)),
    });

  const toggle = <K extends keyof AisleFilters>(key: K, next: AisleFilters[K]) =>
    onChange({ [key]: value[key] === next ? undefined : next } as Partial<AisleFilters>);

  const active =
    [value.city_id, value.business_type, value.category, value.size, value.shop_slug].filter(Boolean).length +
    (value.on_sale ? 1 : 0) +
    (value.in_stock ? 1 : 0) +
    (value.rating_min ? 1 : 0) +
    (value.min_price !== undefined || value.max_price !== undefined ? 1 : 0);

  return (
    <div className="rounded-3xl border border-gray-200 bg-white px-5 dark:border-white/10 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 py-4 dark:border-white/5">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Filters</h2>
        {active > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <CloseIcon className="size-3.5" />
            Clear {active}
          </button>
        )}
      </div>

      <Section title="Availability">
        <div className="flex flex-wrap gap-2">
          <Chip
            label="In stock"
            chosen={value.in_stock === true}
            onClick={() => toggle("in_stock", true)}
          />
          <Chip
            label="On sale"
            count={facets?.on_sale_count}
            chosen={value.on_sale === true}
            onClick={() => toggle("on_sale", true)}
          />
        </div>
      </Section>

      <Section title="Price">
        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={low}
            onChange={(e) => setLow(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitPrice}
            onKeyDown={(e) => e.key === "Enter" && commitPrice()}
            placeholder={facets ? String(Math.floor(facets.price.min)) : "Min"}
            aria-label="Lowest price"
            className="h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm tabular-nums text-gray-900 outline-none transition focus:border-brand-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <span className="text-gray-400">–</span>
          <input
            inputMode="numeric"
            value={high}
            onChange={(e) => setHigh(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitPrice}
            onKeyDown={(e) => e.key === "Enter" && commitPrice()}
            placeholder={facets ? String(Math.ceil(facets.price.max)) : "Max"}
            aria-label="Highest price"
            className="h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm tabular-nums text-gray-900 outline-none transition focus:border-brand-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        {facets && facets.price.max > 0 && (
          <p className="mt-2 text-[11px] text-gray-400">
            {money(facets.price.min)} – {money(facets.price.max)} across {facets.total} items
          </p>
        )}
      </Section>

      {(facets?.cities.length ?? 0) > 0 && (
        <Section title="City" count={facets!.cities.length}>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {facets!.cities.map((c) => (
              <Choice
                key={c.id}
                label={c.name}
                count={c.products_count}
                chosen={value.city_id === c.id}
                onClick={() => toggle("city_id", c.id)}
              />
            ))}
          </div>
        </Section>
      )}

      {(facets?.business_types.length ?? 0) > 0 && (
        <Section title="Kind of shop">
          <div className="flex flex-wrap gap-2">
            {facets!.business_types.map((t) => (
              <Chip
                key={t.type ?? "other"}
                label={tradeLabel(t.type)}
                count={t.products_count}
                chosen={value.business_type === t.type}
                onClick={() => toggle("business_type", t.type ?? undefined)}
              />
            ))}
          </div>
        </Section>
      )}

      {(facets?.categories.length ?? 0) > 0 && (
        <Section title="Category" count={facets!.categories.length}>
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {facets!.categories.map((c) => (
              <Choice
                key={c.name}
                label={c.name}
                count={c.products_count}
                chosen={value.category === c.name}
                onClick={() => toggle("category", c.name)}
              />
            ))}
          </div>
        </Section>
      )}

      {(facets?.sizes.length ?? 0) > 0 && (
        <Section title="Size">
          <div className="flex flex-wrap gap-2">
            {facets!.sizes.map((s) => (
              <Chip
                key={s.name}
                label={s.name}
                count={s.products_count}
                chosen={value.size === s.name}
                onClick={() => toggle("size", s.name)}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Shop rating">
        <div className="space-y-0.5">
          {[4, 3].map((stars) => (
            <button
              key={stars}
              type="button"
              onClick={() => toggle("rating_min", stars)}
              aria-pressed={value.rating_min === stars}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                value.rating_min === stars
                  ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              <span className="flex text-amber-400">
                {[1, 2, 3, 4, 5].map((n) => (
                  <StarIcon key={n} className="size-3.5" filled={n <= stars} />
                ))}
              </span>
              <span>&amp; up</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
