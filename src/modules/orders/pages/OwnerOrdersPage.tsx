import { useEffect, useState } from "react";
import { useAuthStore } from "../../../stores/authStore";
import { Link, useSearchParams } from "react-router";

import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { OrderAlerts } from "../../notifications/OrderAlerts";
import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import { useConfirm } from "../../../components/ui/confirm";
import {
  DateRangeFilter,
  EMPTY_RANGE,
  FilterBar,
  FilterSelect,
  formatRange,
  type AppliedFilter,
  type DateRange,
} from "../../../components/ui/filters";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import { useToast } from "../../../components/ui/toast";
import { printTheSlip, slipSays } from "../kitchenSlip";
import { OrderBoard } from "../components/OrderBoard";
import { OrderDetail } from "../components/OrderDetail";
import { OrdersTable } from "../components/OrdersTable";
import { WhoCarriesIt } from "../components/WhoCarriesIt";
import { asksWhoCarries } from "../whoCarries";
import { useOrderActions, useRiders, useShopOrders, useTellTheMenu } from "../hooks/useOrders";
import type { OrderStatus, OwnerOrder } from "../services/ordersService";

/**
 * THE TWO THINGS THIS PAGE IS OPENED FOR.
 *
 * TODAY — what is being worked, as a BOARD, and under it what was finished
 * today. PAST ORDERS — every day before this one, as a TABLE that can be asked
 * for a date, a customer or a stage.
 *
 * It was a row of eight stages over one table of everything, newest first — so
 * an order twenty minutes unanswered sat under three already delivered, and
 * last month's orders were on the same list as the one the kitchen was
 * cooking. Then a board with "Completed", "Cancelled" and "All" beside it,
 * which answered "what needs doing" and still left "where is yesterday's" to
 * be worked out. A shop asks about TODAY or about BEFORE; those are the tabs.
 *
 * Where today ends is the server's to say (`when`): a restaurant's day runs
 * past midnight.
 */
