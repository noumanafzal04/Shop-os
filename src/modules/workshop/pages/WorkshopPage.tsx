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
import { boardWords, type BoardWords } from "../words";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useMoney } from "../../shop/hooks/useShop";
import { shopShortDateTime } from "../../../common/format/date";
import type { Vehicle } from "../../vehicles/services/vehiclesService";
import { JobSheet } from "../components/JobSheet";
import { boardTally, callLink, cardMoves, isLate } from "../board";
import { PlusIcon, TimeIcon } from "../../../icons";

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

/**
 * One colour per stage, the same on the switch, the column and its count —
 * and on the button that moves a card INTO that stage, so "Start work" and
 * "Mark ready" never look alike (the user, 2026-10-27).
 */
const TONE: Record<WorkStatus, { dot: string; badge: string; press: string }> = {
  received: {
    dot: "bg-blue-light-500",
    badge: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400",
    press: "bg-blue-light-600 hover:bg-blue-light-700",
  },
  in_progress: {
    dot: "bg-brand-500",
    badge: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
    press: "bg-brand-500 hover:bg-brand-600",
  },
  ready: {
    dot: "bg-success-500",
    badge: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
    press: "bg-success-600 hover:bg-success-700",
  },
};

type Stage = { key: WorkStatus; label: string; hint: string };

/** What the shop calls this piece of work: the plate on a car, the slip number otherwise. */
function nameOf(job: SaleDocument, tracksVehicle = true): string {
  return (tracksVehicle ? job.vehicle?.registration : null) ?? job.number;
}

/**
 * ONE CARD, ONE OBVIOUS NEXT PRESS.
 *
 * The card answers the counter's question first — whose, what is wrong, when
 * it was promised — and then offers the next step as the one big button:
 * start the work, mark it ready, or (when ready) bill it. The step back is a
 * quiet link beside it; anything further is in the job's sheet.
 */
