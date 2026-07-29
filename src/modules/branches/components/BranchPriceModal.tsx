import { useEffect, useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import { useMoney } from "../../shop/hooks/useShop";
import { ApiError } from "../../../common/types/api";
import { useBranchPrices, useSetBranchPrices } from "../hooks/useBranchPrices";

/**
 * Per-branch price editor for one product. Each branch has an input that
 * defaults to (placeholder) the catalog price; typing a value overrides it at
 * that branch, clearing it falls back to the catalog price. Server-authoritative
 * — this only sets the list price; the POS still prices every sale on the server.
 */
export default function BranchPriceModal({
  productId,
  productName,
  onClose,
}: {
  productId: string | null;
  productName?: string;
  onClose: () => void;
}) {
  const money = useMoney();
  const toast = useToast();
  const { data, isLoading } = useBranchPrices(productId);
  const save = useSetBranchPrices(productId ?? "");

  // Local edits keyed by branch id (string inputs; "" = use catalog price).
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      setEdits(Object.fromEntries(data.branches.map((b) => [b.branch_id, b.price ?? ""])));
    }
  }, [data]);

  const submit = () => {
    const prices = Object.entries(edits).map(([branch_id, v]) => ({
      branch_id,
      price: v.trim() === "" ? null : Number(v),
    }));
    save.mutate(prices, {
      onSuccess: () => { toast.success("Branch pricing saved"); onClose(); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't save pricing."),
    });
  };

  return (
    <Modal isOpen={!!productId} onClose={onClose} className="max-w-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Branch pricing</h3>
      <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">{productName}</p>
      {data && (
        <p className="mb-4 text-theme-xs text-gray-400">
          Catalog price {money(data.base_price)} · leave a branch blank to use it
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.branches ?? []).map((b) => (
            <div key={b.branch_id} className="flex items-center gap-3">
              <div className="flex flex-1 items-center gap-2">
                <span className="text-sm text-gray-800 dark:text-white/90">{b.branch}</span>
                {b.is_default && <Badge size="sm" color="info">Main</Badge>}
              </div>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={edits[b.branch_id] ?? ""}
                placeholder={data?.base_price}
                onChange={(e) => setEdits((s) => ({ ...s, [b.branch_id]: e.target.value }))}
                className="h-11 w-32 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm tabular-nums focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={save.isPending || isLoading}>
          {save.isPending ? "Saving…" : "Save pricing"}
        </Button>
      </div>
    </Modal>
  );
}
