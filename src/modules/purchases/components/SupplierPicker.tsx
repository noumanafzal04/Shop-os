import { useId, useState } from "react";

import Input from "../../../components/form/input/InputField";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useSuppliers } from "../hooks/usePurchases";
import type { Supplier } from "../types";

/**
 * WHICH SUPPLIER — found by typing, from all of them.
 *
 * It was a <select> of the first page of suppliers: a shop with a twenty-first
 * distributor could not order from it at all. The server searches, so the
 * list is never cut short, and the choice shows its name until it is changed.
 */
export function SupplierPicker({
  value,
  onChange,
}: {
  value: Pick<Supplier, "id" | "name"> | null;
  onChange: (supplier: Pick<Supplier, "id" | "name"> | null) => void;
}) {
  const listId = useId();
  const [typed, setTyped] = useState("");
  const search = useDebouncedValue(typed.trim(), 250);
  const found = useSuppliers({ search: search || undefined, is_active: true }, { enabled: value === null });
  const rows = found.data?.data ?? [];

  if (value !== null) {
    return (
      <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 dark:border-gray-700">
        <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90" data-testid="chosen-supplier">{value.name}</span>
        <button
          type="button"
          className="shrink-0 text-theme-xs font-medium text-brand-500 hover:text-brand-600"
          onClick={() => { setTyped(""); onChange(null); }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        placeholder="Type a supplier's name…"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        aria-label="Supplier"
        aria-controls={listId}
      />
      <ul id={listId} role="listbox" aria-label="Suppliers" className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {found.isPending ? (
          <li className="px-3 py-2 text-theme-xs text-gray-400">Looking…</li>
        ) : rows.length === 0 ? (
          <li className="px-3 py-2 text-theme-xs text-gray-400">
            <ListEmpty from={found} what="the suppliers">
              {search ? "No supplier by that name." : "No suppliers yet — add one under Suppliers."}
            </ListEmpty>
          </li>
        ) : (
          rows.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
                onClick={() => onChange({ id: s.id, name: s.name })}
              >
                {s.name}
                {s.contact_person && <span className="text-theme-xs text-gray-400"> · {s.contact_person}</span>}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