function JobCard({
  job,
  words,
  stages,
  money,
  moving,
  onOpen,
  onMove,
}: {
  job: SaleDocument;
  words: BoardWords;
  stages: Stage[];
  money: (n: string | number) => string;
  moving: boolean;
  onOpen: () => void;
  onMove: (to: WorkStatus) => void;
}) {
  const stage = job.work_status ?? "received";
  const { next, back } = cardMoves(stage);
  const late = isLate(job);
  const call = callLink(job.customer_phone);
  const label = (key: WorkStatus) => stages.find((s) => s.key === key)?.label ?? key;
  const vehicle = [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ");

  return (
    <div
      className={`rounded-xl border bg-white p-3 shadow-theme-xs dark:bg-gray-900 ${
        late ? "border-warning-300 dark:border-warning-500/40" : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className={`text-left font-semibold text-gray-800 hover:text-brand-600 dark:text-white/90 dark:hover:text-brand-400 ${
            words.tracksVehicle && job.vehicle?.registration
              ? "rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 font-mono tracking-wide dark:border-gray-700 dark:bg-white/5"
              : ""
          }`}
        >
          {nameOf(job, words.tracksVehicle)}
        </button>
        <span className="pt-0.5 text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
          {money(job.total)}
        </span>
      </div>

      {(vehicle || job.customer_name || call) && (
        <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
          {vehicle}
          {vehicle && job.customer_name ? " · " : ""}
          {job.customer_name}
          {/* "Is my car ready?" is a phone call — the number is on the card. */}
          {call && (
            <>
              {vehicle || job.customer_name ? " · " : ""}
              <a href={call} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                {job.customer_phone}
              </a>
            </>
          )}
        </p>
      )}

      {/* What the customer said is wrong. The first thing a mechanic reads,
          so it is on the card and not behind a click. */}
      {job.complaint && (
        <p className="mt-2 line-clamp-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-theme-xs text-gray-700 dark:bg-white/5 dark:text-gray-300">
          {job.complaint}
        </p>
      )}

      {job.promised_at && (
        <p
          className={`mt-2 inline-flex items-center gap-1 text-theme-xs ${
            late
              ? "rounded-full bg-warning-50 px-2 py-0.5 font-medium text-warning-700 dark:bg-warning-500/10 dark:text-warning-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          <TimeIcon aria-hidden className="size-3.5" />
          {late ? "Late · was due " : "Due "}
          {shopShortDateTime(job.promised_at)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {next ? (
          <button
            type="button"
            disabled={moving}
            onClick={() => onMove(next)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-theme-sm font-medium text-white disabled:opacity-50 ${TONE[next].press}`}
          >
            {words.moveOn[stage === "received" ? 0 : 1]}
            <span aria-hidden>→</span>
          </button>
        ) : (
          <Link
            to={`/tenant/documents/${job.id}`}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-orange-600 px-3 py-2 text-theme-sm font-medium text-white hover:bg-orange-700"
          >
            Bill it
          </Link>
        )}
        {back && (
          <button
            type="button"
            disabled={moving}
            onClick={() => onMove(back)}
            className="text-theme-xs text-gray-500 hover:text-gray-800 hover:underline disabled:opacity-50 dark:text-gray-400 dark:hover:text-white/90"
          >
            <span aria-hidden>↩ </span>Back to {label(back)}
          </button>
        )}
      </div>
    </div>
  );
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
  const STAGES: Stage[] = STAGE_KEYS.map((key, i) => ({
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
    mutationFn: ({ id, to }: { id: string; to: WorkStatus; name: string }) =>
      documentService.setWorkStatus(id, to),
    onSuccess: (_, { to, name }) => {
      setOpen(null);
      // On a phone the card leaves the column on screen, so say where it went.
      toast.success(`${name} moved to ${STAGES.find((s) => s.key === to)?.label ?? to}`);
      queryClient.invalidateQueries({ queryKey: ["workshop"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be moved."),
  });

  const [find, setFind] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [tab, setTab] = useState<WorkStatus | null>(null);
  const rows = jobs.data?.rows ?? [];
  const missing = jobs.data?.missing ?? 0;
  const tally = boardTally(rows);
  // Once nothing is late the switch is gone, so its filter goes with it.
  const lateFilter = lateOnly && tally.overdue > 0;
  const shown = findOnBoard(rows, find).filter((j) => !lateFilter || isLate(j));
  const at = (stage: WorkStatus) => shown.filter((j) => j.work_status === stage);
  // The stage a phone shows: the one picked, else the first with work in it.
  const showing = tab ?? STAGE_KEYS.find((k) => at(k).length > 0) ?? "received";

  return (
    <div>
      <PageMeta title={`${words.board}`} description="Work taken in, and what stage each piece is at" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">{words.board}</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            Every {words.unit} in the shop, and what stage it is at. Tap a {words.tracksVehicle ? "plate" : "number"} to see the whole job.
          </p>
        </div>
        <Button onClick={() => setBooking(true)} startIcon={<PlusIcon className="size-4" />}>{words.takeIn}</Button>
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
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="w-full max-w-md">
            <Input aria-label={words.find} placeholder={words.find} value={find} onChange={(e) => setFind(e.target.value)} />
            {find.trim() !== "" && shown.length === 0 && (
              <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                No {words.unit} {lateFilter ? "that is late " : ""}matches “{find.trim()}”.
              </p>
            )}
          </div>
          {/* The late ones are what the phone calls are about: one press shows
              only them. */}
          {tally.overdue > 0 && (
            <button
              type="button"
              aria-pressed={lateFilter}
              onClick={() => setLateOnly((v) => !v)}
              className={`h-11 rounded-lg border px-4 text-theme-sm font-medium ${
                lateFilter
                  ? "border-warning-500 bg-warning-500 text-white hover:bg-warning-600"
                  : "border-warning-300 bg-warning-50 text-warning-700 hover:bg-warning-100 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400"
              }`}
            >
              {lateFilter ? `Show all ${words.units}` : `${tally.overdue} late — show only these`}
            </button>
          )}
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
            <p className="font-medium text-gray-700 dark:text-gray-300">No {words.units} in the shop.</p>
            <p className="mx-auto mt-1 max-w-md text-theme-sm text-gray-500 dark:text-gray-400">
              Take one in when it arrives. {words.goesOn} go on as you work, and the
              whole job becomes a bill when the customer collects.
            </p>
            <Button className="mt-4" onClick={() => setBooking(true)} startIcon={<PlusIcon className="size-4" />}>{words.takeIn}</Button>
          </div>
        </ListEmpty>
      ) : (
        <>
          {/* A phone has room for one column: the stages become a switch, each
              with its count, and the board shows the one picked. */}
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 md:hidden dark:bg-white/5">
            {STAGES.map((st) => (
              <button
                key={st.key}
                type="button"
                aria-pressed={showing === st.key}
                onClick={() => setTab(st.key)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-theme-xs font-medium ${
                  showing === st.key
                    ? "bg-white text-gray-800 shadow-theme-xs dark:bg-gray-800 dark:text-white/90"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE[st.key].dot}`} />
                {st.label}
                <span className="tabular-nums">{at(st.key).length}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {STAGES.map((stage) => {
              const cars = at(stage.key);

              return (
                <div
                  key={stage.key}
                  className={`${showing === stage.key ? "block" : "hidden"} rounded-2xl border border-gray-200 bg-gray-50 p-3 md:block dark:border-gray-800 dark:bg-white/[0.02]`}
                >
                  <div className="mb-3 px-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 font-semibold text-gray-800 dark:text-white/90">
                        <span aria-hidden className={`size-2.5 rounded-full ${TONE[stage.key].dot}`} />
                        {stage.label}
                      </h2>
                      <span className={`rounded-full px-2.5 py-0.5 text-theme-xs font-semibold tabular-nums ${TONE[stage.key].badge}`}>
                        {cars.length}
                      </span>
                    </div>
                    <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{stage.hint}</p>
                  </div>

                  {/* The column scrolls, the page does not — a work screen keeps
                      its header and its other columns in view. */}
                  <div className="space-y-2.5 md:max-h-[calc(100dvh-19rem)] md:overflow-y-auto md:pr-1">
                    {cars.length === 0 && (
                      <p className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-theme-xs text-gray-400 dark:border-gray-700">
                        Nothing here.
                      </p>
                    )}

                    {cars.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        words={words}
                        stages={STAGES}
                        money={money}
                        moving={move.isPending}
                        onOpen={() => setOpen(job)}
                        onMove={(to) => move.mutate({ id: job.id, to, name: nameOf(job, words.tracksVehicle) })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {open && (
        <JobSheet
          job={open}
          stages={STAGES}
          money={money}
          moving={move.isPending}
          onMove={(to) => move.mutate({ id: open.id, to, name: nameOf(open, words.tracksVehicle) })}
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
