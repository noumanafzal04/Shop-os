import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../../common/api/client";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useAuthStore } from "../../../stores/authStore";

export interface SuggestedCustomer {
  id: string;
  name: string | null;
  phone: string | null;
}

/**
 * What to search by: the number once it has five digits, else the name once
 * it has three letters, else nothing. Five, not four: "0300" is every Jazz
 * customer the shop has, and a list of all of them is not a look-up (the
 * user, 2026-10-21: "after 5, 6 digits … not a request on every key").
 */
function suggestionQuery(name: string, phone: string): string {
  if (phone.replace(/\D/g, "").length >= 5) return phone.trim();
  const typed = name.trim();

  return typed.length >= 3 ? typed : "";
}

/**
 * SOMEBODY ALREADY ON FILE, FROM A FEW LETTERS OR DIGITS.
 *
 * The till's Customer box and the quotation form were two empty boxes: to put
 * an existing customer on a sale or a quote, the cashier had to know their
 * number and type it exactly (the user, 2026-10-15 — L8). Under the two boxes,
 * this lists who matches what is being typed; a tap fills both. It asks the
 * counter's own look-up, so a cashier without the customers permission gets
 * it too. Nothing is listed without the Customers module, offline, or once the
 * boxes already hold the person found.
 */
export function CustomerSuggestions({
  name,
  phone,
  onPick,
}: {
  name: string;
  phone: string;
  onPick: (customer: SuggestedCustomer) => void;
}) {
  const hasCustomers = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features?.customers === true,
  );
  // Asked once the typing pauses, not on every key.
  const q = useDebouncedValue(suggestionQuery(name, phone), 500);
  const found = useQuery({
    queryKey: ["customer-suggestions", q],
    queryFn: async () => (await apiGet<SuggestedCustomer[]>("/customers-lookup", { params: { q } })).data ?? [],
    enabled: hasCustomers && q !== "",
    staleTime: 30_000,
    retry: false,
  });

  const list = (found.data ?? []).filter((c) => !(c.phone === phone.trim() && (c.name ?? "") === name.trim()));
  const settled = (found.data ?? []).some((c) => c.phone === phone.trim() && (c.name ?? "") === name.trim());
  if (!hasCustomers || q === "" || settled || list.length === 0) return null;

  return (
    <div data-testid="customer-suggestions" className="mt-1 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <p className="px-3 pb-1 pt-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Already on file</p>
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5"
        >
          <span className="truncate font-medium text-gray-800 dark:text-white/90">{c.name ?? "No name yet"}</span>
          <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{c.phone}</span>
        </button>
      ))}
    </div>
  );
}
