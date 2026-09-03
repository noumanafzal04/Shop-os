import { useMemo, useState } from "react";

import Badge from "../../../components/ui/badge/Badge";
import { applyModuleChange, settle } from "./moduleRules";
import type { ModuleInfo } from "../services/adminService";

/**
 * WHAT THIS BUSINESS CAN DO — the one picker, used when a shop is created and
 * again whenever it is changed.
 *
 * ── Why it is section-wise ──────────────────────────────────────────────
 *
 * A shopkeeper's complaint started this: a small takeaway café was shown
 * Disposals, Bank card offers and a warehouse's worth of screens that link to
 * nothing it does. Splitting those into modules of their own is only half the
 * answer — the other half is that an admin now has twenty switches to reason
 * about, and a flat list of twenty is its own kind of unusable.
 *
 * So the registry's own `group` does the work: Selling, Stock, Customers &
 * offers, Money, Online, Trade-specific. Each section says how many of its
 * modules are on, so "what has this shop got" is answerable at a glance rather
 * than by reading twenty rows.
 *
 * ── Why a press can move other switches ─────────────────────────────────
 *
 * Modules depend on each other, and both directions are handled here:
 * granting Suppliers & Purchases pulls Inventory and Products up with it, and
 * taking Inventory away drops everything built on it. Both say what else moved
 * — a switch that silently changes four others is the thing an admin cannot
 * undo from memory. See `moduleRules.ts` for why the upward rule is the
 * admin's and never the server's.
 */
export function ModulePicker({
  catalog,
  value,
  onChange,
  defaults,
  emptyHint,
}: {
  catalog: readonly ModuleInfo[];
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  /** What this trade usually gets, so a deliberate difference can be shown. */
  defaults?: Record<string, boolean>;
  /** Shown instead of the list when there is no catalog to show yet. */
  emptyHint?: string;
}) {
  // What the last press did to everything else. Cleared by the next press, so
  // it always describes the change the admin is actually looking at.
  const [ripple, setRipple] = useState<{ key: string; on: string[]; off: string[] } | null>(null);

  const groups = useMemo(() => {
    const out = new Map<string, ModuleInfo[]>();
    catalog.forEach((m) => {
      const list = out.get(m.group) ?? [];
      list.push(m);
      out.set(m.group, list);
    });

    return [...out.entries()];
  }, [catalog]);

  if (catalog.length === 0) {
    return (
      <p className="py-6 text-center text-theme-sm text-gray-400">
        {emptyHint ?? "No modules to show yet."}
      </p>
    );
  }

  const press = (key: string, on: boolean) => {
    const change = applyModuleChange(catalog, value, key, on);
    setRipple(
      change.alsoOn.length > 0 || change.alsoOff.length > 0
        ? { key, on: change.alsoOn, off: change.alsoOff }
        : null,
    );
    onChange(change.modules);
  };

  const differsFromDefaults =
    defaults !== undefined
    && catalog.some((m) => (value[m.key] ?? false) !== (defaults[m.key] ?? false));

  return (
    <div className="space-y-5">
      {differsFromDefaults && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
          <span>This shop differs from what its trade usually gets.</span>
          <button
            type="button"
            className="font-medium text-brand-500 hover:underline"
            onClick={() => {
              setRipple(null);
              onChange(settle(catalog, defaults ?? {}));
            }}
          >
            Back to the usual set
          </button>
        </div>
      )}

      {groups.map(([group, items]) => {
        const on = items.filter((m) => value[m.key]).length;

        return (
          <section key={group}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h4 className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{group}</h4>
              {/* What this section amounts to, without reading it. */}
              <span className="text-theme-xs tabular-nums text-gray-400">
                {on} of {items.length}
              </span>
            </div>

            <div className="space-y-1.5">
              {items.map((m) => {
                const isOn = value[m.key] ?? false;
                // The WHOLE chain, not just the direct dependency. Suppliers &
                // Purchases needs Inventory, which needs Products — a hint
                // naming only Inventory would understate a press that turns on
                // two things, and the note afterwards would then say something
                // the note before it did not.
                const needs = applyModuleChange(catalog, value, m.key, true).alsoOn;
                const differs = defaults !== undefined && isOn !== (defaults[m.key] ?? false);
                const said = ripple?.key === m.key ? ripple : null;

                return (
                  <div
                    key={m.key}
                    className={`rounded-lg border p-3 transition ${
                      isOn
                        ? "border-brand-500/40 bg-brand-50/50 dark:border-brand-500/30 dark:bg-brand-500/10"
                        : "border-gray-200 dark:border-gray-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                          {m.label}
                          {/* Whether this was a decision made for this shop, or
                              just what its trade usually gets. */}
                          {differs && (
                            <Badge size="sm" color="light">{isOn ? "granted" : "removed"}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{m.description}</p>
                        {/* Not a refusal. The switch still works — this says
                            what pressing it will also do. */}
                        {!isOn && needs.length > 0 && (
                          <p className="mt-1 text-theme-xs text-gray-400">
                            Switching this on also switches on {needs.join(" and ")}.
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        // The module's name sits OUTSIDE this control, so
                        // without a label it announced as "button" and nothing
                        // else — twenty identical buttons with no way to hear
                        // which one you were on or whether it was granted.
                        role="switch"
                        aria-checked={isOn}
                        aria-label={m.label}
                        onClick={() => press(m.key, !isOn)}
                        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                          isOn ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"
                        }`}
                      >
                        <span className={`block h-5 w-5 rounded-full bg-white transition ${isOn ? "translate-x-5" : ""}`} />
                      </button>
                    </div>

                    {said && (
                      <p
                        className="mt-2 rounded-md bg-white/70 px-2 py-1 text-theme-xs text-gray-600 dark:bg-black/20 dark:text-gray-300"
                        role="status"
                      >
                        {said.on.length > 0 && <>Also switched on: {said.on.join(", ")}. </>}
                        {said.off.length > 0 && <>Also switched off: {said.off.join(", ")}.</>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
