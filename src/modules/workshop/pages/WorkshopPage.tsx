import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import {
  documentService,
  type SaleDocument,
  type WorkStatus,
} from "../../documents/services/documentService";
import Input from "../../../components/form/input/InputField";
import { BookInModal } from "../components/BookInModal";
import { findOnBoard } from "../find";
import { boardWords } from "../words";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useMoney } from "../../shop/hooks/useShop";
import { shopShortDateTime } from "../../../common/format/date";
import type { Vehicle } from "../../vehicles/services/vehiclesService";
import { JobSheet } from "../components/JobSheet";
import { boardTally, callLink, isOverdue } from "../board";
import { BackButton } from "../../../common/ui/BackButton";

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


function promised(job: SaleDocument): string | null {
  if (!job.promised_at) return null;

  return shopShortDateTime(job.promised_at);
}

export default function WorkshopPage() {
  const money = useMoney();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [booking, setBooking] = useState(false);
  // "Take in" on a car's row on Vehicles: the sheet opens with that car on it,
  // read once and dropped from history so Back does not open it again.
  const location = useLocation();
  const navigate = useNavigate();
  const [takingIn, setTakingIn] = useState<Vehicle | null>(null);
  useEffect(() => {
    const sent = (location.state as { takeIn?: Vehicle } | null)?.takeIn;
    if (!sent?.id) return;
    navigate(location.pathname, { replace: true, state: null });
    setTakingIn(sent);
    setBooking(true);
  }, [location.state, location.pathname, navigate]);
  const words = boardWords(usePrimaryBusinessType());
  const STAGES = STAGE_KEYS.map((key, i) => ({
    key,
    label: words.stages[i],
    hint: words.hints[i],
  }));

  /**
   * A BOARD SHOWS THE WHOLE BOARD.
   *
   * This asked for `page: 1` of a paginated list, took `.data`, threw the
   * pagination away, and then bucketed whatever came back into the three
   * columns. The server's default page is 25 and the order is newest-first, so
   * a shop with 26 open jobs lost the OLDEST car — which is precisely the one
   * this board colours amber as overdue. No count, no indicator, no page two: it
   * simply was not there.
   *
   * The sharper failure is the columns. Because the fetch is not per stage, if
   * the 25 newest happen to all be `received`, the Ready column renders
   * "Nothing here." while finished cars sit waiting for collection. The board's
   * whole job is answering "is this car ready?" and it answered "nothing is".
   *
   * A pager would be the wrong fix — page two of a kanban splits the stages
   * arbitrarily. The other boards in this app agree: the kitchen board and the
   * dine-in floor both return unpaginated, because a working surface is not a
   * list you browse. So this drains the pages and assembles the real board.
   *
   * The cap is deliberate and it is LOUD (see `capped` below). A silent cap is
   * how this bug worked in the first place.
   */
  const jobs = useQuery({
    queryKey: ["workshop", "board"],
    queryFn: async () => {
      const PER_PAGE = 100; // the server's own maximum
      const MAX_PAGES = 5;  // 500 open jobs; a safety valve, not a limit anyone should meet

      const first = await documentService.list({
        kind: "job_card", status: "open", page: 1, per_page: PER_PAGE,
      });

      const pages = first.meta?.pagination?.last_page ?? 1;
      const rows = [...first.data];

      for (let page = 2; page <= Math.min(pages, MAX_PAGES); page++) {
        rows.push(...(await documentService.list({
          kind: "job_card", status: "open", page, per_page: PER_PAGE,
        })).data);
      }

      return { rows, missing: pages > MAX_PAGES ? (pages - MAX_PAGES) * PER_PAGE : 0 };
    },
  });

  // The car opened from its card — see JobSheet.
  const [open, setOpen] = useState<SaleDocument | null>(null);

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: WorkStatus }) =>
      documentService.setWorkStatus(id, to),
    onSuccess: () => {
      setOpen(null);
      queryClient.invalidateQueries({ queryKey: ["workshop"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be moved."),
  });

  const [find, setFind] = useState("");
  const rows = jobs.data?.rows ?? [];
  const missing = jobs.data?.missing ?? 0;
  const shown = findOnBoard(rows, find);
  const at = (stage: WorkStatus) => shown.filter((j) => j.work_status === stage);
  const tally = boardTally(rows);

  return (
    <div>
      <PageMeta title={`${words.board}`} description="Work taken in, and what stage each piece is at" />

      <BackButton label="Back" />

      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">{words.board}</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            Every {words.unit} in the shop, and what stage it is at. Tap a {words.tracksVehicle ? "plate" : "number"} to open it.
          </p>
        </div>
        <Button size="sm" onClick={() => setBooking(true)}>{words.takeIn}</Button>
      </div>

      {/* NO SILENT CAPS. If the board genuinely could not fit, it says how many
          it is not showing — because a column reading "Nothing here." when cars
          are waiting is exactly the failure this page was fixed for, and a cap
          that hides itself recreates it at a higher number. */}
      {missing > 0 && (
        <Alert
          variant="warning"
          title={`Showing the first 500 ${words.units}`}
          message={`About ${missing} more are open and not on this board. Close off finished work, or ask for the list by stage.`}
        />
      )}

      {rows.length > 0 && (
        <div className="mb-4 max-w-md">
          <Input aria-label={words.find} placeholder={words.find} value={find} onChange={(e) => setFind(e.target.value)} />
          {find.trim() !== "" && shown.length === 0 && (
            <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
              No {words.unit} in the shop matches “{find.trim()}”.
            </p>
          )}
        </div>
      )}

      {/* The board in four numbers, read before any card — the late ones are
          what the phone calls are about. */}
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-board-tally>
          {STAGES.map((st) => (
            <div key={st.key} className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">
              <p className="text-theme-xs uppercase tracking-wide text-gray-400">{st.label}</p>
              <p className="text-xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{tally[st.key]}</p>
            </div>
          ))}
          <div className={`rounded-xl border px-4 py-3 ${tally.overdue > 0 ? "border-warning-300 bg-warning-50 dark:border-warning-500/40 dark:bg-warning-500/10" : "border-gray-200 dark:border-gray-800"}`}>
            <p className="text-theme-xs uppercase tracking-wide text-gray-400">Late</p>
            <p className={`text-xl font-semibold tabular-nums ${tally.overdue > 0 ? "text-warning-700 dark:text-warning-400" : "text-gray-800 dark:text-white/90"}`}>{tally.overdue}</p>
          </div>
        </div>
      )}

      {jobs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.key} className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <ListEmpty from={jobs} what="the job cards">
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">No {words.units} in the shop.</p>
            <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
              Take one in when it arrives — {words.goesOn.toLowerCase()} go on as you work, and the
              whole job becomes an invoice when the customer collects.
            </p>
            <Button size="sm" className="mt-3" onClick={() => setBooking(true)}>{words.takeIn}</Button>
          </div>
        </ListEmpty>
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

                {/* The column scrolls, the page does not — a work screen keeps
                    its header and its other columns in view. */}
                <div className="space-y-2 md:max-h-[calc(100dvh-20rem)] md:overflow-y-auto md:pr-1">
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
                        <button
                          type="button"
                          onClick={() => setOpen(job)}
                          className="text-left font-semibold text-gray-800 hover:text-brand-500 dark:text-white/90"
                        >
                          {(words.tracksVehicle ? job.vehicle?.registration : null) ?? job.number}
                        </button>
                        <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                          {money(job.total)}
                        </span>
                      </div>

                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {[job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ")}
                        {job.customer_name ? ` · ${job.customer_name}` : ""}
                        {/* "Is my car ready?" is a phone call — the number is on the card. */}
                        {callLink(job.customer_phone) && (
                          <>
                            {" · "}
                            <a href={callLink(job.customer_phone)!} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                              {job.customer_phone}
                            </a>
                          </>
                        )}
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

      {open && (
        <JobSheet
          job={open}
          stages={STAGES}
          money={money}
          moving={move.isPending}
          onMove={(to) => move.mutate({ id: open.id, to })}
          onClose={() => setOpen(null)}
        />
      )}

      {booking && (
        <BookInModal
          vehicle={takingIn}
          onClose={() => { setBooking(false); setTakingIn(null); }}
          onBooked={(number) => {
            toast.success(`Job ${number} opened`);
            setBooking(false);
            setTakingIn(null);
            queryClient.invalidateQueries({ queryKey: ["workshop"] });
          }}
        />
      )}
    </div>
  );
}
