import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import { documentService, type SaleDocument, type WorkStatus } from "../../documents/services/documentService";
import { useVehicleHistory } from "../../vehicles/hooks/useVehicles";
import { shopDate, shopShortDateTime } from "../../../common/format/date";
import { callLink, isOverdue } from "../board";
import { ListEmpty } from "../../../common/ui/ListEmpty";

/**
 * ONE CAR, WITHOUT LEAVING THE BOARD.
 *
 * A card answers "where is it"; the questions after that — what was it in
 * for, what has gone on it so far, when was it last here, what is the owner's
 * number — sent a mechanic off the board to the job card and back. They are
 * answered here, with the stage moves beside them, and the full job card one
 * press away for the billing.
 */
export function JobSheet({
  job,
  stages,
  money,
  moving,
  onMove,
  onClose,
}: {
  job: SaleDocument;
  stages: Array<{ key: WorkStatus; label: string }>;
  money: (n: string | number) => string;
  moving: boolean;
  onMove: (to: WorkStatus) => void;
  onClose: () => void;
}) {
  const full = useQuery({
    queryKey: ["workshop", "job", job.id],
    queryFn: async () => (await documentService.show(job.id)).data,
  });
  const history = useVehicleHistory(job.vehicle_id ?? null);
  const lastVisit = (history.data?.visits ?? []).find((v) => v.status !== "cancelled");
  const call = callLink(job.customer_phone);
  const items = full.data?.items ?? [];

  return (
    <Modal isOpen onClose={onClose} className="max-w-lg p-6">
      <div data-job-sheet className="space-y-4">
        <div>
          <h3 className="font-mono text-lg font-semibold text-gray-800 dark:text-white/90">
            {job.vehicle?.registration ?? job.number}
          </h3>
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            {[job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ") || job.number}
            {job.odometer_in != null ? ` · in at ${job.odometer_in.toLocaleString()} km` : ""}
          </p>
        </div>

        {(job.customer_name || job.customer_phone) && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-white/5">
            <span className="text-theme-sm text-gray-700 dark:text-gray-300">
              {job.customer_name ?? "Customer"}
              {job.customer_phone ? <span className="text-gray-400"> · {job.customer_phone}</span> : null}
            </span>
            {call && (
              <a href={call} className="rounded-lg bg-brand-500 px-3 py-1.5 text-theme-xs font-semibold text-white hover:bg-brand-600">
                Call
              </a>
            )}
          </div>
        )}

        {job.complaint && (
          <div>
            <p className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">In for</p>
            <p className="text-theme-sm text-gray-700 dark:text-gray-300">{job.complaint}</p>
          </div>
        )}

        {job.promised_at && (
          <p className={`text-theme-sm ${isOverdue(job) ? "font-medium text-warning-700 dark:text-warning-400" : "text-gray-500 dark:text-gray-400"}`}>
            {isOverdue(job) ? "Promised " : "Due "}
            {shopShortDateTime(job.promised_at)}
          </p>
        )}

        <div>
          <p className="mb-1 text-theme-xs font-medium uppercase tracking-wide text-gray-400">On the job so far</p>
          {full.isLoading ? (
            <div className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ) : items.length === 0 ? (
            <ListEmpty from={full} what="this job's lines">
              <p className="text-theme-sm text-gray-400">Nothing yet.</p>
            </ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-100 text-theme-sm dark:divide-gray-800">
              {items.map((it) => (
                <li key={it.id} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate text-gray-700 dark:text-gray-300">
                    {it.product_name}{it.variant_name ? ` · ${it.variant_name}` : ""} × {Number(it.quantity)}
                  </span>
                  <span className="tabular-nums text-gray-600 dark:text-gray-400">{money(it.line_total)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 flex justify-between border-t border-gray-200 pt-1 text-theme-sm font-semibold dark:border-gray-700">
            <span className="text-gray-700 dark:text-gray-300">Total</span>
            <span className="tabular-nums text-gray-800 dark:text-white/90">{money(full.data?.total ?? job.total)}</span>
          </p>
        </div>

        {lastVisit && (
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            Last here {shopDate(lastVisit.sold_at)}
            {lastVisit.odometer !== null ? ` at ${lastVisit.odometer.toLocaleString()} km` : ""} · {money(lastVisit.total)}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          {stages.filter((s) => s.key !== job.work_status).map((s) => (
            <Button key={s.key} size="sm" variant="outline" disabled={moving} onClick={() => onMove(s.key)}>
              → {s.label}
            </Button>
          ))}
          <Link
            to={`/tenant/documents/${job.id}`}
            className="ml-auto inline-flex items-center rounded-lg bg-brand-500 px-4 py-2 text-theme-sm font-medium text-white hover:bg-brand-600"
          >
            Open the job card
          </Link>
        </div>
      </div>
    </Modal>
  );
}
