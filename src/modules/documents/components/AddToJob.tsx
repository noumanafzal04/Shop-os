import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import Input from "../../../components/form/input/InputField";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { catalogService } from "../../catalog/services/catalogService";

/**
 * "Two more litres of oil, and an hour's labour."
 *
 * The box a job card's lines go on through, while the work is being done. A
 * part with sizes is offered size by size — a 175/70 R13 and a 195/65 R15 are
 * different prices, and "Tyre" is not something anybody fits. The price is
 * the server's: this only says WHICH item and how many.
 */
export function AddToJob({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (pick: { product_id: string; variant_id: string | null; name: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search, 250);

  const found = useQuery({
    queryKey: ["job-card", "add", term],
    queryFn: async () => (await catalogService.products({ search: term, per_page: 8 })).data,
    enabled: term.trim().length >= 2,
  });

  type Pick = { product_id: string; variant_id: string | null; name: string };
  const picks: Pick[] = (found.data ?? []).flatMap((p): Pick[] => {
    const sizes = (p.variants ?? []).filter((v) => v.is_active !== false);

    return sizes.length > 0
      ? sizes.map((v) => ({ product_id: p.id, variant_id: v.id, name: `${p.name} · ${v.name}` }))
      : [{ product_id: p.id, variant_id: null, name: p.name }];
  });

  return (
    <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
      <Input
        aria-label="Add a part or labour to this job"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Add a part or labour — search by name or code"
      />
      {term.trim().length >= 2 && !found.isFetching && picks.length === 0 && (
        <p className="mt-1.5 text-theme-xs text-gray-400">Nothing on the shelf matches “{term.trim()}”.</p>
      )}
      {picks.length > 0 && search.trim().length >= 2 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Matching items">
          {picks.slice(0, 10).map((p) => (
            <button
              key={`${p.product_id}:${p.variant_id ?? ""}`}
              type="button"
              disabled={disabled}
              onClick={() => { onAdd(p); setSearch(""); }}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-theme-xs text-gray-700 hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-brand-500/10"
            >
              + {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
