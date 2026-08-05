import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useMoney } from "../../shop/hooks/useShop";
import { useAlternatives } from "../hooks/usePharmacy";
import type { Alternative } from "../services/pharmacyService";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The drug the customer asked for — usually the one that's out. */
  productId: string | null;
  /** Ring the chosen equivalent instead. */
  onPick: (alternative: Alternative) => void;
}

/**
 * "The brand is out — what else has the same salt?"
 *
 * The customer is standing at the counter with a prescription for something
 * the shelf doesn't have. The answer is a molecule question, not a brand one,
 * so the list is built on generic name.
 *
 * A different strength or form is shown rather than hidden: 2 × 250mg is a
 * real substitution a pharmacist can make, and quietly filtering it out would
 * turn a solvable situation into "we don't have it".
 */
export default function SubstitutePicker({ isOpen, onClose, productId, onPick }: Props) {
  const money = useMoney();
  const query = useAlternatives(isOpen ? productId : null);
  const data = query.data;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Same salt, in stock</h3>
      {data?.source && (
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          Instead of <span className="font-medium text-gray-700 dark:text-gray-200">{data.source.name}</span>
          {data.source.generic_name ? ` (${data.source.generic_name}${data.source.strength ? ` ${data.source.strength}` : ""})` : ""}
        </p>
      )}

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : data?.reason === "no_generic_name" ? (
        <p className="py-8 text-center text-theme-sm text-gray-500 dark:text-gray-400">
          No generic name is recorded for this item, so equivalents can't be found. Add one on the product to
          make substitution work.
        </p>
      ) : (data?.alternatives.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-theme-sm text-gray-500 dark:text-gray-400">
          Nothing with the same salt is in stock.
        </p>
      ) : (
        <ul className="max-h-[24rem] space-y-2 overflow-y-auto">
          {data!.alternatives.map((alt) => (
            <li key={alt.id}>
              <button
                type="button"
                onClick={() => { onPick(alt); onClose(); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:hover:bg-brand-500/10"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-gray-800 dark:text-white/90">{alt.name}</span>
                    {/* The two things a pharmacist must notice before swapping. */}
                    {!alt.same_strength && <Badge size="sm" color="warning">Different strength</Badge>}
                    {!alt.same_form && <Badge size="sm" color="light">{alt.dosage_form ?? "Other form"}</Badge>}
                    {alt.schedule && <Badge size="sm" color="error">Schedule {alt.schedule}</Badge>}
                  </div>
                  <div className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {[alt.generic_name, alt.strength].filter(Boolean).join(" · ")} · {alt.stock_quantity} in stock
                  </div>
                </div>
                <span className="shrink-0 font-semibold text-gray-800 dark:text-white/90">{money(alt.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
