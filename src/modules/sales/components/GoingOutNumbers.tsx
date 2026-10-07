import { useQuery } from "@tanstack/react-query";
import Input from "../../../components/form/input/InputField";
import { catalogService } from "../../catalog/services/catalogService";

/**
 * The number of each unit that goes OUT on an exchange.
 *
 * A faulty phone swapped for another of the same model is the commonest
 * exchange a phone shop does — and the replacement used to leave with no
 * number at all, because this sheet had nowhere to write one. A year later
 * the warranty desk had the old unit on file and nothing for the one in the
 * customer's hand.
 */
export function GoingOutNumbers({
  productId,
  name,
  quantity,
  value,
  onChange,
}: {
  productId: string;
  name: string;
  quantity: number;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const onShelf = useQuery({
    queryKey: ["product-serials", productId],
    queryFn: async () => (await catalogService.serials(productId, "in_stock")).data,
  });

  const units = Math.max(1, Math.floor(quantity));
  const written = Array.from({ length: units }, (_, i) => (value[i] ?? "").trim());
  const set = (i: number, serial: string) => onChange(Array.from({ length: units }, (_, j) => (j === i ? serial : value[j] ?? "")));
  const offered = (onShelf.data ?? []).filter((s) => !written.includes(s.serial));
  const missing = written.filter((s) => s === "").length;

  return (
    <div className="mb-2 ml-1 mt-1 space-y-1.5">
      {written.map((_, i) => (
        <Input
          key={i}
          aria-label={`Serial / IMEI of ${name} going out${units > 1 ? `, unit ${i + 1}` : ""}`}
          value={value[i] ?? ""}
          onChange={(e) => set(i, e.target.value)}
          placeholder="Serial / IMEI of the unit going out"
        />
      ))}
      {offered.length > 0 && missing > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {offered.slice(0, 20).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => set(written.findIndex((w) => w === ""), s.serial)}
              className="rounded-md bg-brand-50 px-2 py-0.5 text-theme-xs font-medium text-brand-600 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300"
            >
              {s.serial}
            </button>
          ))}
        </div>
      )}
      {missing > 0 && (
        <p className="text-theme-xs text-warning-600 dark:text-warning-400">
          {missing === 1 ? "No number written" : `${missing} units have no number`} — the warranty desk will not be able to find {missing === 1 ? "this unit" : "them"}.
        </p>
      )}
    </div>
  );
}
