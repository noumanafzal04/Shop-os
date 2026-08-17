import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import {
  documentService,
  type SaleDocument,
  type WorkStatus,
} from "../../documents/services/documentService";
import { BookInModal } from "../components/BookInModal";
import { boardWords } from "../words";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";

/**
 * What is in the shop right now.
 *
 * ── The whiteboard, on a screen ─────────────────────────────────────────
 *
 * Every workshop already has this board; it is drawn in marker on a wall. The
 * only question worth asking of a software version is whether it answers the
 * thing that wall answers twenty times a day: *is my car ready?* — asked on the
 * phone, at the counter, by somebody who has been waiting since Tuesday.
 *
 * So it is three columns and nothing else. Not a kanban with swimlanes and
 * filters. A board that takes longer to read than the wall does is a board that
 * loses to the wall.
 *
 * ── Why it is grouped by WORK status and not by document status ─────────
 *
 * `status` says whether the paperwork is live. This board is about where the
 * CAR is, which is a different question about the same row — a job can be ready
 * for collection and still unpaid. Grouping by the wrong one would show an
 * owner a board of documents rather than a board of cars.
 *
 * ── Cars go backwards ───────────────────────────────────────────────────
 *
 * A job marked ready fails its road test and goes back on the ramp. Every stage
 * is reachable from every other, deliberately: software that refuses that
 * teaches a workshop to keep the real state on the wall after all.
 */

/**
 * Stage keys are fixed; the words are the trade's. A laundry does not put
 * shirts "in the bay" — see `../words`.
 */
const STAGE_KEYS: WorkStatus[] = ["received", "in_progress", "ready"];

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/** Overdue is the one thing on this board worth a colour. */
function isOverdue(job: SaleDocument): boolean {
  return job.promised_at !== null && job.promised_at !== undefined
    && new Date(job.promised_at) < new Date();
}

function promised(job: SaleDocument): string | null {
  if (!job.promised_at) return null;
  const at = new Date(job.promised_at);

  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    + " " + at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function WorkshopPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [booking, setBooking] = useState(false);
  const words = boardWords(usePrimaryBusinessType());
  const STAGES = STAGE_KEYS.map((key, i) => ({
    key,
    label: words.stages[i],
    hint: words.hints[i],
  }));

  const jobs = useQuery({
    queryKey: ["workshop", "board"],
    queryFn: async () =>
      (await documentService.list({ kind: "job_card", status: "open", page: 1 })).data,
  });

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: WorkStatus }) =>
      documentService.setWorkStatus(id, to),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workshop"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be moved."),
  });

  const rows = jobs.data ?? [];
  const at = (stage: WorkStatus) => rows.filter((j) => j.work_status === stage);

  return (
    <div>
      <PageMeta title={`${words.board} | ShopOS`} description="Work taken in, and what stage each piece is at" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white/90">{words.board}</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            Every {words.unit} in the shop, and what stage it is at. Tap a card to move it.
          </p>
        </div>
        <Button size="sm" onClick={() => setBooking(true)}>{words.takeIn}</Button>
      </div>

      {jobs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.key} className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No {words.units} in the shop.</p>
          <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
            Take one in when it arrives — the parts and labour go on as you work, and the whole
            job becomes an invoice when the customer collects.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setBooking(true)}>{words.takeIn}</Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {STAGES.map((stage) => {
            const cars = at(stage.key);

            return (
              <div key={stage.key} className="rounded-2xl border border-gray-200 p-3 dark:border-gray-800">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    {stage.label}{" "}
                    <span className="text-theme-xs font-normal text-gray-400">({cars.length})</span>
                  </h2>
                  <span className="text-theme-xs text-gray-400">{stage.hint}</span>
                </div>

                <div className="space-y-2">
                  {cars.length === 0 && (
                    <p className="py-6 text-center text-theme-xs text-gray-400">Nothing here.</p>
                  )}

                  {cars.map((job) => (
                    <div
                      key={job.id}
                      className={`rounded-xl border p-3 ${
                        isOverdue(job)
                          ? "border-warning-300 bg-warning-50 dark:border-warning-500/40 dark:bg-warning-500/10"
                          : "border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          to={`/tenant/documents/${job.id}`}
                          className="font-semibold text-gray-800 hover:text-brand-500 dark:text-white/90"
                        >
                          {(words.tracksVehicle ? job.vehicle?.registration : null) ?? job.number}
                        </Link>
                        <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                          {money(job.total)}
                        </span>
                      </div>

                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {[job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ")}
                        {job.customer_name ? ` · ${job.customer_name}` : ""}
                      </p>

                      {/* What the customer said is wrong. The first thing a
                          mechanic reads, so it is on the card and not behind a
                          click. */}
                      {job.complaint && (
                        <p className="mt-1 line-clamp-2 text-theme-xs text-gray-600 dark:text-gray-300">
                          {job.complaint}
                        </p>
                      )}

                      {promised(job) !== null && (
                        <p
                          className={`mt-1 text-theme-xs ${
                            isOverdue(job)
                              ? "font-medium text-warning-700 dark:text-warning-400"
                              : "text-gray-400"
                          }`}
                        >
                          {isOverdue(job) ? "Promised " : "Due "}
                          {promised(job)}
                        </p>
                      )}

                      {/* Every other stage, reachable from here. Cars go
                          backwards — a job marked ready fails its road test. */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {STAGES.filter((s) => s.key !== stage.key).map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            disabled={move.isPending}
                            onClick={() => move.mutate({ id: job.id, to: s.key })}
                            className="rounded-lg border border-gray-300 px-2 py-1 text-theme-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                          >
                            → {s.label}
                          </button>
                        ))}
                        <Link
                          to={`/tenant/documents/${job.id}`}
                          className="rounded-lg border border-brand-300 px-2 py-1 text-theme-xs text-brand-600 hover:bg-brand-50 dark:border-brand-500/40 dark:text-brand-400"
                        >
                          Bill it
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {booking && (
        <BookInModal
          onClose={() => setBooking(false)}
          onBooked={(number) => {
            toast.success(`Job ${number} opened`);
            setBooking(false);
            queryClient.invalidateQueries({ queryKey: ["workshop"] });
          }}
        />
      )}
    </div>
  );
}
