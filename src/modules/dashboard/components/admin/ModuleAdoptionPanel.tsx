import { GridIcon } from "../../../../icons";
import type { AdminDashboard } from "../../types";
import { Panel, PanelEmpty, Pulse } from "./Panel";
import { count } from "./format";

interface Props {
  modules?: AdminDashboard["modules"];
  loading?: boolean;
}

/**
 * What the platform's shops actually run.
 *
 * Modules are assigned per tenant now, not bundled into a plan, so the plan
 * ladder says nothing about usage. This is the only place the platform can see
 * what it is really shipping — and the only warning that a module nobody
 * switches on is being maintained for nobody.
 *
 * A bar rather than a donut: these are not slices of one whole. A shop runs
 * several modules at once, so the shares deliberately sum past 100%.
 */
export function ModuleAdoptionPanel({ modules, loading = false }: Props) {
  const rows = modules ?? [];
  const used = rows.filter((m) => m.count > 0);
  const unused = rows.filter((m) => m.count === 0);

  return (
    <Panel
      className="h-full"
      title="Module adoption"
      subtitle="Share of active tenants running each module"
      icon={<GridIcon className="size-5" />}
    >
      {loading || !modules ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Pulse className="h-3 w-32" />
              <Pulse className="mt-2 h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 || used.length === 0 ? (
        <PanelEmpty>No active tenants running anything yet.</PanelEmpty>
      ) : (
        <>
          {/* Two columns on a wide screen: a dozen full-width bars is a ladder
              nobody reads to the bottom of. */}
          <ul className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
            {used.map((m) => (
              <li key={m.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                    {m.label}
                  </span>
                  <span className="shrink-0 text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {count(m.count)}
                    <span className="ml-2 font-semibold text-gray-800 dark:text-white/90">
                      {m.share}%
                    </span>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-500"
                    style={{ width: `${Math.min(100, m.share)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/* Nobody running a module is a fact worth seeing, not a row to hide. */}
          {unused.length > 0 && (
            <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
              <p className="text-theme-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Nobody runs
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unused.map((m) => (
                  <span
                    key={m.key}
                    className="rounded-lg bg-gray-50 px-2.5 py-1 text-theme-xs text-gray-600 ring-1 ring-gray-200 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-800"
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
