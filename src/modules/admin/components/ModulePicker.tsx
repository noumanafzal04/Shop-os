import { useMemo, useState } from "react";

import { applyModuleChange, settle } from "./moduleRules";
import type { ModuleInfo } from "../services/adminService";

/**
 * WHICH MODULES A SHOP HAS — sorted by where each one comes from.
 *
 * ── What this was ───────────────────────────────────────────────────────
 *
 * Twenty-one switches in six groups, the same twenty-one for every trade.
 * Somebody setting up a corner shop was asked about Fuel Management and
 * Dine-in Tables, and had to know for themselves that a small shop wants three
 * of the twenty-one: add products, print labels, ring a sale.
 *
 * ── What it is ──────────────────────────────────────────────────────────
 *
 * Three bands, and the server says what goes in each (`/admin/modules/offer`):
 *
 *   IN THE PLAN   what the plan gives a shop of this trade. On to begin with.
 *   ADD-ONS       the rest of what this trade can use — each with its price.
 *                 Switch one on and it is on the shop's bill; the plan stays
 *                 the plan. Nobody makes a custom plan for one extra module.
 *   NOT USUAL     what is not for this trade. Folded away, and still one tick
 *                 off — a salon that sells shampoo is a salon with Products.
 *
 * A module that is ON is always in sight: one from the folded band that this
 * shop already has is drawn among the add-ons, because that is what it is.
 *
 * The dependency rules are unchanged (`moduleRules`): a press that moves other
 * switches says so before, and says so after.
 */
export interface ModuleBands {
  included: string[];
  addons: string[];
  other: string[];
  essential?: string[];
}

const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