const TABS = [
  { value: "today", label: "Today" },
  { value: "past", label: "Past orders" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/** How a past order ended. An order still open is on Today's board, however old. */
const ENDED = [
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const CHANNELS = [
  { value: "online", label: "Online" },
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Walk-in" },
];

const FULFILMENT = [
  { value: "delivery", label: "Delivery" },
  { value: "pickup", label: "Pickup" },
];

/**
 * THE ORDER QUEUE.
 *
 * ── What it was ────────────────────────────────────────────────────────
 *
 * A dropdown of seven statuses and a column of cards. The cards did not say
 * WHEN anything had been placed — not the age, not the clock, nothing — on a
 * screen whose whole purpose is deciding what to pick up next. A shop worked
 * that out by remembering.
 *
 * It also could not be asked for a customer's name, a phone number, a date,
 * whether an order was a delivery, or the one question that costs money: which
 * deliveries have nobody carrying them. `channel` and `open_only` had been
 * accepted by the server since the day it was written and this screen sent
 * neither.
 */
export default function OwnerOrdersPage() {
  const money = useMoney();

  // The tab is in the address, so a refresh — or a link — lands on the same one.
  const [asked, setAsked] = useSearchParams();
  const tab: Tab = asked.get("show") === "past" ? "past" : "today";
  const today = tab === "today";

  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup" | "">("");
  const [unassigned, setUnassigned] = useState(false);
  const [ended, setEnded] = useState("");
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [page, setPage] = useState(1);
  const [donePage, setDonePage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  // THE BOARD'S OWN QUESTION: everything still being worked, at once — not a
  // page of fifteen, and not only today's: an order from last night that
  // nobody has finished is still somebody's to finish.
  const working = useShopOrders({ open_only: true, per_page: 100, search: debounced, channel, fulfillment, unassigned, page: 1 }, today);
  // What was finished today, under the board.
  const finished = useShopOrders({ when: "today", closed_only: true, search: debounced, channel, fulfillment, page: donePage }, today && !unassigned);
  // Every day before this one.
  const past = useShopOrders({ when: "past", status: ended, search: debounced, channel, fulfillment, from: range.from, to: range.to, page }, !today);

  const onBoard = working.data?.data ?? [];
  const doneRows = finished.data?.data ?? [];
  const pastRows = past.data?.data ?? [];

  const { advance, cancel, assignRider } = useOrderActions();
  const confirm = useConfirm();
  const toast = useToast();
  const settings = useShopSettings();
  // /riders needs `delivery`. A pickup-only online shop asked on every load.
  const deliversOrders = !!useAuthStore((s) => s.user?.tenant?.features?.delivery);
  const riders = useRiders(deliversOrders);
  const activeRiders = (riders.data ?? []).filter((r) => r.is_active);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const branchCol = useBranchColumn();

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Action failed.");
  /**
   * AN ORDER MOVED ON — and if that step sent it to the kitchen, its slip is
   * printed here. The server sends the ticket; a browser prints. Until now
   * "Start preparing" put nothing on the kitchen's printer at all.
   */
  const onMoved = (res: { data: OwnerOrder }) => {
    const order = res.data;
    void printTheSlip(order.kitchen_ticket, settings.data?.kot_auto_print !== false).then((outcome) => {
      const says = slipSays(outcome, order.order_number);
      if (says === null) return;
      if (outcome === "did not print") toast.error(says);
      else toast.success(says);
    });
  };
  const send = (order: OwnerOrder, to: OrderStatus) => {
    setError(null);
    advance.mutate({ id: order.id, status: to }, { onError, onSuccess: onMoved });
  };
  /**
   * A STEP — from a card, a row or the order's sheet, all through here, so
   * "Out for delivery" asks who is carrying it wherever it is pressed.
   * Asked always, required never: see `whoCarries.ts`.
   */
  const [leaving, setLeaving] = useState<{ id: string; to: OrderStatus } | null>(null);
  const move = (order: OwnerOrder, to: OrderStatus) => {
    if (asksWhoCarries(order, to)) {
      setError(null);
      setLeaving({ id: order.id, to });

      return;
    }
    send(order, to);
  };
  const busy = advance.isPending || cancel.isPending || assignRider.isPending;

  /**
   * The order the panel is showing, taken from the LISTS rather than kept in
   * state as a copy.
   *
   * That is what makes the panel update itself: advancing an order refetches
   * the queue, and a snapshot stored on open would still be showing the stage
   * it was at when it was opened — with a button offering a move it has
   * already made.
   */
  const opened: OwnerOrder | null = [...onBoard, ...doneRows, ...pastRows].find((o) => o.id === openId) ?? null;
  const leavingOrder: OwnerOrder | null = leaving === null ? null : [...onBoard, ...doneRows, ...pastRows].find((o) => o.id === leaving.id) ?? null;

  /** Change one filter. Any change returns to page one — page 4 of a different
   *  filter is a page that usually does not exist. */
  const change = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
    setDonePage(1);
  };

  const applied: AppliedFilter[] = [
    channel && {
      key: "channel",
      label: "From",
      value: CHANNELS.find((c) => c.value === channel)?.label ?? channel,
      onRemove: () => change(setChannel)(""),
    },
    fulfillment && {
      key: "fulfillment",
      label: "",
      value: FULFILMENT.find((f) => f.value === fulfillment)?.label ?? fulfillment,
      onRemove: () => change(setFulfillment)("" as const),
    },
    today && unassigned && {
      key: "unassigned",
      label: "",
      value: "No rider assigned",
      onRemove: () => change(setUnassigned)(false),
    },
    !today && ended && {
      key: "ended",
      label: "",
      value: ENDED.find((e) => e.value === ended)?.label ?? ended,
      onRemove: () => change(setEnded)(""),
    },
    !today && (range.from !== null || range.to !== null) && {
      key: "range",
      label: "Placed",
      value: formatRange(range),
      onRemove: () => change(setRange)(EMPTY_RANGE),
    },
  ].filter(Boolean) as AppliedFilter[];
  const narrowed = applied.length > 0 || debounced !== "";

  /**
   * HOW MANY ARE BEING WORKED, and how many deliveries have no rider — of the
   * WHOLE shop, whatever is typed in the search box and whichever tab is open.
   * They are a count on a tab and a warning, not filter results: "Today 0"
   * beside a search for a name would read as "nothing is waiting".
   *
   * The board's own answer already says both when nothing narrows it; this is
   * asked only when that answer is narrowed or not being asked for.
   */
  const pulse = useShopOrders({ open_only: true, per_page: 1, page: 1 }, !today || narrowed);
  const whole = today && !narrowed ? working : pulse;
  // The whole shop's open orders, counted by stage — the very figures the
  // menu's count is made of. Told to it here, so it is not asked for there.
  const tellTheMenu = useTellTheMenu();
  const stages = whole.data?.meta.status_counts as { all?: number; pending?: number } | undefined;
  const beingWorkedNow = stages?.all;
  const newNow = stages?.pending;
  const toldAt = whole.dataUpdatedAt;
  useEffect(() => {
    if (beingWorkedNow === undefined || newNow === undefined) return;
    tellTheMenu({ new: newNow, being_worked: beingWorkedNow });
  }, [beingWorkedNow, newNow, toldAt, tellTheMenu]);
  const beingWorked = whole.data?.meta.pagination?.total;
  const waitingForARider = (whole.data?.meta.unassigned as number | undefined) ?? 0;

  const clearAll = () => {
    setSearch("");
    setChannel("");
    setFulfillment("");
    setUnassigned(false);
    setEnded("");
    setRange(EMPTY_RANGE);
    setPage(1);
    setDonePage(1);
  };

  const show = (next: Tab) => {
    setAsked(next === "past" ? { show: "past" } : {}, { replace: true });
    setPage(1);
    setDonePage(1);
  };

  const takeOne = (
    <Link to="/tenant/orders/new" className="text-brand-500 hover:text-brand-600">take one yourself</Link>
  );

  return (
    <>
      <PageMeta title="Orders" description="Online orders" />

      {/*
        Asked for HERE, from a button, and nowhere else. A browser asks for
        notification permission once and a dismissal is close to permanent, so
        the request belongs on the screen where the reason is obvious rather
        than on a page load. Renders nothing once alerts are on — and nothing
        at all in a build with no Firebase project.
      */}
      <OrderAlerts />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Online checkouts and the ones you take yourself — one queue, stock held until you complete or cancel.
          </p>
        </div>
        <Link to="/tenant/orders/new">
          <Button size="sm">Take an order</Button>
        </Link>
      </div>

      {/* On Today: how many are still being worked — in sight from the
          other tab too, so looking something up does not hide a queue. */}
      <FilterTabs
        className="mb-4"
        label="Which orders"
        value={tab}
        onChange={show}
        tabs={TABS.map((t) => ({
          key: t.value,
          label: t.label,
          badge: t.value === "today" && beingWorked !== undefined ? (
            <span
              data-testid="being-worked"
              aria-label={`${beingWorked} being worked`}
              className={`grid min-w-5 place-items-center rounded-md px-1 text-theme-xs tabular-nums ${
                tab === "today" ? "bg-white/25 text-white"
                  : beingWorked > 0 ? "bg-brand-500 text-white" : "bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300"
              }`}
            >
              {beingWorked}
            </span>
          ) : undefined,
        }))}
      />

      <div id="orders-panel">
        {/* A DELIVERY WITH NOBODY CARRYING IT is a customer waiting for a bike
            that was never sent. It is counted across the whole shop, not just
            what is on screen, because it is a warning rather than a filter
            result — and it is one press to see them. */}
        {waitingForARider > 0 && !(today && unassigned) && (
          <button
            type="button"
            onClick={() => {
              if (!today) show("today");
              change(setUnassigned)(true);
            }}
            className="mb-4 flex w-full flex-wrap items-center gap-3 rounded-2xl border border-warning-300 bg-warning-25 px-4 py-3 text-left transition hover:border-warning-400 dark:border-warning-500/40 dark:bg-warning-500/10"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-warning-500 text-sm font-bold text-white">
              {waitingForARider}
            </span>
            <span className="min-w-0 flex-1 text-theme-sm font-semibold text-warning-800 dark:text-warning-300">
              {waitingForARider === 1
                ? "One delivery has no rider on it"
                : `${waitingForARider} deliveries have no rider on them`}
              <span className="block text-theme-xs font-normal text-warning-700/80 dark:text-warning-400/80">
                {activeRiders.length === 0
                  ? "This shop has no riders yet — add one and they can be assigned."
                  : "Nobody is carrying these yet."}
              </span>
            </span>
            <span className="text-theme-sm font-semibold text-warning-700 dark:text-warning-400">Show them →</span>
          </button>
        )}

        <FilterBar
          search={{
            value: search,
            onChange: change(setSearch),
            placeholder: "Order number, customer or phone…",
            label: "Search orders",
          }}
          applied={applied}
          onClearAll={clearAll}
          results={today
            ? { count: working.data?.meta.pagination?.total, noun: "orders being worked", loading: working.isLoading }
            : { count: past.data?.meta.pagination?.total, noun: "past orders", loading: past.isLoading }}
        >
          {!today && (
            <DateRangeFilter
              label="Any date"
              value={range}
              onChange={change(setRange)}
            />
          )}
          {!today && (
            <FilterSelect
              label="Completed & cancelled"
              value={ended}
              onChange={change(setEnded)}
              options={ENDED}
            />
          )}
          <FilterSelect
            label="Delivery & pickup"
            value={fulfillment}
            onChange={(value) => change(setFulfillment)(value as "delivery" | "pickup" | "")}
            options={FULFILMENT}
          />
          <FilterSelect
            label="Any channel"
            value={channel}
            onChange={change(setChannel)}
            options={CHANNELS}
          />
        </FilterBar>

        {error && <div className="mb-4"><Alert variant="error" title="Blocked" message={error} /></div>}

        {/* ── TODAY: the board — what is being worked, and the one button each needs ── */}
        {today && (
          working.isLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-48 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
              ))}
            </div>
          ) : onBoard.length === 0 ? (
            <ListEmpty from={working} what="the orders">
            {/* "Nothing is waiting" is said only of a board that was ASKED and
                answered: refused or failed, it says that instead. */}
            <div data-testid="nothing-live" className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-white/[0.03]">
              <p className="text-base font-semibold text-gray-800 dark:text-white/90">
                {unassigned ? "Every delivery has a rider on it." : narrowed ? "No order being worked matches these filters." : "Nothing is waiting."}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {narrowed
                  ? "What was finished today is below; earlier days are under Past orders."
                  : "A new order shows here the moment it is placed — online, or one you take yourself."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                {narrowed && (
                  <Button size="sm" variant="outline" onClick={clearAll}>Clear the filters</Button>
                )}
                <Link to="/tenant/orders/new"><Button size="sm">Take an order</Button></Link>
              </div>
            </div>
            </ListEmpty>
          ) : (
            <>
              <OrderBoard orders={onBoard} money={money} busy={busy} onOpen={(o) => setOpenId(o.id)} onAdvance={move} />
              {(working.data?.meta.pagination?.total ?? 0) > onBoard.length && (
                <p className="mt-3 text-center text-theme-xs text-gray-500 dark:text-gray-400">
                  Showing the newest {onBoard.length} of {working.data?.meta.pagination?.total} being worked — search by number, name or phone to find another.
                </p>
              )}
            </>
          )
        )}

        {/* ── TODAY: what was finished ─────────────────────────────── */}
        {today && !unassigned && (
          <section aria-labelledby="finished-today" className="mt-7">
            <h2 id="finished-today" className="mb-2.5 flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-white/90">
              Finished today
              {finished.data?.meta.pagination?.total !== undefined && (
                <span className="rounded-md bg-gray-200 px-1.5 text-theme-xs font-semibold tabular-nums text-gray-600 dark:bg-white/10 dark:text-gray-300">
                  {finished.data.meta.pagination.total}
                </span>
              )}
            </h2>
            <OrdersTable
              from={finished}
              rows={doneRows}
              loading={finished.isLoading}
              placed="time"
              pagination={finished.data?.meta.pagination}
              onPage={setDonePage}
              money={money}
              busy={busy}
              onOpen={(o) => setOpenId(o.id)}
              onAdvance={move}
              empty={
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {narrowed ? "Nothing finished today matches these filters." : "Nothing has been completed or cancelled yet today."}
                </p>
              }
            />
          </section>
        )}

        {/* ── PAST ORDERS: every day before this one ───────────────── */}
        {!today && (
          <OrdersTable
            from={past}
            rows={pastRows}
            loading={past.isLoading}
            placed="moment"
            pagination={past.data?.meta.pagination}
            onPage={setPage}
            money={money}
            busy={busy}
            onOpen={(o) => setOpenId(o.id)}
            onAdvance={move}
            empty={
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {/* An empty list under a filter reads as "there are no
                      orders" unless it says otherwise. */}
                  {narrowed ? "No past order matches these filters." : "No orders from before today."}
                </p>
                {narrowed ? (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="mt-3 inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-theme-sm font-semibold text-brand-500 transition hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/10"
                  >
                    Clear the filters
                  </button>
                ) : (
                  <p className="mt-2 text-theme-xs text-gray-400">
                    Today's are under Today. They arrive from your online shop, or {takeOne}.
                  </p>
                )}
              </>
            }
          />
        )}
      </div>

      <OrderDetail
        order={opened}
        money={money}
        riders={activeRiders}
        branchLabel={opened && branchCol.show && opened.branch_id ? branchCol.label(opened.branch_id) : null}
        busy={busy}
        onClose={() => setOpenId(null)}
        onAdvance={(next) => {
          if (opened !== null) move(opened, next);
        }}
        onCancel={async () => {
          if (opened === null) return;
          // ASKED FIRST, AND TOLD WHY. One press used to cancel the order
          // there and then — a meal the kitchen is cooking and a customer is
          // waiting for, gone on a slip of the finger — and the customer was
          // told only "Cancelled by shop". The reason typed here is the one
          // they are sent.
          const order = opened;
          const reason = await confirm({
            title: `Cancel ${order.order_number}?`,
            message: `${order.customer_name ?? "The customer"} is told it was cancelled, and why. What was held for it goes back on the shelf.`,
            confirmLabel: "Cancel order",
            tone: "danger",
            input: { label: "Why — the customer is sent this", placeholder: "e.g. We have run out of the karahi", required: true },
          });
          if (reason === null) return;
          setError(null);
          cancel.mutate({ id: order.id, reason: reason.trim() }, { onError });
        }}
        onAssignRider={(riderId) => {
          if (opened === null) return;
          setError(null);
          assignRider.mutate({ id: opened.id, riderId }, { onError });
        }}
      />

      <WhoCarriesIt
        order={leavingOrder}
        riders={activeRiders}
        busy={busy}
        onClose={() => setLeaving(null)}
        onSend={(riderId) => {
          if (leavingOrder === null || leaving === null) return;
          const order = leavingOrder;
          const to = leaving.to;
          const gone = () => { setLeaving(null); send(order, to); };
          // With a name on it first — and if the name will not go on, the
          // order does not leave: the sheet closes on what the server said.
          if (riderId === null) gone();
          else assignRider.mutate({ id: order.id, riderId }, { onSuccess: gone, onError: (e) => { setLeaving(null); onError(e); } });
        }}
      />

    </>
  );
}
