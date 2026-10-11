import { Modal } from "../../../components/ui/modal";
import Badge from "../../../components/ui/badge/Badge";
import { useBranchStock } from "../hooks/useTransfers";

/**
 * "Who has this" — this product's on-hand at every open branch and warehouse.
 * Opened from the product list when stock could be in more than one place.
 */
export default function BranchStockModal({
  productId,
  productName,
  onClose,
}: {
  productId: string | null;
  productName?: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useBranchStock(productId);

  return (
    <Modal isOpen={!!productId} onClose={onClose} className="max-w-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Stock by place</h3>
      {productName && <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{productName}</p>}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {(data ?? []).map((row) => (
            <div key={row.branch_id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 dark:text-white/90">{row.branch}</span>
                {row.is_default && <Badge size="sm" color="info">Main</Badge>}
                {/* "Godown: 40" is a walk to the back, not a customer to send
                    across the city. */}
                {row.kind === "warehouse" && <Badge size="sm" color="light">Warehouse</Badge>}
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  row.quantity > 0 ? "text-gray-800 dark:text-white/90" : "text-gray-400"
                }`}
              >
                {row.quantity} in stock
              </span>
            </div>
          ))}
          {(data?.length ?? 0) === 0 && (
            <p className="py-6 text-center text-sm text-gray-400">No stock recorded at any place yet.</p>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
