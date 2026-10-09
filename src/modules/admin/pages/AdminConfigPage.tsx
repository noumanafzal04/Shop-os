import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import { Link } from "react-router";
import { useModuleCatalog, useModulePrices } from "../hooks/useAdmin";
import { BoltIcon } from "../../../icons";
import { PageHeader } from "../components/kit";
import { useBusinessTypes } from "../../shop/hooks/useShop";

/**
 * Platform Configuration — a read-only overview of the two curated registries
 * that shape every tenant: the MODULES and the BUSINESS TYPE ENGINE (each
 * type's units, variant attributes, item types and default features). These
 * are product decisions defined in code, not per-tenant settings, so this
 * screen explains them rather than editing them.
 *
 * It used to say a plan "grants one or more modules" and that POS "includes
 * Expense & Income" — neither true since plans stopped carrying a module map,
 * and marked three modules "sellable" on a rule nothing implemented. It says
 * now what is the case: a plan includes some modules to START a shop with;
 * any other its trade can use is an add-on for that one shop, at the price
 * set on the Plans page.
 */

const FEATURE_LABEL: Record<string, string> = {
  products: "Products", services: "Services", inventory: "Inventory",
  marketplace: "Online", reservations: "Reservations", delivery: "Delivery",
  dine_in: "Dine-in", pos: "POS", expenses: "Expense & Income", images: "Images",
};

export default function AdminConfigPage() {
  const modules = useModuleCatalog();
  const prices = useModulePrices();
  const types = useBusinessTypes();

  return (
    <>
      <PageMeta title="Platform Configuration" description="Modules & business types" />

      <PageHeader
        icon={<BoltIcon />}
        tone="orange"
        title="Platform Configuration"
        subtitle="Every module there is, and what each business type gives a merchant. Defined in the product — shown here so plans and add-ons are decided with the full picture."
      />

      {/* ── Modules ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Modules</h3>
          <Badge size="sm" color="info">{(modules.data ?? []).length} in all</Badge>
        </div>
        <p className="mb-4 max-w-3xl text-theme-sm text-gray-500 dark:text-gray-400">
          A plan <span className="font-medium text-gray-700 dark:text-gray-300">includes</span> some of these — what a shop
          is switched on with when it is given the plan. Any other module its trade can use is an{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">add-on</span>: switched on for that one shop,
          which stays on its plan, with the add-on&rsquo;s price added to its bill. What each plan includes, and what
          each add-on costs, are both set on{" "}
          <Link to="/admin/plans" className="font-medium text-brand-600 hover:underline dark:text-brand-400">Plans</Link>.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))
          ) : (
            (modules.data ?? []).map((m) => (
              <div key={m.key} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h4 className="font-medium text-gray-800 dark:text-white/90">{m.label}</h4>
                  {prices.data?.[m.key] ? (
                    <Badge size="sm" color="warning">Rs {Math.round(prices.data[m.key]).toLocaleString()} / mo</Badge>
                  ) : (
                    <Badge size="sm" color="light">free to add</Badge>
                  )}
                </div>
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">{m.description}</p>
                {m.depends.length > 0 && (
                  <p className="mt-2 text-theme-xs text-gray-400">
                    Needs {m.depends.map((d) => (modules.data ?? []).find((x) => x.key === d)?.label ?? d).join(" and ")}.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Business Type Engine ────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Business Types</h3>
          <Badge size="sm" color="info">the engine</Badge>
        </div>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          Selecting a type sets a merchant's default features, the item types they can create, their
          selling units and their variant attributes — no separate app per vertical.
        </p>

        <div className="space-y-4">
          {types.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))
          ) : (
            (types.data ?? []).map((t) => {
              const onFeatures = Object.entries(t.features).filter(([, v]) => v).map(([k]) => k);
              return (
                <div key={t.code} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">{t.label}</h4>
                      <p className="text-theme-xs text-gray-400">{t.examples.join(" · ")}</p>
                    </div>
                    <span className="text-theme-xs text-gray-400">{t.categories.length} categories</span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <ConfigList label="Item types" items={t.item_types} tone="brand" />
                    <ConfigList label="Default features" items={onFeatures.map((f) => FEATURE_LABEL[f] ?? f)} tone="success" />
                    <ConfigList label="Units" items={t.units} tone="muted" />
                    <ConfigList label="Variant attributes" items={t.variant_attributes} tone="muted" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
}

function ConfigList({ label, items, tone }: { label: string; items: string[]; tone: "brand" | "success" | "muted" }) {
  const cls =
    tone === "brand" ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
    : tone === "success" ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  return (
    <div>
      <p className="mb-1.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      {items.length === 0 ? (
        <span className="text-theme-xs text-gray-400">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((it) => (
            <span key={it} className={`rounded-full px-2 py-0.5 text-theme-xs ${cls}`}>{it}</span>
          ))}
        </div>
      )}
    </div>
  );
}
