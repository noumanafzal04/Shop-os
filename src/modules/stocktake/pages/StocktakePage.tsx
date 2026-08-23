import { useState } from "react";
import { Link, useNavigate } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import TextArea from "../../../components/form/input/TextArea";
import Checkbox from "../../../components/form/input/Checkbox";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useMoney } from "../../shop/hooks/useShop";
import { useCategories } from "../../catalog/hooks/useCatalog";
import Pager from "../../../components/ui/pager";
import { useStockCounts, useStocktakeMutations } from "../hooks/useStocktake";
import type { StockCount } from "../services/stocktakeService";

const STATUS: Record<StockCount["status"], { label: string; color: "success" | "info" | "light" }> = {
  counting: { label: "Counting", color: "info" },
  applied: { label: "Applied", color: "success" },
  cancelled: { label: "Cancelled", color: "light" },
};

const when = (t: string | null) => (t ? new Date(t).toLocaleDateString() : "—");

/**
 * Stocktakes.
 *
 * A shop's stock figure drifts — breakage, theft, a sale rung on the wrong
 * item, a delivery received short. Counting is the only way to find out by how
 * much, and the variance in rupees is the number an owner actually acts on.
 */
export default function StocktakePage() {
  const money = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canApply = hasPermission("settings.manage");

  // `useStockCounts` has always taken a page; nothing ever gave it one, and the
  // server answers paginate(25). So the 26th count a shop had ever done was
  // unreachable — and a stock count is precisely the record you look BACK at,
  // because it is where the shop found out what was missing.
  //
  // The folder scan passed this screen as "search only". The search it was
  // credited for is the item lookup on the count SHEET next door; this list has
  // no search box at all, and its one placeholder says "Pick a category". Same
  // shape as the workshop board, in the same blind spot.
  const [page, setPage] = useState(1);
  const counts = useStockCounts({ page });
  const categories = useCategories();
  const { start } = useStocktakeMutations();

  const startModal = useModal();
  const [form, setForm] = useState({ scope: "all", category_id: "", blind: true, notes: "" });

  const openStart = () => {
    setForm({ scope: "all", category_id: "", blind: true, notes: "" });
    start.reset();
    startModal.openModal();
  };

  const submitStart = () => {
    start.mutate(
      {
        scope: form.scope as "all" | "category",
        category_id: form.scope === "category" ? form.category_id || null : null,
        blind: form.blind,
        notes: form.notes.trim() || null,
      },
      {
        onSuccess: (res) => {
          startModal.closeModal();
          toast.success(`${res.data.reference} started — ${res.data.lines_total} lines to count`);
          navigate(`/tenant/stocktake/${res.data.id}`);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't start the count."),
      },
    );
  };

  const rows = counts.data?.data ?? [];
  const open = rows.find((c) => c.status === "counting");

  return (
    <>
      <PageMeta title="Stocktake | CartZe" description="Count the shelves against what the system believes" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Stocktake</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Count the shelves. What the count is worth is the number worth knowing.
          </p>
        </div>
        {open ? (
          <Link to={`/tenant/stocktake/${open.id}`}>
            <Button size="sm">Continue {open.reference}</Button>
          </Link>
        ) : (
          <Button size="sm" onClick={openStart}>+ Start a count</Button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {counts.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No counts yet.</p>
            <p className="mt-1 text-theme-xs text-gray-400">
              Until someone counts, the shop's stock figure is a belief. A first count usually finds more than
              anyone expects.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-5 py-3">Count</th>
                  <th className="px-5 py-3">Scope</th>
                  <th className="px-5 py-3">Branch</th>
                  <th className="px-5 py-3">Started</th>
                  <th className="px-5 py-3 text-right">Lines</th>
                  <th className="px-5 py-3 text-right">Found</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-5 py-3">
                      <Link
                        to={`/tenant/stocktake/${c.id}`}
                        className="font-mono font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {c.reference}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                      {c.scope === "category" ? (c.category?.name ?? "One category") : "Whole shop"}
                      {c.blind && <span className="ml-2 text-theme-xs text-gray-400">blind</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{c.branch?.name ?? "Main"}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{when(c.started_at)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {c.lines_counted} / {c.lines_total}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {c.status === "applied" ? (
                        <span
                          className={
                            Number(c.variance_value) < 0
                              ? "text-error-600 dark:text-error-400"
                              : Number(c.variance_value) > 0
                                ? "text-warning-600 dark:text-warning-400"
                                : "text-success-600 dark:text-success-400"
                          }
                        >
                          {money(Math.abs(Number(c.variance_value ?? 0)))}
                          <span className="ml-1 text-theme-xs font-normal">
                            {Number(c.variance_value) < 0 ? "short" : Number(c.variance_value) > 0 ? "over" : "exact"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge size="sm" color={STATUS[c.status].color}>{STATUS[c.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pager pagination={counts.data?.meta?.pagination} onPage={setPage} noun="counts" />

      {/* Start a count ──────────────────────────────────────────────── */}
      <Modal isOpen={startModal.isOpen} onClose={startModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Start a count</h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          The sheet freezes what the system believes right now. Keep selling — the count is applied as the
          difference, so nothing rung during it is lost.
        </p>

        <div className="space-y-4">
          <div>
            <Label>What to count</Label>
            <Select
              value={form.scope}
              onChange={(v) => setForm((f) => ({ ...f, scope: v }))}
              options={[
                { value: "all", label: "The whole shop" },
                { value: "category", label: "One category" },
              ]}
            />
          </div>

          {form.scope === "category" && (
            <div>
              <Label>Category</Label>
              <Select
                value={form.category_id}
                onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                placeholder="Pick a category"
                options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          )}

          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <Checkbox
              checked={form.blind}
              onChange={(checked) => setForm((f) => ({ ...f, blind: checked }))}
              label="Count blind"
            />
            <p className="mt-1 pl-7 text-theme-xs text-gray-400">
              Hides what the system expects until the count is applied. A counter who knows the answer stops
              counting when they reach it.
            </p>
          </div>

          <div>
            <Label>Notes</Label>
            <TextArea rows={2} value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={startModal.closeModal}>Cancel</Button>
          <Button
            size="sm"
            onClick={submitStart}
            disabled={start.isPending || (form.scope === "category" && !form.category_id)}
          >
            {start.isPending ? "Drawing the sheet…" : "Start counting"}
          </Button>
        </div>
      </Modal>

      {!canApply && rows.length > 0 && (
        <p className="mt-4 text-theme-xs text-gray-400">
          You can count and enter figures. Applying a count writes stock off against the shop's books, so a
          manager signs that off.
        </p>
      )}
    </>
  );
}