export function ModulePicker({
  catalog,
  value,
  onChange,
  offer,
  prices = {},
  ownPrices,
  onOwnPrices,
  planName,
  tradeLabel,
  emptyHint,
}: {
  catalog: readonly ModuleInfo[];
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  /** Where each module comes from. Without it, everything is simply "on offer". */
  offer?: ModuleBands;
  /** The platform's monthly price for an add-on. Absent = free to add. */
  prices?: Record<string, number>;
  /** This shop's own monthly price for an add-on, as typed. Only where it can be set. */
  ownPrices?: Record<string, string>;
  onOwnPrices?: (next: Record<string, string>) => void;
  planName?: string | null;
  tradeLabel?: string | null;
  emptyHint?: string;
}) {
  const [ripple, setRipple] = useState<{ key: string; on: string[]; off: string[] } | null>(null);
  const [unfolded, setUnfolded] = useState(false);

  const bands = useMemo(() => {
    const by = (keys: readonly string[]) => catalog.filter((m) => keys.includes(m.key));
    if (!offer) return { included: [] as ModuleInfo[], addons: [...catalog], other: [] as ModuleInfo[] };

    // On, and "not usual for this trade": it is an add-on this shop has.
    const strays = offer.other.filter((k) => value[k]);

    return {
      included: by(offer.included),
      addons: by([...offer.addons, ...strays]),
      other: by(offer.other.filter((k) => !value[k])),
    };
  }, [catalog, offer, value]);

  if (catalog.length === 0) {
    return <p className="py-6 text-center text-theme-sm text-gray-400">{emptyHint ?? "No modules to show yet."}</p>;
  }

  const press = (key: string, on: boolean) => {
    const change = applyModuleChange(catalog, value, key, on);
    setRipple(change.alsoOn.length > 0 || change.alsoOff.length > 0 ? { key, on: change.alsoOn, off: change.alsoOff } : null);
    onChange(change.modules);
  };

  const asPlanned = offer ? settle(catalog, Object.fromEntries(offer.included.map((k) => [k, true]))) : null;
  const differs = asPlanned !== null && catalog.some((m) => (value[m.key] ?? false) !== (asPlanned[m.key] ?? false));
  const plan = planName ?? "the plan";
  const trade = tradeLabel ?? "this trade";

  const priceOf = (key: string): number => {
    const own = ownPrices?.[key];
    if (own !== undefined && own.trim() !== "" && !Number.isNaN(Number(own))) return Math.max(0, Number(own));

    return prices[key] ?? 0;
  };
  const addonsOn = bands.addons.filter((m) => value[m.key]);
  const addonsMonthly = addonsOn.reduce((sum, m) => sum + priceOf(m.key), 0);

  const tile = (m: ModuleInfo, band: "included" | "addon" | "other") => {
    const isOn = value[m.key] ?? false;
    const needs = applyModuleChange(catalog, value, m.key, true).alsoOn;
    const loses = applyModuleChange(catalog, value, m.key, false).alsoOff;
    const said = ripple?.key === m.key ? ripple : null;
    const essential = offer?.essential?.includes(m.key) ?? false;
    const listed = prices[m.key];

    return (
      <div
        key={m.key}
        data-module={m.key}
        className={`rounded-xl border p-3 transition ${
          !isOn
            ? "border-gray-200 bg-white dark:border-gray-800 dark:bg-transparent"
            : band === "included"
              ? "border-success-200 bg-success-50/60 dark:border-success-500/30 dark:bg-success-500/10"
              : "border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-gray-800 dark:text-white/90">
              {m.label}
              {band === "included" && essential && (
                <span
                  title={`A ${trade} shop cannot open without it`}
                  className="rounded-full bg-success-100 px-1.5 py-px text-[11px] font-medium text-success-700 dark:bg-success-500/20 dark:text-success-400"
                >
                  needed
                </span>
              )}
              {band === "included" && !isOn && (
                <span className="rounded-full bg-gray-100 px-1.5 py-px text-[11px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">
                  off for this shop
                </span>
              )}
              {band !== "included" && (
                <span
                  className={`rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums ${
                    listed
                      ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                      : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
                  }`}
                >
                  {listed ? `${rupees(listed)} / mo` : "Free to add"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{m.description}</p>
            {/* Not a refusal. The switch still works — this says what pressing
                it will also do. */}
            {!isOn && needs.length > 0 && (
              <p className="mt-1 text-theme-xs text-gray-400">Also switches on {needs.join(" and ")}.</p>
            )}
            {/* Warning-coloured, unlike the one above: this press takes things
                away, and switching back on will not return them. */}
            {isOn && loses.length > 0 && (
              <p className="mt-1 text-theme-xs text-warning-600 dark:text-warning-400">
                {loses.join(" and ")} {loses.length === 1 ? "needs" : "need"} this — off here is off there too.
              </p>
            )}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            aria-label={m.label}
            onClick={() => press(m.key, !isOn)}
            className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${isOn ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"}`}
          >
            <span className={`block h-5 w-5 rounded-full bg-white transition ${isOn ? "translate-x-5" : ""}`} />
          </button>
        </div>

        {/* This shop's own price — only for an add-on it has, and only where
            the screen can save one. Blank is the platform's price. */}
        {band !== "included" && isOn && ownPrices && onOwnPrices && (
          <label className="mt-2 flex flex-wrap items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
            This shop pays
            <input
              type="number"
              min="0"
              inputMode="numeric"
              aria-label={`${m.label}: this shop's own price a month`}
              value={ownPrices[m.key] ?? ""}
              onChange={(e) => onOwnPrices({ ...ownPrices, [m.key]: e.target.value })}
              placeholder={listed ? String(listed) : "0"}
              className="h-8 w-24 rounded-lg border border-gray-300 bg-white px-2 text-theme-sm tabular-nums text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
            a month
            <span className="text-gray-400">— blank keeps {listed ? rupees(listed) : "it free"}</span>
          </label>
        )}

        {said && (
          <p className="mt-2 rounded-md bg-white/70 px-2 py-1 text-theme-xs text-gray-600 dark:bg-black/20 dark:text-gray-300" role="status">
            {said.on.length > 0 && <>Also switched on: {said.on.join(", ")}. </>}
            {said.off.length > 0 && <>Also switched off: {said.off.join(", ")}.</>}
          </p>
        )}
      </div>
    );
  };

  const head = (title: string, count: string, hint: string) => (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">{title}</h4>
        <span className="text-theme-xs tabular-nums text-gray-400">{count}</span>
      </div>
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  );

  return (
    // A container, so the tiles go two across by the width of the CARD they are
    // in and not of the screen: this sits in a narrow column on the create
    // page and a wide one on a shop's own page.
    <div className="@container space-y-6">
      {differs && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
          <span>This shop is not exactly what {plan} gives.</span>
          <button
            type="button"
            className="font-medium text-brand-500 hover:underline"
            onClick={() => {
              setRipple(null);
              onChange(asPlanned ?? {});
            }}
          >
            Back to just the plan
          </button>
        </div>
      )}

      {offer && (
        <section data-testid="modules-included">
          {head(
            `In ${plan}`,
            `${bands.included.filter((m) => value[m.key]).length} of ${bands.included.length} on`,
            `What ${plan} gives a ${trade} shop. Nothing extra to pay.`,
          )}
          {bands.included.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-theme-xs text-gray-400 dark:border-gray-800">
              {plan} includes nothing for this trade yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 @[40rem]:grid-cols-2">{bands.included.map((m) => tile(m, "included"))}</div>
          )}
        </section>
      )}

      <section data-testid="modules-addons">
        {head(
          offer ? "Add-ons" : "Modules",
          `${addonsOn.length} on`,
          offer
            ? "Extra, for this one shop. It stays on its plan; what is switched on here is added to its bill."
            : "What this business can do.",
        )}
        {bands.addons.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-theme-xs text-gray-400 dark:border-gray-800">
            {plan} already includes everything a {trade} shop can use.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 @[40rem]:grid-cols-2">{bands.addons.map((m) => tile(m, "addon"))}</div>
        )}
        {offer && addonsOn.length > 0 && (
          <p data-testid="modules-addons-total" className="mt-2 text-right text-theme-xs text-gray-500 dark:text-gray-400">
            {addonsOn.length} add-on{addonsOn.length === 1 ? "" : "s"} ·{" "}
            <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">
              {addonsMonthly > 0 ? `${rupees(addonsMonthly)} a month on top of the plan` : "nothing extra to pay"}
            </span>
          </p>
        )}
      </section>

      {bands.other.length > 0 && (
        <section data-testid="modules-other">
          <button
            type="button"
            aria-expanded={unfolded}
            onClick={() => setUnfolded((v) => !v)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-left text-theme-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/5"
          >
            <span>
              <span className="font-medium text-gray-700 dark:text-gray-300">Not usual for a {trade} shop</span> · {bands.other.length} more
              module{bands.other.length === 1 ? "" : "s"}
            </span>
            <span aria-hidden="true">{unfolded ? "Hide" : "Show"}</span>
          </button>
          {unfolded && <div className="mt-2 grid grid-cols-1 gap-2 @[40rem]:grid-cols-2">{bands.other.map((m) => tile(m, "other"))}</div>}
        </section>
      )}
    </div>
  );
}
