import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Checkbox from "../../../components/form/input/Checkbox";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useMoney } from "../../shop/hooks/useShop";
import { useCountSheet, useStocktakeMutations } from "../hooks/useStocktake";
import type { StockCountLine } from "../services/stocktakeService";

/**
 * The count sheet — the screen somebody stands in the aisle with.
 *
 * Every figure is saved the moment they leave the box, because a count is done
 * over an hour on a phone and a page that loses work is a page nobody finishes.
 * An empty box is NOT a zero: leaving it blank means "nobody reached this
 * shelf", and applying the count skips it. Typing 0 means the shelf is empty,
 * which is a real and different answer.
 */
export default function StockCountSheetPage() {
  const { id } = useParams<{ id: string }>();
  const money = useMoney();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canApply = hasPermission("settings.manage");

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const sheet = useCountSheet(id, { search: query || undefined, uncounted: onlyUncounted });
  const { record, apply, cancel } = useStocktakeMutations(id);

  // What the counter has typed but not yet committed, keyed by line. The server
  // response is authoritative for everything else.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [counted, setCounted] = useState<Record<string, number | null>>({});

  const applyModal = useModal();
  const [applyNotes, setApplyNotes] = useState("");

  const count = sheet.data?.count;
  const blind = sheet.data?.blind ?? true;
  const open = count?.status === "counting";

  const items = sheet.data?.items ?? [];

  // Live progress: the server figure plus whatever has been saved since.
  const progress = useMemo(() => {
    const base = count?.lines_counted ?? 0;
    const delta = Object.entries(counted).reduce((sum, [lineId, value]) => {
      const original = items.find((i) => i.id === lineId)?.counted_quantity ?? null;
      const was = original !== null;
      const now = value !== null;
      return sum + (now ? 1 : 0) - (was ? 1 : 0);
    }, 0);
    return Math.max(0, base + delta);
  }, [count?.lines_counted, counted, items]);

  const valueOf = (line: StockCountLine): string => {
    if (draft[line.id] !== undefined) return draft[line.id];
    if (line.id in counted) return counted[line.id] === null ? "" : String(counted[line.id]);
    return line.counted_quantity === null ? "" : String(Number(line.counted_quantity));
  };

  const commit = (line: StockCountLine) => {
    const raw = draft[line.id];
    if (raw === undefined) return;

    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast.error("A shelf cannot hold less than nothing.");
      setDraft((d) => {
        const next = { ...d };
        delete next[line.id];
        return next;
      });
      return;
    }

    // Nothing actually changed — don't spend a request on it.
    const current = line.id in counted ? counted[line.id] : (line.counted_quantity === null ? null : Number(line.counted_quantity));
    if (current === value) {
      setDraft((d) => {
        const next = { ...d };
        delete next[line.id];
        return next;
      });
      return;
    }

    record.mutate([{ item_id: line.id, counted_quantity: value }], {
      onSuccess: () => {
        setCounted((c) => ({ ...c, [line.id]: value }));
        setDraft((d) => {
          const next = { ...d };
          delete next[line.id];
          return next;
        });
        setSaved((s) => ({ ...s, [line.id]: true }));
        setTimeout(() => setSaved((s) => ({ ...s, [line.id]: false })), 1200);
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't save that figure."),
    });
  };

  const submitApply = () => {
    apply.mutate(applyNotes.trim() || undefined, {
      onSuccess: (res) => {
        applyModal.closeModal();
        setApplyNotes("");
        const v = Number(res.data.variance_value ?? 0);
        toast.success(
          Math.abs(v) < 0.005
            ? "Count applied — the shelves matched the books."
            : `Count applied — ${money(Math.abs(v))} ${v < 0 ? "short" : "over"}.`,
        );
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't apply the count."),
    });
  };

  const cancelCount = async () => {
    if (!id) return;
    const ok = await confirm({
      title: `Cancel ${count?.reference}?`,
      message: "Nothing is written to stock and the figures entered so far are discarded.",
      confirmLabel: "Cancel count",
      tone: "danger",
    });
    if (!ok) return;
    cancel.mutate(id, {
      onSuccess: () => {
        toast.success("Count cancelled");
        navigate("/tenant/stocktake");
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't cancel it."),
    });
  };

  const summary = sheet.data?.summary;

  return (
    <>
      <PageMeta title="Count sheet | ShopOS" description="Count the shelves against what the system believes" />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/tenant/stocktake" className="text-theme-sm text-gray-400 hover:text-gray-600">
              Stocktake
            </Link>
            <span className="text-gray-300">/</span>
            <h2 className="font-mono text-xl font-semibold text-gray-800 dark:text-white/90">
              {count?.reference ?? "…"}
            </h2>
            {count && (
              <Badge size="sm" color={count.status === "applied" ? "success" : count.status === "counting" ? "info" : "light"}>
                {count.status === "counting" ? "Counting" : count.status === "applied" ? "Applied" : "Cancelled"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {count?.branch?.name ?? "Main"}
            {count?.scope === "category" && count.category ? ` · ${count.category.name}` : " · whole shop"}
            {count ? ` · ${progress} of ${count.lines_total} counted` : ""}
          </p>
        </div>

        {open && (
          <div className="flex gap-2">
            {canApply && (
              <Button size="sm" variant="outline" onClick={cancelCount} disabled={cancel.isPending}>
                Cancel count
              </Button>
            )}
            {canApply && (
              <Button size="sm" onClick={() => applyModal.openModal()} disabled={progress === 0}>
                Apply count
              </Button>
            )}
          </div>
        )}
      </div>

      {blind && open && (
        <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 p-3 text-theme-sm text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
          Counting blind. What the system expects stays hidden until the count is applied — a counter who knows
          the answer stops counting when they reach it.
        </div>
      )}

      {/* What the count found — only once there is something to see. */}
      {summary && summary.counted > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Counted", value: String(summary.counted), hint: "lines", tone: "gray" },
            { label: "Matched", value: String(summary.matched), hint: "exactly right", tone: "success" },
            { label: "Short", value: money(summary.short_value), hint: `${summary.short_lines} lines`, tone: "error" },
            { label: "Over", value: money(summary.over_value), hint: `${summary.over_lines} lines`, tone: "warning" },
            { label: "Net", value: money(summary.net_value), hint: `${summary.net_units} units`, tone: "gray" },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <p className="text-theme-xs uppercase tracking-wide text-gray-400">{tile.label}</p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${
                  tile.tone === "error"
                    ? "text-error-600 dark:text-error-400"
                    : tile.tone === "warning"
                      ? "text-warning-600 dark:text-warning-400"
                      : tile.tone === "success"
                        ? "text-success-600 dark:text-success-400"
                        : "text-gray-800 dark:text-white/90"
                }`}
              >
                {tile.value}
              </p>
              <p className="mt-0.5 text-theme-xs text-gray-400">{tile.hint}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name or barcode…" />
        {open && (
          <Checkbox checked={onlyUncounted} onChange={setOnlyUncounted} label="Only what's left" />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {sheet.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {onlyUncounted ? "Every line has been counted." : "Nothing matches."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  {!blind && <th className="px-5 py-3 text-right">System</th>}
                  <th className="px-5 py-3 text-right">Counted</th>
                  {!blind && <th className="px-5 py-3 text-right">Difference</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((line) => {
                  const localCount = line.id in counted ? counted[line.id] : (line.counted_quantity === null ? null : Number(line.counted_quantity));
                  const variance =
                    !blind && line.expected_quantity !== undefined && localCount !== null
                      ? Math.round((localCount - Number(line.expected_quantity)) * 1000) / 1000
                      : null;

                  return (
                    <tr key={line.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                      <td className="px-5 py-2.5">
                        <span className="text-gray-800 dark:text-white/90">{line.product_name}</span>
                        {line.variant_name && (
                          <span className="text-gray-400"> · {line.variant_name}</span>
                        )}
                        {line.sku && (
                          <span className="ml-2 font-mono text-theme-xs text-gray-400">{line.sku}</span>
                        )}
                      </td>
                      {!blind && (
                        <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                          {Number(line.expected_quantity ?? 0)}
                        </td>
                      )}
                      <td className="px-5 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {saved[line.id] && <span className="text-theme-xs text-success-500">saved</span>}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            disabled={!open}
                            value={valueOf(line)}
                            onChange={(e) => setDraft((d) => ({ ...d, [line.id]: e.target.value }))}
                            onBlur={() => commit(line)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            placeholder="—"
                            className="h-9 w-24 rounded-lg border border-gray-300 px-3 text-right text-sm tabular-nums focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                          />
                        </div>
                      </td>
                      {!blind && (
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {variance === null ? (
                            <span className="text-gray-400">not counted</span>
                          ) : variance === 0 ? (
                            <span className="text-success-600 dark:text-success-400">exact</span>
                          ) : (
                            <span
                              className={
                                variance < 0
                                  ? "text-error-600 dark:text-error-400"
                                  : "text-warning-600 dark:text-warning-400"
                              }
                            >
                              {variance > 0 ? "+" : "−"}
                              {Math.abs(variance)}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <p className="mt-3 text-theme-xs text-gray-400">
          Leave a box empty for a shelf nobody reached — applying the count skips it. Type 0 only when the shelf
          really is empty.
        </p>
      )}

      {/* Apply ──────────────────────────────────────────────────────── */}
      <Modal isOpen={applyModal.isOpen} onClose={applyModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Apply this count</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Stock moves by the <strong>difference</strong> each line found, so anything sold while you counted is
          kept. Shelves nobody reached are left alone.
        </p>

        {summary && (
          <div className="mb-4 space-y-1 rounded-xl bg-gray-50 p-3 text-theme-sm dark:bg-white/[0.03]">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Lines counted</span>
              <span className="tabular-nums text-gray-800 dark:text-white/90">{summary.counted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Missing</span>
              <span className="tabular-nums text-error-600 dark:text-error-400">{money(summary.short_value)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Extra found</span>
              <span className="tabular-nums text-warning-600 dark:text-warning-400">{money(summary.over_value)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1 font-medium dark:border-gray-700">
              <span className="text-gray-700 dark:text-gray-300">Net</span>
              <span className="tabular-nums text-gray-800 dark:text-white/90">{money(summary.net_value)}</span>
            </div>
          </div>
        )}

        <div>
          <Label>Notes</Label>
          <TextArea
            rows={2}
            value={applyNotes}
            onChange={setApplyNotes}
            placeholder="e.g. rice shelf water-damaged, 2 bags binned"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={applyModal.closeModal}>Not yet</Button>
          <Button size="sm" onClick={submitApply} disabled={apply.isPending}>
            {apply.isPending ? "Applying…" : "Apply count"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
