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
    >
      {loading || !modules ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Pulse className="h-3 w-32" />
              <Pulse className="mt-2 h-2 w-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 || used.length === 0 ? (
        <PanelEmpty>No active tenants running anything yet.</PanelEmpty>
      ) : (
        <>
          <ul className="space-y-3">
            {used.map((m) => (
              <li key={m.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate text-theme-sm text-gray-700 dark:text-gray-300">{m.label}</span>
                  <span className="shrink-0 text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {count(m.count)}
                    <span className="ml-2 font-medium text-gray-800 dark:text-white/90">{m.share}%</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.min(100, m.share)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/* Nobody running a module is a fact worth seeing, not a row to hide. */}
          {unused.length > 0 && (
            <p className="mt-4 border-t border-gray-100 pt-3 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              Nobody runs: {unused.map((m) => m.label).join(", ")}.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
