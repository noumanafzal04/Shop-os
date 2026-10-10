import { useEffect, useMemo, useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import RailMenuButton from "../../../layout/RailMenuButton";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useBumpKot, useClearBoard, useKitchenBoard } from "../hooks/useKitchen";
import { KotCardTile, formatAge, urgencyOf } from "../components/KotCard";
import type { BoardView, KotCard } from "../services/kitchenService";
import { FULL_SCREEN_PAGE } from "../../../layout/fullScreenPage";
import { ListEmpty } from "../../../common/ui/ListEmpty";

/** A screen bolted over the grill is the grill screen forever. */
const STATION_KEY = "shopos-kitchen-station";

type LaneKey = "fired" | "preparing" | "ready";

/**
 * The three places a ticket can be, left to right in the order it moves.
 *
 * Each lane owns one colour and keeps it everywhere it appears — its header,
 * its count in the summary, and the button on the card that sends a ticket
 * INTO it. Whole class names, never built from a colour word: Tailwind only
 * ships the classes it can read in the source.
 */
const LANES: Array<{
  key: LaneKey;
  title: string;
  /** What the lane says when it holds nothing. */
  empty: string;
  head: string;
  count: string;
  dot: string;
  tab: string;
}> = [
  {
    key: "fired",
    title: "New",
    empty: "No new tickets",
    head: "bg-blue-light-500 text-white",
    count: "bg-white/25 text-white",
    dot: "bg-blue-light-500",
    tab: "border-blue-light-500 text-blue-light-600 dark:text-blue-light-500",
  },
  {
    key: "preparing",
    title: "Cooking",
    empty: "Nothing on the stove",
    head: "bg-warning-500 text-gray-900",
    count: "bg-black/15 text-gray-900",
    dot: "bg-warning-500",
    tab: "border-warning-500 text-warning-700 dark:text-warning-400",
  },
  {
    key: "ready",
    title: "Ready",
    empty: "The pass is clear",
    head: "bg-success-600 text-white",
    count: "bg-white/25 text-white",
    dot: "bg-success-600",
    tab: "border-success-600 text-success-700 dark:text-success-500",
  },
];

/** "1 Oct, 9:15 PM" — when the oldest leftover was sent, on the reader's own clock. */
function whenWasIt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const tickets = (n: number) => `${n} ${n === 1 ? "ticket" : "tickets"}`;

/**
 * The kitchen display.
 *
 * This is not an admin page that happens to show kitchen data — it is a board
 * on a wall, read from two metres away by someone holding a pan. Everything
 * follows from that: one large action per card, nothing that needs a hover,
 * and type sized for distance rather than density.
 *
 * It shows no money at all. A cook decides nothing from a price, and a total on
 * the kitchen wall is a bill left on the wrong side of the shop.
 *
 * ── What changed, and why ────────────────────────────────────────────
 *
 *     "bht old data b kitchen main show ho raha … close all on single click"
 *
 * It was one undivided grid of everything nobody had bumped, ever. So:
 *
 *   THREE LANES. New, Cooking, Ready — a ticket's place on the board now says
 *   what stage it is at, where before every card had to be read to find out.
 *   Each lane keeps its own queue oldest-first.
 *
 *   THIS SERVICE ONLY. What an earlier one left behind is counted in a strip
 *   at the top, with a way to look at it and a way to clear it — instead of
 *   leading tonight's queue.
 *
 *   ONE PRESS TO CLEAR. The leftovers, or the whole board at close.
 */
