import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import { ChevronLeftIcon } from "../../../icons";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useBumpKot, useKitchenBoard } from "../hooks/useKitchen";
import { KotCardTile } from "../components/KotCard";
import { FULL_SCREEN_PAGE } from "../../../layout/fullScreenPage";

/** A screen bolted over the grill is the grill screen forever. */
const STATION_KEY = "shopos-kitchen-station";

/**
 * The kitchen display.
 *
 * This is not an admin page that happens to show kitchen data — it is a board
 * on a wall, read from two metres away by someone holding a pan. Everything
 * follows from that: no sidebar, no hover-only anything, one large action per
 * card, and type sized for distance rather than density.
 *
 * It shows no money at all. A cook decides nothing from a price, and a total on
 * the kitchen wall is a bill left on the wrong side of the shop.
 */
export default function KitchenPage() {
  const toast = useToast();
  const [station, setStation] = useState<string>(() => localStorage.getItem(STATION_KEY) ?? "");
  const [includeServed, setIncludeServed] = useState(false);

  const params = { station: station || undefined, includeServed };
  const board = useKitchenBoard(params);
  const queryKey = ["kitchen", "board", station || "all", includeServed] as const;
  const bump = useBumpKot(queryKey);

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
  const kots = board.data?.kots ?? [];
  const stations = board.data?.stations ?? [];

  const doBump = (id: string, status: "preparing" | "ready" | "served") => {
    bump.mutate(
      { id, status },
      {
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.message : "Couldn't update that ticket."),
      },
    );
  };

  const tabClass = (active: boolean) =>
    `rounded-xl px-4 py-2 text-theme-sm font-semibold transition ${
      active
        ? "bg-brand-500 text-white"
        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
    }`;

  return (
    <div className={`flex ${FULL_SCREEN_PAGE} flex-col bg-gray-50 dark:bg-gray-950`}>
      <PageMeta title="Kitchen | CartZe" description="Kitchen display" />

      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center gap-3">
          <Link
            to="/tenant"
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-theme-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <ChevronLeftIcon className="h-4 w-4" /> Exit
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Kitchen</h1>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-theme-sm font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
            {kots.length} on the board
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {stations.length > 0 && (
            <>
              <button type="button" className={tabClass(station === "")} onClick={() => setStation("")}>
                All
              </button>
              {stations.map((s) => (
                <button key={s} type="button" className={tabClass(station === s)} onClick={() => setStation(s)}>
                  {s}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            className={tabClass(includeServed)}
            onClick={() => setIncludeServed((v) => !v)}
            title="Show what has already gone out today"
          >
            Served
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {board.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : board.isError ? (
          <p className="py-20 text-center text-lg text-error-500">
            Can't reach the kitchen board. It will retry on its own.
          </p>
        ) : kots.length === 0 ? (
          // Not an error state — an empty pass is the goal.
          <div className="py-24 text-center">
            <p className="text-3xl font-bold text-gray-800 dark:text-white/90">Nothing waiting</p>
            <p className="mt-2 text-lg text-gray-500 dark:text-gray-400">Every order is out.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {kots.map((kot) => (
              <KotCardTile
                key={kot.id}
                kot={kot}
                ageSeconds={kot.age_seconds + elapsed}
                busy={bump.isPending}
                onBump={(status) => doBump(kot.id, status)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
