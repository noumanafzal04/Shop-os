import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import RailMenuButton from "../../../layout/RailMenuButton";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useFloor, useDineInMutations } from "../hooks/useDineIn";
import type { FloorTab, FloorTable } from "../services/dineInService";
import { STATE_LABEL, sinceLabel, stateOf, summarise, type TableState } from "../floorState";
import { useMayWorkTable } from "../ownership";
import { useAuthStore } from "../../../stores/authStore";
import { useMoney } from "../../shop/hooks/useShop";
import WaiterReportModal from "../components/WaiterReportModal";
import { FULL_SCREEN_PAGE_MIN } from "../../../layout/fullScreenPage";
import { ListEmpty } from "../../../common/ui/ListEmpty";

/** A blank area is one section ("the floor"), not a section named "". */
const areaOf = (t: FloorTable): string | null => t.area?.trim() || null;

/**
 * What a tile looks like in each state. Whole class names — Tailwind ships
 * only what it can read in the source.
 *
 * COLOUR SAYS WHAT THE TABLE NEEDS. It used to say whose the table was (brand
 * for mine, grey for anybody else's), which answered a question a waiter
 * already knows the answer to and left the one they walk the room for —
 * "which of these needs me?" — to be found by opening each tab. Whose it is
 * is still on the tile, in words.
 */
const TILE: Record<TableState, { frame: string; pill: string; amount: string }> = {
  free: {
    frame: "border-gray-200 bg-white hover:border-success-400 dark:border-gray-800 dark:bg-white/[0.03]",
    pill: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
    amount: "",
  },
  seated: {
    frame: "border-blue-light-200 bg-blue-light-50 hover:border-blue-light-400 dark:border-blue-light-500/30 dark:bg-blue-light-500/10",
    pill: "bg-blue-light-500 text-white",
    amount: "text-gray-900 dark:text-white",
  },
  unsent: {
    frame: "border-warning-300 bg-warning-50 hover:border-warning-500 dark:border-warning-500/40 dark:bg-warning-500/10",
    pill: "bg-warning-500 text-gray-900",
    amount: "text-gray-900 dark:text-white",
  },
  cooking: {
    frame: "border-orange-200 bg-orange-50 hover:border-orange-400 dark:border-orange-500/30 dark:bg-orange-500/10",
    pill: "bg-orange-500 text-white",
    amount: "text-gray-900 dark:text-white",
  },
  ready: {
    frame: "border-success-500 bg-success-50 ring-2 ring-success-500/30 hover:border-success-600 dark:bg-success-500/15",
    pill: "bg-success-600 text-white",
    amount: "text-gray-900 dark:text-white",
  },
  eating: {
    frame: "border-brand-200 bg-brand-50 hover:border-brand-400 dark:border-brand-500/30 dark:bg-brand-500/10",
    pill: "bg-brand-500 text-white",
    amount: "text-gray-900 dark:text-white",
  },
};

type Filter = "all" | "free" | "occupied" | "mine" | "ready" | "earlier";

/** How many seats to offer as one press. Past eight is a number somebody types. */
const PARTY = [1, 2, 3, 4, 5, 6, 8];

/**
 * The floor.
 *
 *     "DIN Screen achi bnao — ux better ni hai, na ui"
 *
 * It was a grid of names: free tables said "Free", sat ones said "Tab 000123".
 * Everything a floor is actually run on needed a tap into each tab to learn.
 * So a tile now carries it — how long they have been sat, how many they are,
 * what the bill has reached, and the one thing the table needs next — and the
 * line across the top adds the room up.
 *
 * Two things that had nowhere to be seen are here too: takeaway tabs, which
 * have no table to stand for them, and tabs an earlier service left open.
 */
