import { useState } from "react";

import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import {
  DateRangeFilter,
  EMPTY_RANGE,
  FilterBar,
  FilterChips,
  FilterSelect,
  formatRange,
  type AppliedFilter,
  type DateRange,
} from "../../../components/ui/filters";
import Pager from "../../../components/ui/pager";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useModal } from "../../../hooks/useModal";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";
import { useMoney } from "../../shop/hooks/useShop";
import TakeOrderModal from "../components/TakeOrderModal";
import { OrderDetail } from "../components/OrderDetail";
import { OrderRow, ORDER_COLUMNS } from "../components/OrderRow";
import { nextStep } from "../orderFlow";
import { useOrderActions, useRiders, useShopOrders } from "../hooks/useOrders";
import type { OrderStageCounts, OwnerOrder } from "../services/ordersService";

/**
 * The stages, in the order an order moves through them.
 *
 * "All" first because a small shop works the whole queue at once; the stages
 * after it are the sequence, so the row reads as a pipeline rather than a set
 * of unrelated buckets. Completed and cancelled sit at the end, where nobody
 * looking for work will land on them by accident.
 */
const STAGES = [
  { value: "", label: "All" },
  { value: "pending", label: "New" },
  { value: "confirmed", label: "Confirmed" },
  { value: "preparing", label: "Preparing" },
  { value: "ready", label: "Ready" },
  { value: "out_for_delivery", label: "On the way" },
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
 *
 * ── What it is ─────────────────────────────────────────────────────────
 *
 * A pipeline with LIVE COUNTS on every stage, because "how many are waiting to
 * be confirmed" is the question, and the only way to answer it before was to
 * click each stage and read the paginator. A warning strip when a delivery has
 * no rider. And cards that lead with how long somebody has been waiting.
 */
export default function OwnerOrdersPage() {
  const money = useMoney();

  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup" | "">("");
  const [unassigned, setUnassigned] = useState(false);
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const orders = useShopOrders({
    status,
    search: debounced,
    channel,
    fulfillment,
    unassigned,
    from: range.from,
    to: range.to,
    page,
  });
  const { advance, cancel, assignRider } = useOrderActions();
  const riders = useRiders();
  const activeRiders = (riders.data ?? []).filter((r) => r.is_active);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const takeModal = useModal();

  const branchCol = useBranchColumn();

  const rows = orders.data?.data ?? [];
  const pagination = orders.data?.meta.pagination;
  const counts = orders.data?.meta.status_counts as OrderStageCounts | undefined;
  const waitingForARider = (orders.data?.meta.unassigned as number | undefined) ?? 0;

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Action failed.");
  const busy = advance.isPending || cancel.isPending || assignRider.isPending;

  /**
   * The order the panel is showing, taken from the LIST rather than kept in
   * state as a copy.
   *
   * That is what makes the panel update itself: advancing an order refetches
   * the queue, and a snapshot stored on open would still be showing the stage
   * it was at when it was opened — with a button offering a move it has
   * already made.
   */
  const opened: OwnerOrder | null = rows.find((o) => o.id === openId) ?? null;

  /** Change one filter. Any change returns to page one — page 4 of a different
   *  filter is a page that usually does not exist. */
  const change = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
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
    unassigned && {
      key: "unassigned",
      label: "",
      value: "No rider assigned",
      onRemove: () => change(setUnassigned)(false),
    },
    (range.from !== null || range.to !== null) && {
      key: "range",
      label: "Placed",
      value: formatRange(range),
      onRemove: () => change(setRange)(EMPTY_RANGE),
    },
  ].filter(Boolean) as AppliedFilter[];

  const clearAll = () => {
    setSearch("");
    setChannel("");
    setFulfillment("");
    setUnassigned(false);
    setRange(EMPTY_RANGE);
    setPage(1);
  };

  return (
    <>
      <PageMeta title="Orders | CartZe" description="Online orders" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Orders</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Online checkouts and the ones you take yourself — one queue, stock held until you complete or cancel.
          </p>
        </div>
        <Button size="sm" onClick={takeModal.openModal}>Take an order</Button>
      </div>

      {/* A queue, so the stages are a TRACK carrying live counts rather than a
          dropdown showing one word. "How many are waiting to be confirmed" is
          what this screen is opened to find out, and the only way to answer it
          before was to click each stage and read the paginator. */}
      <div className="mb-4">
        <FilterChips
          options={STAGES}
          value={status}
          counts={counts}
          ariaLabel="Which orders to show"
          onChange={change(setStatus)}
        />
      </div>

      {/* A DELIVERY WITH NOBODY CARRYING IT is a customer waiting for a bike
          that was never sent. It is counted across the whole shop, not just
          the stage on screen, because it is a warning rather than a filter
          result — and it is one press to see them. */}
      {waitingForARider > 0 && !unassigned && (
        <button
          type="button"
          onClick={() => change(setUnassigned)(true)}
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
        results={{ count: pagination?.total, noun: "orders", loading: orders.isLoading }}
      >
        <DateRangeFilter
          label="Any date"
          value={range}
          onChange={change(setRange)}
        />
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

      {/* A TABLE, not a wall of cards.
          The first version of this screen drew every item, the address, the
          notes, the rider picker and both buttons for every order. Four orders
          filled a laptop; a shop working a lunch rush has forty, and scrolled
          past everything it already knew to find the one that needed doing.
          The row carries what is needed to CHOOSE; a click opens the rest. */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          {/* NO `min-w` — the columns step down instead.
              A nine-column table on a 390px phone is not a table that needs
              scrolling sideways, it is a table with columns that have not
              earned their place there. Items, delivery-or-pickup and payment
              fold into the customer cell, and the next-step button moves into
              the detail panel a tap away. What is left — who, how long, how
              much, what stage — fits.
              The steps are `sm` and `xl`, not `sm` and `md`, because the rail
              takes 290px from `lg` up: a 1024px tablet has 734px of page, which
              is less than a 768px phone-in-landscape has. The breakpoint asks
              the VIEWPORT, so the useful width is always the viewport minus
              whatever the rail is holding. */}
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Waiting</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Items</th>
                <th className="hidden px-4 py-3 font-medium xl:table-cell">How</th>
                <th className="hidden px-4 py-3 font-medium xl:table-cell">Payment</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                  <span className="sr-only">Next step</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {orders.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={ORDER_COLUMNS} className="px-4 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={ORDER_COLUMNS} className="px-4 py-14 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {unassigned
                        ? "Every delivery has a rider on it."
                        : applied.length > 0 || debounced
                          // An empty queue under a filter reads as "there are
                          // no orders" unless it says otherwise.
                          ? "No order matches these filters."
                          : status
                            ? "Nothing at this stage."
                            : "No orders yet."}
                    </p>
                    {(applied.length > 0 || debounced) && (
                      <button
                        type="button"
                        onClick={clearAll}
                        className="mt-3 inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-theme-sm font-semibold text-brand-500 transition hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/10"
                      >
                        Clear the filters
                      </button>
                    )}
                    {applied.length === 0 && !debounced && !status && (
                      <p className="mt-2 text-theme-xs text-gray-400">
                        They arrive from your online shop, or take one yourself with the button above.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((o) => {
                  const step = nextStep(o);

                  return (
                    <OrderRow
                      key={o.id}
                      order={o}
                      money={money}
                      busy={busy}
                      nextLabel={step?.label ?? null}
                      onOpen={() => setOpenId(o.id)}
                      onAdvance={() => {
                        if (step === null) return;
                        setError(null);
                        advance.mutate({ id: o.id, status: step.status }, { onError });
                      }}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="orders" />
      </div>

      <OrderDetail
        order={opened}
        money={money}
        riders={activeRiders}
        branchLabel={opened && branchCol.show && opened.branch_id ? branchCol.label(opened.branch_id) : null}
        busy={busy}
        onClose={() => setOpenId(null)}
        onAdvance={(next) => {
          if (opened === null) return;
          setError(null);
          advance.mutate({ id: opened.id, status: next }, { onError });
        }}
        onCancel={() => {
          if (opened === null) return;
          setError(null);
          cancel.mutate({ id: opened.id }, { onError });
        }}
        onAssignRider={(riderId) => {
          if (opened === null) return;
          setError(null);
          assignRider.mutate({ id: opened.id, riderId }, { onError });
        }}
      />

      <TakeOrderModal isOpen={takeModal.isOpen} onClose={takeModal.closeModal} />
    </>
  );
}
