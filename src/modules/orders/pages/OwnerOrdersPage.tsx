import { useState } from "react";
import { Link } from "react-router";

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
import { OrderCard, OrderCardSkeleton } from "../components/OrderCard";
import { useOrderActions, useRiders, useShopOrders } from "../hooks/useOrders";
import type { OrderStageCounts } from "../services/ordersService";

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
  const takeModal = useModal();

  const branchCol = useBranchColumn();

  const rows = orders.data?.data ?? [];
  const pagination = orders.data?.meta.pagination;
  const counts = orders.data?.meta.status_counts as OrderStageCounts | undefined;
  const waitingForARider = (orders.data?.meta.unassigned as number | undefined) ?? 0;

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Action failed.");
  const busy = advance.isPending || cancel.isPending || assignRider.isPending;

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

      {/* One column up to `lg`, two above it. A queue is read top to bottom,
          so the single column is the right default — but a desktop showing one
          narrow strip of cards down the middle of a 1440px screen is half the
          glass spent on nothing. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {orders.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} />)
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center lg:col-span-2 dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">
              {unassigned
                ? "Every delivery has a rider on it."
                : applied.length > 0 || debounced
                  // An empty queue under a filter reads as "there are no
                  // orders" unless it says otherwise.
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
            {!applied.length && !debounced && !status && (
              <p className="mt-2 text-theme-xs text-gray-400">
                They arrive here from your <Link to="/tenant/settings" className="text-brand-500 hover:text-brand-600">online shop</Link>,
                or take one yourself with the button above.
              </p>
            )}
          </div>
        ) : (
          rows.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              money={money}
              riders={activeRiders}
              branchLabel={branchCol.show && o.branch_id ? branchCol.label(o.branch_id) : null}
              busy={busy}
              onAdvance={(next) => { setError(null); advance.mutate({ id: o.id, status: next }, { onError }); }}
              onCancel={() => { setError(null); cancel.mutate({ id: o.id }, { onError }); }}
              onAssignRider={(riderId) => { setError(null); assignRider.mutate({ id: o.id, riderId }, { onError }); }}
            />
          ))
        )}
      </div>

      <Pager pagination={pagination} onPage={setPage} noun="orders" />
      <TakeOrderModal isOpen={takeModal.isOpen} onClose={takeModal.closeModal} />
    </>
  );
}