export default function FloorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const money = useMoney();
  const floor = useFloor();
  const { openTicket, createTable, deleteTable, reorderTables: reorder, closeOlderTabs } = useDineInMutations();
  const reportModal = useModal();

  const mayWork = useMayWorkTable();
  const me = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Reading the floor is floor work; laying it out is configuration. A waiter
  // holds neither of these, so the buttons that would only 403 are not shown.
  const canConfigure = hasPermission("settings.manage");
  const canSeeReports = hasPermission("reports.view");
  // Closing other waiters' leftovers takes the key that reaches other
  // waiters' tables — the server's own rule, asked here so the button is not
  // offered to somebody it would refuse.
  const canServeAny = hasPermission("tables.serve_any");

  const modal = useModal();
  const [seating, setSeating] = useState<FloorTable | null>(null);
  const [guests, setGuests] = useState("2");
  const [takeawayName, setTakeawayName] = useState("");

  const [editMode, setEditMode] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const tableModal = useModal();
  const [tableName, setTableName] = useState("");
  const [tableArea, setTableArea] = useState("");
  const [tableSeats, setTableSeats] = useState("4");

  // "42m" has to become "43m" on a floor nobody is touching. The poll would
  // carry it, but only while the tab is in front — and a minute is the unit.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const openFor = (table: FloorTable | null) => {
    setSeating(table);
    setGuests(table?.seats && table.seats < 2 ? "1" : "2");
    setTakeawayName("");
    openTicket.reset();
    modal.openModal();
  };

  const confirmOpen = () => {
    if (openTicket.isPending) return;
    openTicket.mutate(
      {
        order_type: seating ? "dine_in" : "takeaway",
        dining_table_id: seating?.id ?? null,
        guest_count: seating ? Number(guests) || 1 : undefined,
        // The kitchen calls a takeaway by its name. Asked for here, once,
        // rather than left as twelve cards on the pass all reading "Takeaway".
        customer_name: seating ? undefined : takeawayName.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          modal.closeModal();
          navigate(`/tenant/dine-in/tickets/${res.data.id}`);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't open the tab."),
      },
    );
  };

  const addTable = () => {
    setTableName("");
    setTableArea("");
    setTableSeats("4");
    createTable.reset();
    tableModal.openModal();
  };

  const confirmAddTable = () => {
    if (createTable.isPending || !tableName.trim()) return;
    createTable.mutate(
      {
        name: tableName.trim(),
        area: tableArea.trim() || undefined,
        seats: Number(tableSeats) || undefined,
      },
      {
        onSuccess: () => {
          tableModal.closeModal();
          toast.success("Table added");
          // LAYING OUT A FLOOR IS ONE JOB, NOT TWELVE.
          //
          // The first table is added from the empty floor's own button — and
          // the moment it existed, that button was gone with the empty floor,
          // and the next one had to be found behind "Edit floor". A floor is
          // never one table. Adding one leaves the layout open, with "+ Add
          // table" where it was, until Done is pressed.
          setEditMode(true);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add the table."),
      },
    );
  };

  const removeTable = async (table: FloorTable) => {
    const ok = await confirm({ title: `Remove ${table.name}?`, confirmLabel: "Remove", tone: "danger" });
    if (!ok) return;
    deleteTable.mutate(table.id, {
      onSuccess: () => toast.success("Table removed"),
      onError: () => toast.error("Couldn't remove — it may have an open tab."),
    });
  };

  const rows = useMemo(() => floor.data?.tables ?? [], [floor.data]);
  const takeaway = useMemo(() => floor.data?.takeaway ?? [], [floor.data]);
  const summary = useMemo(
    () => (floor.data ? summarise(floor.data) : null),
    [floor.data],
  );

  const isMine = (tab: FloorTab | null) => tab !== null && tab.waiter_id !== null && tab.waiter_id === me?.id;
  const passes = (tab: FloorTab | null): boolean => {
    switch (filter) {
      case "free": return tab === null;
      case "occupied": return tab !== null;
      case "mine": return isMine(tab);
      case "ready": return (tab?.ready ?? 0) > 0;
      case "earlier": return tab?.from_earlier ?? false;
      default: return true;
    }
  };
  // Editing lays out the WHOLE floor: a filter left on would hide the very
  // tables somebody came to move.
  const shownRows = editMode ? rows : rows.filter((t) => passes(t.open_ticket));
  const shownTakeaway = editMode || filter === "free" ? [] : takeaway.filter(passes);
  const mineCount = [...rows.map((t) => t.open_ticket), ...takeaway].filter(isMine).length;

  /**
   * The floor, clustered into its sections. Groups appear in the order their
   * first table does, so the arrangement an owner set is what shows — this is
   * a grouping of the existing order, never a re-sort of it.
   */
  const groups = useMemo(() => {
    const out: Array<{ area: string | null; tables: FloorTable[] }> = [];
    for (const t of shownRows) {
      const area = areaOf(t);
      const existing = out.find((g) => g.area === area);
      if (existing) existing.tables.push(t);
      else out.push({ area, tables: [t] });
    }
    return out;
  }, [shownRows]);

  /** Display order of EVERY table — what the reorder endpoint is told. */
  const ordered = useMemo(() => {
    const out: Array<{ area: string | null; tables: FloorTable[] }> = [];
    for (const t of rows) {
      const area = areaOf(t);
      const existing = out.find((g) => g.area === area);
      if (existing) existing.tables.push(t);
      else out.push({ area, tables: [t] });
    }
    return out.flatMap((g) => g.tables);
  }, [rows]);
  const hasSections = rows.some((t) => areaOf(t) !== null);

  /**
   * A move stays inside its section. Shuffling a table past the boundary would
   * put a rooftop table in the hall, which is a rename, not a reorder.
   */
  const swapTarget = (id: string, delta: number): number => {
    const at = ordered.findIndex((r) => r.id === id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ordered.length) return -1;
    return areaOf(ordered[at]) === areaOf(ordered[to]) ? to : -1;
  };

  /**
   * Shuffle one table along by a place. The server takes the whole order and
   * uses each id's index as its position, so the list is sent entire — a
   * per-table "sort_order" nudge would leave two tables sharing a slot the
   * first time one was deleted.
   */
  const moveTable = (id: string, delta: number) => {
    if (reorder.isPending) return;
    const at = ordered.findIndex((r) => r.id === id);
    const to = swapTarget(id, delta);
    if (to < 0) return;
    const order = ordered.map((r) => r.id);
    [order[at], order[to]] = [order[to], order[at]];
    reorder.mutate(order, { onError: () => toast.error("Couldn't move that table.") });
  };

  const closeOlder = async () => {
    const n = summary?.earlier ?? 0;
    const ok = await confirm({
      title: `Close ${n} ${n === 1 ? "tab" : "tabs"} left open from before today?`,
      message:
        "Everything on them is voided, as if each had been cancelled. A tab with a payment on it is "
        + "NOT closed — you settle the rest of that one yourself.",
      confirmLabel: n === 1 ? "Close it" : `Close ${n} tabs`,
      tone: "danger",
    });
    if (!ok) return;
    closeOlderTabs.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(res.message ?? "Closed.");
        setFilter("all");
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't close those tabs."),
    });
  };

  const chip = (active: boolean) =>
    `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-theme-sm font-semibold transition ${
      active
        ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
        : "bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/10"
    }`;
  const chipCount = (active: boolean) =>
    `rounded-md px-1.5 text-theme-xs font-bold tabular-nums ${
      active ? "bg-white/20 dark:bg-black/10" : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
    }`;

  const filters: Array<{ key: Filter; label: string; count: number; show: boolean }> = [
    { key: "all", label: "All", count: rows.length + takeaway.length, show: true },
    { key: "free", label: "Free", count: summary?.free ?? 0, show: true },
    { key: "occupied", label: "Occupied", count: (summary?.occupied ?? 0) + takeaway.length, show: true },
    // Only for somebody who has tables of their own: an owner who never
    // opens a tab would be offered a filter that is always empty.
    { key: "mine", label: "Mine", count: mineCount, show: mineCount > 0 },
    { key: "ready", label: "Food ready", count: summary?.ready ?? 0, show: (summary?.ready ?? 0) > 0 },
    { key: "earlier", label: "From earlier", count: summary?.earlier ?? 0, show: (summary?.earlier ?? 0) > 0 },
  ];

  /** One open tab's tile — a table's, or a takeaway's. */
  const tabBody = (tab: FloorTab, state: TableState) => {
    const mine = mayWork(tab.waiter_id);
    const since = sinceLabel(tab.opened_at, now);

    return (
      <>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-md px-2 py-0.5 text-theme-xs font-bold ${TILE[state].pill}`}>
            {STATE_LABEL[state]}
          </span>
          {tab.from_earlier && (
            <span className="rounded-md bg-error-50 px-2 py-0.5 text-theme-xs font-bold text-error-600 dark:bg-error-500/15 dark:text-error-400">
              From earlier
            </span>
          )}
        </span>
        <span className="mt-auto block pt-2">
          <span className={`block text-lg font-bold leading-tight tabular-nums ${TILE[state].amount}`}>
            {money(tab.to_pay)}
          </span>
          <span className="mt-0.5 block truncate text-theme-xs text-gray-600 dark:text-gray-300">
            {[
              tab.guest_count ? `${tab.guest_count} ${tab.guest_count === 1 ? "guest" : "guests"}` : null,
              since || null,
            ].filter(Boolean).join(" · ")}
          </span>
          {/* Whose it is, in words — and whether that stops you working it. */}
          <span className="mt-0.5 block truncate text-theme-xs text-gray-500 dark:text-gray-400">
            {tab.waiter === null
              ? "Nobody's yet"
              : tab.waiter_id === me?.id
                ? tab.order_type === "takeaway" ? "Your order" : "Your table"
                : tab.waiter.name}
            {!mine && " · view only"}
          </span>
        </span>
      </>
    );
  };

  const TILE_BASE = "flex min-h-36 w-full flex-col rounded-2xl border-2 p-3 text-left transition-colors";

  return (
    <div className={`${FULL_SCREEN_PAGE_MIN} bg-gray-100 dark:bg-gray-950`}>
      <PageMeta title="Dine-in" description="Restaurant floor" />

      {/* THE FLOOR IS WORKED FROM A PHONE IN AN APRON POCKET.
          One nowrap flex row of controls does not fit 390px: the header ran
          off the side of the screen and "+ Takeaway" — the button a waiter
          reaches for most — was the half hanging off the edge. It wraps, and
          `min-w-0` on the title group is what lets it shrink at all. */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <RailMenuButton />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold leading-tight text-gray-900 dark:text-white">Dine-in Floor</h1>
              {summary && (
                <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
                  {summary.occupied} of {summary.tables} tables sat
                  {takeaway.length > 0 ? ` · ${takeaway.length} takeaway` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editMode && <Button size="sm" variant="outline" onClick={addTable}>+ Add table</Button>}
            {!editMode && canSeeReports && (
              <Button size="sm" variant="outline" onClick={reportModal.openModal}>
                Waiters
              </Button>
            )}
            {canConfigure && (
              <Button size="sm" variant="outline" onClick={() => setEditMode((v) => !v)}>
                {editMode ? "Done" : "Edit floor"}
              </Button>
            )}
            {!editMode && <Button size="sm" onClick={() => openFor(null)}>+ Takeaway</Button>}
          </div>
        </div>
      </header>

      {/* ROOM AT THE BOTTOM FOR WHATEVER IS PINNED THERE.
          `FULL_SCREEN_PAGE_MIN` takes the pinned card out of the page's
          MINIMUM height, which keeps the floor from being scroll-locked — but
          it reserves nothing at the end of the content, so the last row of
          tables sat under the install card with the page already scrolled to
          its limit. */}
      <div className="space-y-5 p-4 pb-[calc(1.25rem+var(--pinned-bottom,0px))] sm:p-5 sm:pb-[calc(1.25rem+var(--pinned-bottom,0px))]">
        {/* THE ROOM, ADDED UP. Four figures a manager reads standing at the
            door; each in the colour its tiles wear below. */}
        {summary && rows.length > 0 && !editMode && (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="floor-summary">
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-3 sm:p-4 dark:border-brand-500/20 dark:bg-brand-500/10">
              <dt className="text-theme-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Tables sat</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900 sm:text-2xl dark:text-white">
                {summary.occupied}<span className="text-base font-semibold text-gray-500 dark:text-gray-400"> / {summary.tables}</span>
              </dd>
              <dd className="text-theme-xs text-gray-600 dark:text-gray-300">{summary.free} free</dd>
            </div>
            <div className="rounded-2xl border border-blue-light-100 bg-blue-light-50 p-3 sm:p-4 dark:border-blue-light-500/20 dark:bg-blue-light-500/10">
              <dt className="text-theme-xs font-semibold uppercase tracking-wide text-blue-light-700 dark:text-blue-light-400">Guests</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900 sm:text-2xl dark:text-white">{summary.guests}</dd>
              <dd className="text-theme-xs text-gray-600 dark:text-gray-300">in the room now</dd>
            </div>
            <div
              className={`rounded-2xl border p-3 sm:p-4 ${
                summary.ready > 0
                  ? "border-success-500 bg-success-50 ring-2 ring-success-500/30 dark:bg-success-500/15"
                  : "border-success-100 bg-success-50 dark:border-success-500/20 dark:bg-success-500/10"
              }`}
            >
              <dt className="text-theme-xs font-semibold uppercase tracking-wide text-success-700 dark:text-success-400">Food ready</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900 sm:text-2xl dark:text-white">{summary.ready}</dd>
              <dd className="text-theme-xs text-gray-600 dark:text-gray-300">
                {summary.ready > 0
                  ? "on the pass — run it"
                  : summary.unsent > 0
                    ? `${summary.unsent} ${summary.unsent === 1 ? "order" : "orders"} not sent yet`
                    : "nothing waiting"}
              </dd>
            </div>
            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-3 sm:p-4 dark:border-warning-500/20 dark:bg-warning-500/10">
              <dt className="text-theme-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-400">To collect</dt>
              <dd className="mt-1 truncate text-xl font-bold tabular-nums text-gray-900 sm:text-2xl dark:text-white">{money(summary.toPay)}</dd>
              <dd className="text-theme-xs text-gray-600 dark:text-gray-300">on open tabs, before tax</dd>
            </div>
          </dl>
        )}

        {/* WHAT AN EARLIER SERVICE LEFT OPEN. A table nobody settled last
            night is "occupied" this morning, and looked exactly like one sat
            five minutes ago. */}
        {summary && summary.earlier > 0 && !editMode && (
          <div
            data-testid="floor-earlier"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-error-200 bg-error-50 px-4 py-3 dark:border-error-500/30 dark:bg-error-500/10"
          >
            <p className="text-theme-sm text-error-700 dark:text-error-300">
              <span className="font-bold">
                {summary.earlier} {summary.earlier === 1 ? "tab is" : "tabs are"}
              </span>{" "}
              still open from before today's service. Settle {summary.earlier === 1 ? "it" : "them"} if the money came in, or close{" "}
              {summary.earlier === 1 ? "it" : "them"}.
            </p>
            <div className="flex items-center gap-2">
              {filter !== "earlier" && (
                <button
                  type="button"
                  onClick={() => setFilter("earlier")}
                  className="inline-flex min-h-11 items-center rounded-xl px-4 text-theme-sm font-semibold text-error-700 ring-1 ring-inset ring-error-300 transition hover:bg-error-100 dark:text-error-300 dark:ring-error-500/40 dark:hover:bg-error-500/15"
                >
                  Show {summary.earlier === 1 ? "it" : "them"}
                </button>
              )}
              {canServeAny && (
                <button
                  type="button"
                  onClick={closeOlder}
                  disabled={closeOlderTabs.isPending}
                  className="inline-flex min-h-11 items-center rounded-xl bg-error-600 px-4 text-theme-sm font-bold text-white transition hover:bg-error-700 disabled:opacity-50"
                >
                  {closeOlderTabs.isPending ? "Closing…" : summary.earlier === 1 ? "Close it" : `Close all ${summary.earlier}`}
                </button>
              )}
            </div>
          </div>
        )}

        {rows.length > 0 && !editMode && (
          <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5" role="group" aria-label="Show">
            {filters.filter((f) => f.show).map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                aria-label={`${f.label}, ${f.count}`}
                className={chip(filter === f.key)}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className={chipCount(filter === f.key)}>{f.count}</span>
              </button>
            ))}
          </div>
        )}

        {floor.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : floor.isError ? (
          <p className="py-16 text-center text-error-500">Can't reach the floor. It will retry on its own.</p>
        ) : rows.length === 0 && takeaway.length === 0 ? (
          <ListEmpty from={floor} what="the floor">
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center dark:border-gray-700 dark:bg-white/[0.03]">
              <p className="text-gray-600 dark:text-gray-300">No tables yet.</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {canConfigure
                  ? "Add your first table to lay out the floor, or take a takeaway order."
                  : "Nobody has laid out the floor yet. Ask the owner to add the tables."}
              </p>
              {canConfigure && <div className="mt-4"><Button size="sm" onClick={addTable}>+ Add table</Button></div>}
            </div>
          </ListEmpty>
        ) : (
          <div className="space-y-6">
            {/* TAKEAWAY TABS. They have no table, so they had no tile: "+
                Takeaway" opened one, and stepping back to the floor left no
                way to reach it again. */}
            {shownTakeaway.length > 0 && (
              <section aria-label="Takeaway">
                <h2 className="mb-2 text-theme-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Takeaway
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {shownTakeaway.map((tab) => {
                    const state = stateOf(tab);

                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => navigate(`/tenant/dine-in/tickets/${tab.id}`)}
                        className={`${TILE_BASE} ${TILE[state].frame}`}
                      >
                        <span className="mb-1.5 block w-full truncate text-lg font-bold leading-tight text-gray-900 dark:text-white">
                          {tab.customer_name?.trim() || "Takeaway"}
                        </span>
                        <span className="mb-1.5 block text-theme-xs text-gray-500 dark:text-gray-400">{tab.ticket_number}</span>
                        {tabBody(tab, state)}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {groups.map((group) => (
              <section key={group.area ?? "__floor"} aria-label={group.area ?? "Floor"}>
                {/* Headings only once a floor actually has sections — a single
                    unnamed group titled "Floor" is a label saying nothing. */}
                {hasSections && (
                  <h2 className="mb-2 flex items-baseline gap-2 text-theme-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {group.area ?? "Floor"}
                    <span className="font-medium normal-case tracking-normal text-gray-400 dark:text-gray-500">
                      {group.tables.filter((t) => t.open_ticket).length} of {group.tables.length} sat
                    </span>
                  </h2>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {group.tables.map((t) => {
                    const tab = t.open_ticket;
                    const state = stateOf(tab);

                    return (
                      <div key={t.id} className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            editMode ? undefined : tab ? navigate(`/tenant/dine-in/tickets/${tab.id}`) : openFor(t)
                          }
                          disabled={editMode}
                          className={`${TILE_BASE} ${TILE[state].frame} ${editMode ? "cursor-default" : ""}`}
                        >
                          <span className="mb-1.5 flex w-full items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-lg font-bold leading-tight text-gray-900 dark:text-white">{t.name}</span>
                            {t.seats != null && (
                              <span className="shrink-0 text-theme-xs text-gray-500 dark:text-gray-400">{t.seats} seats</span>
                            )}
                          </span>
                          {tab ? (
                            tabBody(tab, state)
                          ) : (
                            <>
                              <span className="flex">
                                <span className={`rounded-md px-2 py-0.5 text-theme-xs font-bold ${TILE.free.pill}`}>Free</span>
                              </span>
                              {!editMode && (
                                <span className="mt-auto block pt-2 text-theme-sm font-semibold text-brand-600 dark:text-brand-400">
                                  Seat guests →
                                </span>
                              )}
                            </>
                          )}
                        </button>
                        {editMode && !tab && (
                          <button
                            type="button"
                            onClick={() => removeTable(t)}
                            className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-error-500 text-sm text-white shadow hover:bg-error-600"
                            aria-label={`Remove ${t.name}`}
                          >
                            ×
                          </button>
                        )}
                        {/* Move, rather than drag. The floor is laid out on a tablet
                            propped by the till, and a drag target that small is a
                            table dropped in the wrong place — which on a busy floor
                            means a waiter walking to the wrong one. */}
                        {editMode && (
                          <div className="absolute inset-x-0 -bottom-3 flex justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveTable(t.id, -1)}
                              disabled={reorder.isPending || swapTarget(t.id, -1) < 0}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              aria-label={`Move ${t.name} earlier`}
                            >
                              ‹
                            </button>
                            <button
                              type="button"
                              onClick={() => moveTable(t.id, 1)}
                              disabled={reorder.isPending || swapTarget(t.id, 1) < 0}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              aria-label={`Move ${t.name} later`}
                            >
                              ›
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {groups.length === 0 && shownTakeaway.length === 0 && (
              <p className="rounded-2xl border border-dashed border-gray-300 bg-white py-12 text-center text-theme-sm text-gray-500 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-400">
                Nothing matches that filter right now.
              </p>
            )}
          </div>
        )}
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {seating ? `Open tab — ${seating.name}` : "New takeaway order"}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {seating ? "How many are sitting down?" : "A tab with no table. The kitchen calls it by the name you give."}
        </p>

        {seating ? (
          <div className="mb-5">
            {/* The common parties are one press each. A number box alone made
                "four people" three taps and a keyboard on a tablet. */}
            <div className="mb-3 grid grid-cols-7 gap-1.5" role="group" aria-label="Party size">
              {PARTY.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={guests === String(n)}
                  onClick={() => setGuests(String(n))}
                  className={`flex h-11 items-center justify-center rounded-xl text-base font-bold tabular-nums transition ${
                    guests === String(n)
                      ? "bg-brand-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <Label htmlFor="floor-guests">Guests</Label>
            <Input id="floor-guests" type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} />
          </div>
        ) : (
          <div className="mb-5">
            <Label htmlFor="floor-takeaway-name">Name <span className="font-normal text-gray-400">(optional)</span></Label>
            <Input
              id="floor-takeaway-name"
              value={takeawayName}
              onChange={(e) => setTakeawayName(e.target.value)}
              placeholder="e.g. Ahmed"
            />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={confirmOpen} disabled={openTicket.isPending}>
            {openTicket.isPending ? "Opening…" : "Open tab"}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={tableModal.isOpen} onClose={tableModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Add table</h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="floor-table-name">Name <span className="text-error-500">*</span></Label>
            <Input id="floor-table-name" value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="e.g. T1 or Patio 3" />
          </div>
          <div>
            <Label htmlFor="floor-table-area">Section <span className="font-normal text-gray-400">(optional)</span></Label>
            <Input
              id="floor-table-area"
              value={tableArea}
              onChange={(e) => setTableArea(e.target.value)}
              placeholder="e.g. Garden, Rooftop, Hall"
              list="dine-in-areas"
            />
            {/* Existing sections offered back, so "Rooftop" and "rooftop" don't
                become two parts of the restaurant. */}
            <datalist id="dine-in-areas">
              {[...new Set(rows.map(areaOf).filter((a): a is string => a !== null))].map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <p className="mt-1 text-theme-xs text-gray-400">Groups the floor. It does not decide who may serve the table.</p>
          </div>
          <div>
            <Label htmlFor="floor-table-seats">Seats</Label>
            <Input id="floor-table-seats" type="number" min="1" value={tableSeats} onChange={(e) => setTableSeats(e.target.value)} />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={tableModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={confirmAddTable} disabled={createTable.isPending || !tableName.trim()}>
            {createTable.isPending ? "Adding…" : "Add table"}
          </Button>
        </div>
      </Modal>

      <WaiterReportModal isOpen={reportModal.isOpen} onClose={reportModal.closeModal} />
    </div>
  );
}
