import { useAuthStore } from "../../../stores/authStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "../hooks/useBranches";
import { byKind, hasSecondShop } from "../places";
import { ANY_BRANCH, mayChangeAt, soldAtWords, toggleBranch, type Listed, type SoldAt } from "../soldAt";

/**
 * "SOLD AT" — on the product form and the category form (v2).
 *
 * The owner, or someone the owner allowed ("Products at every branch"): All
 * branches, or the ones ticked. Anybody else: a line saying where it goes —
 * their own branch — and, on something sold elsewhere too, why their Save will
 * be refused, before they press it.
 *
 * Drawn only in a shop with a second branch that sells. One shop: nothing here.
 */
export function SoldAtField({
  value,
  onChange,
  noun,
  existing,
}: {
  /** What the form shows — the item's listing, or a new item's starting point. */
  value: SoldAt;
  onChange: (next: SoldAt) => void;
  /** "item" | "category" — said in the sentences. */
  noun: string;
  /** The item as it was opened for editing; absent on a new one. */
  existing?: Listed | null;
}) {
  const settings = useShopSettings();
  const twoShops = hasSecondShop(settings.data);
  const branches = useBranches(twoShops);
  const chooses = useAuthStore((s) => s.hasPermission(ANY_BRANCH));
  const own = useAuthStore((s) => s.user?.branch_id ?? null);

  if (!twoShops) return null;

  const shops = byKind((branches.data ?? []).filter((b) => b.is_active)).shops;
  const names = new Map(shops.map((b) => [b.id, b.name] as const));

  if (!chooses) {
    const theirs = existing == null || mayChangeAt(false, existing, own);

    return (
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-sold-at="fixed">
        <span className="block text-sm font-medium text-gray-800 dark:text-white/90">Sold at</span>
        {theirs ? (
          <span className="mt-0.5 block text-theme-xs text-gray-500 dark:text-gray-400">
            {names.get(own ?? "") ?? "Your branch"} — your branch. Only the owner, or someone the owner allows, can add this {noun} at other branches.
          </span>
        ) : (
          <span className="mt-0.5 block text-theme-xs text-warning-600 dark:text-warning-400" role="note">
            {soldAtWords(value, names)}. This {noun} is sold at other branches too — only the owner, or someone the owner allows, can change it. You can still set its price and stock at your branch.
          </span>
        )}
      </div>
    );
  }

  const pickOnly = () => onChange({ all: false, ids: value.ids.length > 0 ? value.ids : own && names.has(own) ? [own] : shops.slice(0, 1).map((b) => b.id) });

  return (
    <fieldset className="rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-sold-at="choose">
      <legend className="px-1 text-sm font-medium text-gray-800 dark:text-white/90">Sold at</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Where this ${noun} is sold`}>
        <button
          type="button"
          role="radio"
          aria-checked={value.all}
          onClick={() => onChange({ all: true, ids: [] })}
          className={`rounded-lg border px-3 py-1.5 text-sm ${value.all ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"}`}
        >
          All branches
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!value.all}
          onClick={pickOnly}
          className={`rounded-lg border px-3 py-1.5 text-sm ${!value.all ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"}`}
        >
          Only these branches
        </button>
      </div>

      {!value.all && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2" data-sold-at-branches>
          {shops.map((b) => {
            const ticked = value.ids.includes(b.id);
            const last = ticked && value.ids.length === 1;

            return (
              <label key={b.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300" title={last ? `A ${noun} is sold at one branch at least` : undefined}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={ticked}
                  disabled={last}
                  onChange={() => onChange(toggleBranch(value, b.id))}
                />
                {b.name}
              </label>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-theme-xs text-gray-400">
        {value.all
          ? `On the POS and stock screens of every branch — and of any branch you open later.`
          : `Only on the POS and stock screens of the branches ticked. Its price and stock stay each branch's own.`}
      </p>
    </fieldset>
  );
}