export default function KitchenPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [station, setStation] = useState<string>(() => localStorage.getItem(STATION_KEY) ?? "");
  const [view, setView] = useState<BoardView>("board");
  /** Below `lg` one lane is shown at a time, and this is which. */
  const [lane, setLane] = useState<LaneKey>("fired");

  const board = useKitchenBoard(view);
  const bump = useBumpKot(view);
  const clear = useClearBoard();

  useEffect(() => {
    if (station) localStorage.setItem(STATION_KEY, station);
    else localStorage.removeItem(STATION_KEY);
  }, [station]);

  // Ages arrive computed against the server's clock. Carry them forward
  // locally every second so the numbers move between polls — a frozen timer on
  // a kitchen wall reads as a frozen screen, and someone goes looking for the
  // manager instead of the food.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  const elapsed = useMemo(
    () => (board.dataUpdatedAt ? Math.max(0, Math.floor((now - board.dataUpdatedAt) / 1000)) : 0),
    [now, board.dataUpdatedAt],
  );

  const all = useMemo(() => board.data?.kots ?? [], [board.data]);
  const stations = board.data?.stations ?? [];
  const older = board.data?.older ?? { count: 0, oldest_fired_at: null };

  // A station that is no longer on the board must not leave the screen
  // filtered to nothing. The saved choice is kept — the grill's screen is
  // still the grill's when its next ticket arrives — it is only not applied.
  const activeStation = station !== "" && stations.includes(station) ? station : "";
  const shown = useMemo(
    () => (activeStation === "" ? all : all.filter((k) => k.station === activeStation)),
    [all, activeStation],
  );

  const ageOf = (k: KotCard) => k.age_seconds + elapsed;
  const inLane = (key: LaneKey) => shown.filter((k) => k.status === key);
  const served = shown.filter((k) => k.status === "served");
  const working = shown.filter((k) => k.status !== "served");
  const countAt = (s: string) => all.filter((k) => k.status !== "served" && (s === "" || k.station === s)).length;

  // The one number worth a glance from across the kitchen: how long the
  // ticket that has waited longest has waited.
  const longest = working.reduce((max, k) => Math.max(max, ageOf(k)), 0);
  const longestIsLate = working.some((k) => urgencyOf(ageOf(k), k.status) === "late");

  const doBump = (id: string, status: "preparing" | "ready" | "served") => {
    bump.mutate(
      { id, status },
      {
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.message : "Couldn't update that ticket."),
      },
    );
  };

  const clearOlder = async () => {
    const ok = await confirm({
      title: `Clear ${tickets(older.count)} left from before today?`,
      message:
        "They come off the kitchen board and are marked as cleared — not as served. "
        + "The tabs they belong to stay open on the floor for you to settle or cancel.",
      confirmLabel: `Clear ${tickets(older.count)}`,
      tone: "danger",
    });
    if (!ok) return;
    clear.mutate(
      { scope: "older" },
      {
        onSuccess: (res) => {
          toast.success(res.message ?? "Cleared.");
          setView("board");
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't clear those tickets."),
      },
    );
  };

  const clearBoard = async () => {
    const n = working.length;
    const where = activeStation === "" ? "the board" : `the ${activeStation} board`;
    const ok = await confirm({
      title: `Clear all ${tickets(n)} off ${where}?`,
      message:
        "For the end of service, when everything has gone out. They are marked as cleared — "
        + "not as served — and this cannot be undone.",
      confirmLabel: `Clear ${tickets(n)}`,
      tone: "danger",
    });
    if (!ok) return;
    clear.mutate(
      { scope: "board", station: activeStation || undefined },
      {
        onSuccess: (res) => toast.success(res.message ?? "Cleared."),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't clear the board."),
      },
    );
  };

  const chip = (active: boolean) =>
    `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-theme-sm font-semibold transition ${
      active
        ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
        : "bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/10"
    }`;

  const card = (kot: KotCard) => (
    <KotCardTile
      key={kot.id}
      kot={kot}
      ageSeconds={ageOf(kot)}
      busy={bump.isPending}
      onBump={(status) => doBump(kot.id, status)}
    />
  );

  const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

  return (
    <div className={`flex ${FULL_SCREEN_PAGE} flex-col bg-gray-100 dark:bg-gray-950`}>
      <PageMeta title="Kitchen" description="Kitchen display" />

      <header className="shrink-0 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <RailMenuButton />
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight text-gray-900 dark:text-white">Kitchen</h1>
              <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
                {view === "older"
                  ? "Left from an earlier service"
                  : view === "served"
                    ? "Sent out this service"
                    : working.length === 0
                      ? "Nothing waiting"
                      : `${tickets(working.length)} on the board`}
                {/* Below `lg` the lane tabs carry the counts, so the summary
                    row is not drawn a second time above them — and the one
                    figure the tabs do not carry rides here instead. */}
                {view === "board" && working.length > 0 && (
                  <span className={`lg:hidden ${longestIsLate ? "font-semibold text-error-600 dark:text-error-400" : ""}`}>
                    {" "}· longest {formatAge(longest)}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* What the board holds, lane by lane, in the lanes' own colours. A
              count from across the room — no card needs reading to get it. */}
          {view === "board" && (
            <dl className="hidden flex-wrap items-center gap-2 lg:flex">
              {LANES.map((l) => (
                <div
                  key={l.key}
                  className="flex min-h-11 items-center gap-2 rounded-xl bg-gray-50 px-3 ring-1 ring-inset ring-gray-200 dark:bg-white/5 dark:ring-gray-700"
                >
                  <span className={`size-2.5 rounded-full ${l.dot}`} aria-hidden />
                  <dt className="text-theme-sm font-medium text-gray-600 dark:text-gray-300">{l.title}</dt>
                  <dd className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{inLane(l.key).length}</dd>
                </div>
              ))}
              {working.length > 0 && (
                <div
                  className={`flex min-h-11 items-center gap-2 rounded-xl px-3 ring-1 ring-inset ${
                    longestIsLate
                      ? "bg-error-50 text-error-700 ring-error-200 dark:bg-error-500/10 dark:text-error-400 dark:ring-error-500/30"
                      : "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700"
                  }`}
                >
                  <dt className="text-theme-sm font-medium">Longest wait</dt>
                  <dd className="text-lg font-bold tabular-nums">{formatAge(longest)}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {view === "board" ? (
              <>
                <button
                  type="button"
                  className={chip(false)}
                  onClick={() => setView("served")}
                  title="Show what has already gone out this service"
                >
                  Served
                </button>
                {/* Only when there is something to clear: a "Clear board" on an
                    empty board is a button that says it will do nothing. */}
                {working.length > 0 && (
                  <button
                    type="button"
                    onClick={clearBoard}
                    disabled={clear.isPending}
                    className="inline-flex min-h-11 items-center rounded-xl px-4 text-theme-sm font-semibold text-error-600 ring-1 ring-inset ring-error-200 transition hover:bg-error-50 disabled:opacity-50 dark:text-error-400 dark:ring-error-500/40 dark:hover:bg-error-500/10"
                  >
                    Clear board
                  </button>
                )}
              </>
            ) : (
              <button type="button" className={chip(true)} onClick={() => setView("board")}>
                ‹ Back to the board
              </button>
            )}
          </div>
        </div>

        {stations.length > 0 && view !== "older" && (
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
            <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Station</span>
            {["", ...stations].map((s) => (
              <button
                key={s || "__all"}
                type="button"
                aria-pressed={activeStation === s}
                // Said whole. Read from its text the name ran together as
                // "Grill2", which is not a thing anybody can ask for by voice.
                aria-label={`${s === "" ? "All stations" : s}, ${tickets(countAt(s))}`}
                className={chip(activeStation === s)}
                onClick={() => setStation(s)}
              >
                {s === "" ? "All" : s}
                <span
                  className={`rounded-md px-1.5 text-theme-xs font-bold tabular-nums ${
                    activeStation === s ? "bg-white/20 dark:bg-black/10" : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
                  }`}
                >
                  {countAt(s)}
                </span>
              </button>
            ))}
          </div>
        )}
      </header>

      {/* WHAT AN EARLIER SERVICE LEFT. Said once, at the top, with both things
          somebody can do about it — never mixed into tonight's queue. */}
      {view === "board" && older.count > 0 && (
        <div
          data-testid="kitchen-older"
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-warning-200 bg-warning-50 px-4 py-2.5 dark:border-warning-500/30 dark:bg-warning-500/10"
        >
          <p className="text-theme-sm text-warning-800 dark:text-warning-300">
            <span className="font-bold">{tickets(older.count)}</span>
            {older.count === 1 ? " is" : " are"} left from before today's service
            {whenWasIt(older.oldest_fired_at) ? ` — the oldest sent ${whenWasIt(older.oldest_fired_at)}` : ""}.
            {" "}Not shown below.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("older")}
              className="inline-flex min-h-11 items-center rounded-xl px-4 text-theme-sm font-semibold text-warning-800 ring-1 ring-inset ring-warning-300 transition hover:bg-warning-100 dark:text-warning-300 dark:ring-warning-500/40 dark:hover:bg-warning-500/15"
            >
              Show them
            </button>
            <button
              type="button"
              onClick={clearOlder}
              disabled={clear.isPending}
              className="inline-flex min-h-11 items-center rounded-xl bg-warning-600 px-4 text-theme-sm font-bold text-white transition hover:bg-warning-700 disabled:opacity-50"
            >
              {clear.isPending ? "Clearing…" : `Clear ${older.count === 1 ? "it" : `all ${older.count}`}`}
            </button>
          </div>
        </div>
      )}

      {view === "older" && shown.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-warning-200 bg-warning-50 px-4 py-2.5 dark:border-warning-500/30 dark:bg-warning-500/10">
          <p className="text-theme-sm text-warning-800 dark:text-warning-300">
            <span className="font-bold">{tickets(shown.length)}</span> still open from before today's service. Serve the
            ones that really went out, or clear the lot.
          </p>
          <button
            type="button"
            onClick={clearOlder}
            disabled={clear.isPending}
            className="inline-flex min-h-11 items-center rounded-xl bg-warning-600 px-4 text-theme-sm font-bold text-white transition hover:bg-warning-700 disabled:opacity-50"
          >
            {clear.isPending ? "Clearing…" : `Clear all ${shown.length}`}
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        {board.isLoading ? (
          <div className={`${GRID} p-4`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : board.isError ? (
          <p className="py-20 text-center text-lg text-error-500">
            Can't reach the kitchen board. It will retry on its own.
          </p>
        ) : view !== "board" ? (
          // The two side piles are plain grids: nothing in them moves between
          // stages, so there are no lanes for them to be in.
          <div className="h-full overflow-y-auto p-4">
            {(view === "served" ? served : shown).length === 0 ? (
              <div className="py-24 text-center">
                <p className="text-2xl font-bold text-gray-800 dark:text-white/90">
                  {view === "served" ? "Nothing sent out yet" : "Nothing left over"}
                </p>
                <p className="mt-2 text-lg text-gray-500 dark:text-gray-400">
                  {view === "served"
                    ? "Tickets you mark as served this service are listed here."
                    : "Every ticket on the board is from this service."}
                </p>
              </div>
            ) : (
              <div className={GRID}>{(view === "served" ? served : shown).map(card)}</div>
            )}
          </div>
        ) : working.length === 0 ? (
          // Not an error state — an empty pass is the goal.
          <ListEmpty from={board} what="the kitchen board">
            <div className="flex h-full flex-col items-center justify-center px-6 py-24 text-center">
              <span className="flex size-20 items-center justify-center rounded-full bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <p className="mt-5 text-3xl font-bold text-gray-800 dark:text-white/90">Nothing waiting</p>
              <p className="mt-2 text-lg text-gray-500 dark:text-gray-400">
                {activeStation === "" ? "Every order is out." : `Nothing for ${activeStation} right now.`}
              </p>
            </div>
          </ListEmpty>
        ) : (
          <>
            {/* Below `lg` there is no room for three queues side by side, so
                the lanes become tabs — each still in its own colour, each
                still saying how many it holds. */}
            <div role="tablist" aria-label="Stage" className="sticky top-0 z-10 flex gap-1 border-b border-gray-200 bg-white px-2 pt-2 lg:hidden dark:border-gray-800 dark:bg-gray-900">
              {LANES.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  role="tab"
                  aria-selected={lane === l.key}
                  aria-label={`${l.title}, ${tickets(inLane(l.key).length)}`}
                  onClick={() => setLane(l.key)}
                  className={`flex min-h-11 flex-1 items-center justify-center gap-2 border-b-[3px] px-2 text-theme-sm font-bold transition ${
                    lane === l.key ? l.tab : "border-transparent text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {l.title}
                  <span className="rounded-md bg-gray-100 px-1.5 text-theme-xs tabular-nums text-gray-600 dark:bg-white/10 dark:text-gray-300">
                    {inLane(l.key).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 lg:h-full lg:grid-cols-3">
              {LANES.map((l) => {
                const cards = inLane(l.key);

                return (
                  <section
                    key={l.key}
                    aria-label={`${l.title} — ${tickets(cards.length)}`}
                    className={`min-h-0 flex-col overflow-hidden rounded-2xl bg-gray-200/60 dark:bg-white/[0.04] lg:flex ${
                      lane === l.key ? "flex" : "hidden"
                    }`}
                  >
                    <h2 className={`hidden shrink-0 items-center justify-between px-4 py-2.5 text-base font-bold uppercase tracking-wide lg:flex ${l.head}`}>
                      {l.title}
                      <span className={`rounded-lg px-2 py-0.5 text-base tabular-nums ${l.count}`}>{cards.length}</span>
                    </h2>
                    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-1 lg:overflow-y-auto">
                      {cards.length === 0 ? (
                        <p className="col-span-full rounded-xl border-2 border-dashed border-gray-300 px-4 py-10 text-center text-theme-sm font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500">
                          {l.empty}
                        </p>
                      ) : (
                        cards.map(card)
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
