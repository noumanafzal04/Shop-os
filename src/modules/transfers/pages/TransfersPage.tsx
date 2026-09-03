import { useMemo, useState } from "react";
import { NoAccess } from "../../../common/ui/NoAccess";
import { deniedReason } from "../../../common/api/denied";
import { useQuery } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import Pager from "../../../components/ui/pager";
import { ApiError } from "../../../common/types/api";
import { useBranches } from "../../branches/hooks/useBranches";
import { catalogService } from "../../catalog/services/catalogService";
import { useTransfers, useCreateTransfer } from "../hooks/useTransfers";

interface Line {
  product_id: string;
  name: string;
  quantity: number;
}

export default function TransfersPage() {
  const branches = useBranches();
  const [page, setPage] = useState(1);
  const transfers = useTransfers(page);
  const create = useCreateTransfer();
  const modal = useModal();
  const toast = useToast();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");

  const branchOptions = useMemo(
    () => (branches.data ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name })),
    [branches.data],
  );

  // Live product search for the line picker — only fires at 2+ characters.
  const results = useQuery({
    queryKey: ["products", "transfer-search", search],
    queryFn: async () => (await catalogService.products({ search })).data,
    enabled: search.trim().length >= 2,
  });

  const reset = () => {
    setFromId(""); setToId(""); setNotes(""); setLines([]); setSearch("");
  };
  const open = () => { reset(); modal.openModal(); };

  const addLine = (p: { id: string; name: string }) => {
    setSearch("");
    setLines((ls) =>
      ls.some((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, name: p.name, quantity: 1 }],
    );
  };
  const setQty = (id: string, q: number) =>
    setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, quantity: q } : l)));
  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.product_id !== id));

  const canSubmit =
    fromId && toId && fromId !== toId && lines.length > 0 && lines.every((l) => l.quantity > 0);

  const submit = () => {
    create.mutate(
      {
        from_branch_id: fromId,
        to_branch_id: toId,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
      },
      {
        onSuccess: (res) => { toast.success(`Transfer ${res.data.reference} completed`); modal.closeModal(); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Transfer failed."),
      },
    );
  };

  const rows = transfers.data?.data ?? [];

  return (
    <>
      <PageMeta title="Stock Transfers | CartZe" description="Move stock between branches" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Stock Transfers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Move stock from one branch to another</p>
        </div>
        <Button size="sm" onClick={open} disabled={branchOptions.length < 2}>+ New transfer</Button>
      </div>

      {/* A refused branch list left this button greyed out with no reason
          given — indistinguishable from a shop that only has one branch. */}
      {deniedReason(branches.error) && (
        <div className="mb-6">
          <NoAccess reason={deniedReason(branches.error)!} what="the branch list" />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-theme-xs uppercase text-gray-400 dark:border-gray-800">
                <th className="px-6 py-3 font-medium">Reference</th>
                <th className="px-6 py-3 font-medium">From → To</th>
                <th className="px-6 py-3 font-medium">Items</th>
                <th className="px-6 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {transfers.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-6 py-4"><div className="h-5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">No transfers yet.</td></tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id}>
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">{t.reference}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                      <span className="inline-flex items-center gap-2">
                        {t.from_branch?.name ?? "—"}
                        <span className="text-gray-400">→</span>
                        {t.to_branch?.name ?? "—"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color="light">{t.items?.length ?? 0} item{(t.items?.length ?? 0) === 1 ? "" : "s"}</Badge>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager pagination={transfers.data?.meta?.pagination} onPage={setPage} noun="transfers" />
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">New transfer</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>From branch <span className="text-error-500">*</span></Label>
            <Select
              options={branchOptions.filter((o) => o.value !== toId)}
              value={fromId}
              onChange={setFromId}
              placeholder="Source branch"
            />
          </div>
          <div>
            <Label>To branch <span className="text-error-500">*</span></Label>
            <Select
              options={branchOptions.filter((o) => o.value !== fromId)}
              value={toId}
              onChange={setToId}
              placeholder="Destination branch"
            />
          </div>
        </div>

        <div className="mt-5">
          <Label>Add items</Label>
          <div className="relative">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products by name, SKU or barcode…" />
            {search.trim().length >= 2 && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {results.isLoading ? (
                  <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
                ) : (results.data ?? []).length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">No matches.</div>
                ) : (
                  (results.data ?? []).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addLine(p)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                    >
                      <span className="text-gray-800 dark:text-white/90">{p.name}</span>
                      <span className="text-theme-xs text-gray-400">{p.sku ?? ""}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400 dark:border-gray-800">
              No items added yet.
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.product_id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-2.5 dark:border-gray-800">
                <span className="flex-1 text-sm text-gray-800 dark:text-white/90">{l.name}</span>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={l.quantity}
                  onChange={(e) => setQty(l.product_id, Number(e.target.value))}
                  className="h-9 w-24 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm tabular-nums focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                />
                <button
                  onClick={() => removeLine(l.product_id)}
                  className="text-gray-400 hover:text-error-500"
                  aria-label={`Remove ${l.name}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4">
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional reason for the transfer" />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit || create.isPending}>
            {create.isPending ? "Transferring…" : "Transfer stock"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
