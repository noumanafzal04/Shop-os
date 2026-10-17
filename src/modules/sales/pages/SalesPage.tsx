import { useEffect, useRef, useState } from "react";
import { useOnceKey } from "../../../common/onceKey";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import { uuid } from "../../../common/uuid";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import { hasSecondShop } from "../../branches/places";
import { Link, useSearchParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Label from "../../../components/form/Label";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { downloadFile } from "../../../common/api/download";
import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import Pager from "../../../components/ui/pager";
import { ArchivedBefore } from "../../../components/ui/retention/ArchivedBefore";
import { useReturnWorth, useSale, useSaleMutations, useSaleWorth, useSales } from "../hooks/useSales";
import { RefundApproval } from "../components/RefundApproval";
import { NO_APPROVAL, approvalPayload, approvalReady, type ApprovalState } from "../refundApproval";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { useQuery } from "@tanstack/react-query";
import { posService } from "../../pos/services/posService";
import { NoAccess } from "../../../common/ui/NoAccess";
import { deniedReason } from "../../../common/api/denied";
import { useAuthStore } from "../../../stores/authStore";
import { afterTheSale } from "../afterTheSale";
import { voidBlocked } from "../voidBlocked";
import { ApiError } from "../../../common/types/api";
import type { SaleStatus } from "../types";
import { drawerShort } from "../drawerShort";
import { saleParams, VOID_REASONS, type VoidReasonCode } from "../services/salesService";
import { counted } from "../../../common/format/counted";
import {
  DateRangeFilter,
  EMPTY_RANGE,
  FilterBar,
  FilterSelect,
  formatRange,
  type AppliedFilter,
  type DateRange,
} from "../../../components/ui/filters";
import { receiptService } from "../../receipts/services/receiptService";
import { useReceiptTrail } from "../../receipts/hooks/useReceipts";
import { useConnectionStore } from "../../../stores/connectionStore";
import { MONEY_BACK_OFFLINE } from "../../offline/outbox/canSellOffline";
import { numbersToSend, saidWhich, unitsOut, whichUnits } from "../unitsBack";
import { UnitsBack } from "../components/UnitsBack";
import { GoingOutNumbers } from "../components/GoingOutNumbers";
import { changed, differenceOf, linesOut, offersOf, taken, type Replacement } from "../replacements";
import { shopDate, shopDateTime } from "../../../common/format/date";
import { useCounterShift } from "../../pos/hooks/useCounterShift";
import { ShiftNeeded } from "../../pos/components/ShiftNeeded";

const STATUSES = [
  { value: "completed", label: "Completed" },
  { value: "partially_refunded", label: "Partially refunded" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * WHERE THE SALE WAS RUNG. The server has filtered on this since the ledger
 * was written; nothing on screen had ever offered it, so "how much did the
 * shop take at the counter versus online" was a question the app could answer
 * and could not be asked.
 */
const CHANNELS = [
  { value: "pos", label: "At the till" },
  { value: "walk_in", label: "Walk-in" },
  { value: "phone", label: "Phone order" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "online", label: "Online order" },
];

/**
 * How the bill was settled. `deposit`, `trade_in` and `split` are on sales the
 * server writes itself and are worth filtering FOR — a shop reconciling a day
 * needs to find the split-tender ones — but they are never something a client
 * may send as a tender. See PaymentMethod on the server.
 */
const SALE_PAYMENTS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "wallet", label: "Mobile wallet" },
  { value: "credit", label: "On account (khata)" },
  { value: "split", label: "Split across tenders" },
  { value: "deposit", label: "Against a deposit" },
  { value: "trade_in", label: "Part-exchange" },
  { value: "other", label: "Other" },
];

/**
 * A status as a person reads it: "partially_refunded" is a database value.
 *
 * It was printed as it is stored — on the ledger, and on a sale's own sheet,
 * where it was also long enough to run under the close button.
 */
const statusLabel = (status: string): string => {
  const words = status.replace(/_/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
};

const STATUS_COLOR: Record<SaleStatus, "success" | "error" | "warning" | "info"> = {
  completed: "success",
  partially_refunded: "warning",
  refunded: "info",
  cancelled: "error",
};


/**
 * CASH HANDED BACK THAT NO DRAWER WILL COUNT — said before the press.
 *
 * Money goes back through the person's OWN open shift, or through none (the
 * expenses' rule: never into a stranger's drawer). A manager refunding with no
 * shift took the notes from a cashier's till that never heard about it, and
 * the cashier closed short by exactly the refund.
 */
const NO_DRAWER = {
  none: {
    title: "You have no shift open",
    message: "Cash you hand back or take now is not counted by any drawer — the till it goes through will be out by this much at close. Open your own shift first, or choose below the cashier's drawer it comes out of — with a supervisor's PIN.",
  },
  practice: {
    title: "Your open shift is a practice till",
    message: "Real cash handed back or taken is not counted by any real drawer. Close the practice shift and open a real one first.",
  },
} as const;

function noDrawerFor(drawer: string | null | undefined, method: string | undefined): drawer is "none" | "practice" {
  return (drawer === "none" || drawer === "practice") && (method === "cash" || method === "split");
}

export default function SalesPage() {
  const money = useMoney();
  // Seed the filter from ?q= so the ⌘K palette can deep-link into a filtered list.
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(qParam);
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [method, setMethod] = useState("");
  const [seller, setSeller] = useState("");
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const filters = {
    search: debounced,
    status,
    channel,
    payment_method: method,
    served_by: seller,
    from: range.from,
    to: range.to,
  };

  /**
   * WHO RANG IT — offered only where the shop asks the question.
   *
   * The server returns an empty list unless `pos_ask_who_served` is on, so a
   * shop that never records a seller would otherwise get a filter with nothing
   * in it. A control offering no options is not a smaller feature; it is a
   * feature that looks broken.
   */
  // Counter sales need the POS module — an online-only shop sees only history.
  // `?? false`: a missing key is OFF here as everywhere else; this one line
  // used to read it as ON.
  const may = afterTheSale(useAuthStore((st) => st.hasPermission));
  const hasPos = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features?.pos ?? false,
  );
  const sellers = useQuery({
    queryKey: ["pos", "sellers"],
    queryFn: async () => (await posService.sellers()).data,
    staleTime: 30 * 60 * 1000,
    // The sellers list is the till's. Asked by a shop without one, it was a
    // refused request on every load of this screen.
    enabled: hasPos,
  });
  const sellerOptions = (sellers.data ?? []).map((p) => ({ value: p.id, label: p.name }));

  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      // The SAME filters the list is showing. The export has always honoured
      // channel and a date range; the screen simply never had a way to say
      // either, so its own docblock promised "export this month's card sales"
      // over a form that could ask for neither.
      await downloadFile("/sales/export", saleParams({ ...filters, page: undefined }));
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const sales = useSales({ ...filters, page });
  const { cancel, processReturn, exchange } = useSaleMutations();

  /**
   * Money going back OUT needs the server, and the cashier has to hear that
   * before they promise it.
   *
   * A refund is not a sale in reverse. It restocks, it reverses loyalty, it
   * credits a khata — every one of those is a shared figure another till could
   * be moving, so it is the clearest case of the rule the whole offline design
   * turns on: a single till cannot decide this alone.
   *
   * Offline the request fails on its own, so nothing here is what STOPS it.
   * What is missing without this is the REASON, arriving after a cashier has
   * already told a customer they would get their money back.
   */
  const connected = useConnectionStore((s) => s.online && s.reachable);
  // Show a Branch column only for multi-branch shops.
  const shopSettings = useShopSettings();
  // A sale is rung at a SHOP, so the column is for more than one of those —
  // a single counter with a godown behind it has nothing to tell apart here.
  // A Branch column is worth a column once there are two branches to tell
  // apart — not because the plan would allow a second one some day.
  const multiBranch = hasSecondShop(shopSettings.data);
  const cols = multiBranch ? 7 : 6;

  const detailModal = useModal();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  // Every copy of this receipt that has ever left the counter.
  const trail = useReceiptTrail(detailModal.isOpen ? detailId : null);
  const detail = useSale(detailId);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelCode, setCancelCode] = useState<VoidReasonCode>("wrong_item");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  // WHICH numbered units are being handed back, per sale line. See unitsBack.ts.
  const [unitsBack, setUnitsBack] = useState<Record<string, string[]>>({});
  const toggleUnit = (saleItemId: string, serial: string) =>
    setUnitsBack((m) => {
      const now = m[saleItemId] ?? [];

      return { ...m, [saleItemId]: now.includes(serial) ? now.filter((s) => s !== serial) : [...now, serial] };
    });
  // Replay guard for refunds: one key per return ATTEMPT. A double-click or a
  // retry after a timeout resends the same key, so the server replays the
  // original refund instead of paying out (and restocking) twice. Changing the
  // selection — or moving to another sale — starts a genuinely new attempt.
  const returnIdemRef = useRef(uuid());
  const exchangeOnce = useOnceKey();
  useEffect(() => { returnIdemRef.current = uuid(); }, [returnQty, unitsBack, detailId]);
  // Exchange mode: hand items back (returnQty above) + buy replacements, settle the difference.
  const [exchanging, setExchanging] = useState(false);
  // What goes out instead — by SIZE where the thing comes in sizes. See `replacements`.
  const [exItems, setExItems] = useState<Replacement[]>([]);
  // The replacement is a counter sale: today's shift, where the shop asks for one.
  const counterShift = useCounterShift();
  const [exSearch, setExSearch] = useState("");
  const [exMethod, setExMethod] = useState("cash");
  // Whose drawer, and who says yes (the owner, B01) — see refundApproval.ts.
  const [approval, setApproval] = useState<ApprovalState>(NO_APPROVAL);
  const [exAmount, setExAmount] = useState("");
  // What the customer takes INSTEAD is a sale like any other: only what is on sale.
  const exProducts = useProducts({ search: exSearch || undefined, for_sale: true });

  const rows = sales.data?.data ?? [];
  const pagination = sales.data?.meta.pagination;

  const openDetail = (id: string) => {
    setDetailId(id);
    setConfirmingCancel(false);
    setReturning(false);
    setReturnQty({});
    setUnitsBack({});
    setExchanging(false);
    setExItems([]);
    setExSearch("");
    setExMethod("cash");
    setExAmount("");
    setApproval(NO_APPROVAL);
    setCancelReason("");
    detailModal.openModal();
  };

  // ?open=<sale id> — a sale named elsewhere (a customer's statement, a plan)
  // opens straight onto its own sheet, not onto a list to find it in.
  const openParam = searchParams.get("open");
  useEffect(() => {
    if (openParam) openDetail(openParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam]);

  // Units still returnable per sale item = sold - already returned.
  //
  // AS NUMBERS. The server sends a quantity as a decimal STRING ("1.000"),
  // whatever the type says, and `0 + "1.000"` is the text "01.000". One return
  // still came out right, because subtracting coerces it back. A SECOND
  // return of the same line made "01.0001.000", which is not a number: the
  // sheet read "NaN returnable" and the box would not take a quantity — so a
  // customer bringing back the second of two items could not be refunded.
  const remainingToReturn = (saleItemId: string, soldQty: number | string) => {
    const returned = (detail.data?.returns ?? [])
      .flatMap((r) => r.items ?? [])
      .filter((ri) => ri.sale_item_id === saleItemId)
      .reduce((s, ri) => s + Number(ri.quantity), 0);
    return Number(soldQty) - returned;
  };

  /** What a line being handed back has to say about WHICH of its units — and what is ticked. */
  const backOf = (saleItemId: string, soldQty: number | string) => {
    const out = unitsOut(detail.data?.serials, saleItemId);
    const which = whichUnits(out.length, remainingToReturn(saleItemId, soldQty), returnQty[saleItemId] ?? 0);
    // A tick for a unit that is no longer out (a return since) is not a tick.
    const ticked = (unitsBack[saleItemId] ?? []).filter((s) => out.some((u) => u.serial === s));

    return { out, which, ticked };
  };

  /** Every line being handed back has said which units, where it had to. */
  const saidWhichUnits = (detail.data?.items ?? []).every((item) => {
    const { which, ticked } = backOf(item.id, item.quantity);

    return saidWhich(which, ticked.length);
  });

  /** The lines being handed back, each with the numbers it named. */
  const linesBack = () =>
    (detail.data?.items ?? [])
      .filter((item) => (returnQty[item.id] ?? 0) > 0)
      .map((item) => {
        const { which, ticked } = backOf(item.id, item.quantity);
        const serials = numbersToSend(which, ticked);

        return { sale_item_id: item.id, quantity: returnQty[item.id], ...(serials !== undefined ? { serials } : {}) };
      });

  const doReturn = () => {
    if (!detailId || processReturn.isPending) return;
    const items = linesBack();
    if (items.length === 0) return;
    processReturn.mutate(
      // Back the way the server says (back_by): the sale's own method, or cash
      // for a split or khata sale. Sending "split" or "credit" was refused —
      // tester pass 1, B03 / B04.
      { id: detailId, items, refund_method: backWorth?.back_by, idempotency_key: returnIdemRef.current, ...approvalPayload(approval, may.needsApproval) },
      { onSuccess: () => { setReturning(false); setReturnQty({}); setUnitsBack({}); setApproval(NO_APPROVAL); } },
    );
  };

  const doExchange = () => {
    if (!detailId || exchange.isPending) return;
    const return_items = linesBack();
    const items = linesOut(exItems);
    if (return_items.length === 0 || items.length === 0 || !exKnown) return;
    const amount = exAmount !== "" ? Number(exAmount) || 0 : Math.max(0, exDiff);
    exchange.mutate(
      // The replacement is rung where the sale was (pass 1, B30: it said walk_in
      // for a till sale), and once per press (B07).
      { id: detailId, return_items, items, payments: amount > 0 ? [{ method: exMethod, amount }] : [], channel: detail.data?.channel ?? "pos", idempotency_key: exchangeOnce.key, ...approvalPayload(approval, may.needsApproval) },
      { onSuccess: () => { exchangeOnce.renew(); setApproval(NO_APPROVAL); setExchanging(false); setExItems([]); setReturnQty({}); setUnitsBack({}); setExAmount(""); setExSearch(""); } },
    );
  };

  // What stands between this sale and the void — the day, the drawer (Q18, B86).
  const voidHeldBack = detail.data?.void ? voidBlocked(detail.data.void, approval.drawerId !== "", money) : null;

  const doCancel = () => {
    if (!detailId || cancel.isPending || voidHeldBack !== null || !approvalReady(approval, may.voidNeedsApproval)) return;
    cancel.mutate(
      { id: detailId, reason_code: cancelCode, reason: cancelReason.trim() || undefined, ...approvalPayload(approval, may.voidNeedsApproval) },
      {
        onSuccess: () => { setConfirmingCancel(false); setApproval(NO_APPROVAL); },
        // A void moves stock back and takes money out of a drawer. The dialog
        // closing was the only signal, so a refused void looked like a done one.
        ...failed(toast, "That sale was NOT voided — nothing moved."),
      },
    );
  };

  /**
   * Print the receipt. The server decides whether this counts as the original
   * or a stamped copy and logs it either way — a receipt reprinted here is the
   * exact case the trail below exists to make visible.
   */
  const printReceipt = async (copy?: "gift") => {
    if (!detailId || printing) return;
    setPrinting(true);
    try {
      const attempt = await receiptService.printReceipt(detailId, copy ? { copy } : {});
      if (attempt.handoffError) toast.error(`Didn't print — ${attempt.handoffError}`);
      else if (attempt.kind === "gift") toast.success("Gift copy sent to the printer.");
      else if (attempt.kind === "reprint") toast.success("Copy sent — it prints marked as a reprint.");
      else toast.success("Receipt sent to the printer.");
      trail.refetch();
    } catch {
      toast.error("Could not load the receipt.");
    } finally {
      setPrinting(false);
    }
  };

  /** A line of the sale as a person would say it: the design, and which size of it. */
  const lineName = (item: { product_name: string; variant_name: string | null }) =>
    `${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ""}`;

  // ── WHAT IS BEING HANDED BACK IS WORTH — asked of the server ─────────
  //
  // This sheet added the money up itself, tag against tag, with no tax. A
  // kurta bought for 2,625 was a "credit (est.)" of 2,500, the Large that
  // replaced it "2,700", and the difference it told the cashier to collect
  // was 200 where the sale wanted 210 — and refused. The refund sheet beside
  // it never named a figure at all. Both now show the sum the server will
  // pay, from the method that pays it.
  const backAsked = JSON.stringify(
    (detail.data?.items ?? [])
      .filter((item) => (returnQty[item.id] ?? 0) > 0)
      .map((item) => ({ sale_item_id: item.id, quantity: returnQty[item.id] })),
  );
  // Typed a digit at a time; asked once the typing stops.
  const backSettled = useDebouncedValue(backAsked, 250);
  const worth = useReturnWorth(detailId, backSettled, detail.data?.returns?.length ?? 0, (returning || exchanging) && connected);
  /** The answer to what is on screen NOW — not to the selection before it. */
  const backWorth = backSettled === backAsked && !worth.isFetching && worth.data ? worth.data : null;
  const nothingBack = backAsked === "[]";
  // More cash than the drawer holds: refused by the server, said here first ($6).
  const cashBack = backWorth ? (backWorth.handed_back ?? backWorth.refund_total) : 0;
  const shortBy = drawerShort(backWorth, approval.drawerId !== "");

  const exCredit = nothingBack ? 0 : backWorth?.refund_total ?? null;
  // WHAT GOES OUT — asked of the server too. Worked out here, tag against tag,
  // it knew nothing of the shop's automatic promotions: "hand back 1,000"
  // while the sale gave 1,300 change, and the drawer closed 300 over (tester
  // pass 2, B31). The server prices it the way the exchange will ring it.
  const outAsked = JSON.stringify({
    channel: detail.data?.channel ?? "pos", items: linesOut(exItems), payment_method: "cash", amount_paid: 0,
  });
  const outSettled = useDebouncedValue(outAsked, 250);
  const outQ = useSaleWorth(outSettled, exchanging && exItems.length > 0 && connected);
  const outWorth = exItems.length > 0 && outSettled === outAsked && !outQ.isFetching && outQ.data ? outQ.data : null;
  // Until the server has answered there is no figure — not the till's guess.
  const exTotal = exItems.length === 0 ? 0 : outWorth?.total ?? null;
  const exDiff = differenceOf(exTotal ?? 0, exCredit ?? 0);
  const exKnown = exCredit !== null && exTotal !== null;

  const applied: AppliedFilter[] = [
    status && {
      key: "status",
      label: "Status",
      value: STATUSES.find((s) => s.value === status)?.label ?? status,
      onRemove: () => { setStatus(""); setPage(1); },
    },
    channel && {
      key: "channel",
      label: "Channel",
      value: CHANNELS.find((c) => c.value === channel)?.label ?? channel,
      onRemove: () => { setChannel(""); setPage(1); },
    },
    method && {
      key: "payment_method",
      label: "Paid by",
      value: SALE_PAYMENTS.find((m) => m.value === method)?.label ?? method,
      onRemove: () => { setMethod(""); setPage(1); },
    },
    seller && {
      key: "served_by",
      label: "Sold by",
      value: sellerOptions.find((p) => p.value === seller)?.label ?? seller,
      onRemove: () => { setSeller(""); setPage(1); },
    },
    (range.from !== null || range.to !== null) && {
      key: "range",
      label: "Sold",
      value: formatRange(range),
      onRemove: () => { setRange(EMPTY_RANGE); setPage(1); },
    },
  ].filter(Boolean) as AppliedFilter[];

  const clearAll = () => {
    setSearch("");
    setStatus("");
    setChannel("");
    setMethod("");
    setSeller("");
    setRange(EMPTY_RANGE);
    setPage(1);
  };

  return (
    <>
      <PageMeta title="Sales" description="Sales and invoices" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Sales</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Invoices and history</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          {hasPos && (
            <Link to="/tenant/sales/new">
              <Button size="sm">+ New Sale</Button>
            </Link>
          )}
        </div>
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: (value) => { setSearch(value); setPage(1); },
          placeholder: "Search invoice #, slip #, customer…",
          label: "Search sales",
        }}
        applied={applied}
        onClearAll={clearAll}
        results={{ count: pagination?.total, noun: "sales", loading: sales.isLoading }}
      >
        <DateRangeFilter
          label="Any date"
          value={range}
          onChange={(next) => { setRange(next); setPage(1); }}
        />
        <FilterSelect
          label="All statuses"
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={STATUSES}
        />
        <FilterSelect
          label="Any channel"
          value={channel}
          onChange={(value) => { setChannel(value); setPage(1); }}
          options={CHANNELS}
        />
        <FilterSelect
          label="Any payment"
          value={method}
          onChange={(value) => { setMethod(value); setPage(1); }}
          options={SALE_PAYMENTS}
        />
        {sellerOptions.length > 0 && (
          <FilterSelect
            label="Anyone"
            value={seller}
            onChange={(value) => { setSeller(value); setPage(1); }}
            options={sellerOptions}
          />
        )}
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Invoice</th>
                <th className="px-6 py-3 font-medium">Date</th>
                {multiBranch && <th className="px-6 py-3 font-medium">Branch</th>}
                <th className="px-6 py-3 font-medium">Customer</th>
                <th className="px-6 py-3 font-medium">Items</th>
                <th className="px-6 py-3 font-medium">Total</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sales.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={cols} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <TableEmpty from={sales} what="the sales list" colSpan={cols} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {debounced || status ? "No sales match these filters." : "No sales yet — make your first sale!"}
                  </TableEmpty>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.02]"
                    onClick={() => openDetail(s.id)}
                  >
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">
                      {s.invoice_number}
                      {/* The number on the customer's paper. Shown BESIDE the
                          invoice number rather than instead of it: whoever is
                          holding the slip has to be able to confirm this is
                          their sale before it is opened or refunded. */}
                      {s.offline_number && (
                        <span className="mt-0.5 block font-mono text-theme-xs font-normal text-gray-500 dark:text-gray-400">
                          {s.offline_number}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 tabular-nums">{shopDateTime(s.sold_at)}</td>
                    {multiBranch && (
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{s.branch?.name ?? "—"}</td>
                    )}
                    {/* A sale found by phone used to store no name and read
                        "Walk-in" here — beside a credit sale a named trader
                        owed. The server names it now; the phone is the answer
                        for an older sale, or a first-time number. */}
                    <td className="px-6 py-4">{s.customer_name || s.customer_phone || "Walk-in"}</td>
                    <td className="px-6 py-4">{s.items_count}</td>
                    <td className="px-6 py-4">{money(s.total)}</td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color={STATUS_COLOR[s.status]}>
                        {statusLabel(s.status)}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="sales" />

        {/* WHY THE LIST STOPS WHERE IT STOPS. Under the pager, because that
            is where somebody looking for last March arrives. */}
        <div className="px-5 pb-4">
          <ArchivedBefore notice={sales.data?.meta.retention} what="Sales" />
        </div>
      </div>

      {/* Detail modal */}
      <Modal isOpen={detailModal.isOpen} onClose={detailModal.closeModal} className="max-w-xl p-6">
        {detail.isLoading || !detail.data ? (
          <div className="h-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3 pr-10">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                  {detail.data.invoice_number}
                </h3>
                {detail.data.offline_number && (
                  <p className="font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                    Slip {detail.data.offline_number} · rung offline
                  </p>
                )}
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {shopDateTime(detail.data.sold_at)} · {detail.data.channel.replace("_", "-")} ·{" "}
                  {detail.data.payment_method.replace("_", " ")}
                </p>
              </div>
              <Badge color={STATUS_COLOR[detail.data.status]}>
                {statusLabel(detail.data.status)}
              </Badge>
            </div>

            {detail.data.cancel_reason && (
              <div className="mb-4">
                <Alert variant="warning" title="Cancelled" message={detail.data.cancel_reason} />
              </div>
            )}

            <div className="mb-4 max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left text-theme-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {(detail.data.items ?? []).map((item) => (
                    <tr key={item.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-4 py-2">
                        {item.product_name}
                        {item.variant_name && <span className="text-gray-400"> ({item.variant_name})</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {/* As a NUMBER: the server sends "2.000", and a shop
                            reads that as two thousand. 2.5 kg stays 2.5. */}
                        {Number(item.quantity)} × {money(item.unit_price)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{money(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-6 space-y-1 text-right text-theme-sm text-gray-700 dark:text-gray-300">
              <div>Subtotal: {money(detail.data.subtotal)}</div>
              {Number(detail.data.discount) > 0 && <div>Discount: -{money(detail.data.discount)}</div>}
              {/* THE TAX, said. This went Subtotal 3,900 → Total 4,095 with
                  nothing between them, so the sheet a shop opens to answer
                  "why is this more than the price?" could not answer it. */}
              {Number(detail.data.tax) > 0 && <div>Tax: {money(detail.data.tax ?? 0)}</div>}
              <div className="text-base font-bold text-gray-800 dark:text-white/90">
                Total: {money(detail.data.total)}
              </div>
              <div className="text-theme-xs text-gray-500">
                Paid {money(detail.data.amount_paid)}
                {Number(detail.data.change_due) > 0 && ` · Change ${money(detail.data.change_due)}`}
              </div>
            </div>

            {/* Existing refunds on this sale */}
            {(detail.data.returns ?? []).length > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="mb-2 text-theme-xs font-medium uppercase text-gray-400">Refunds</p>
                {(detail.data.returns ?? []).map((r) => (
                  <div key={r.id} className="flex justify-between text-theme-sm text-gray-600 dark:text-gray-300">
                    <span>{r.return_number} · {counted((r.items ?? []).reduce((s, i) => s + Number(i.quantity), 0), "item")}{r.reason ? ` · ${r.reason}` : ""}</span>
                    <span className="font-medium text-error-500">-{money(r.refund_total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Serialized units (IMEI/serial) captured on this sale */}
            {(detail.data.serials ?? []).length > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="mb-2 text-theme-xs font-medium uppercase text-gray-400">Serials / IMEI</p>
                {(detail.data.serials ?? []).map((s) => (
                  <div key={s.id} className="flex justify-between text-theme-sm text-gray-600 dark:text-gray-300">
                    <span className={`font-mono ${s.returned_at ? "text-gray-400 line-through" : ""}`}>{s.serial}</span>
                    <span className="text-gray-400">
                      {s.product_name}
                      {/* A unit that came back has no warranty to quote: it is the shop's again. */}
                      {s.returned_at
                        ? ` · came back ${shopDate(s.returned_at)}`
                        : s.warranty_expires_at ? ` · warranty to ${shopDate(s.warranty_expires_at)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Receipt trail. Shown only once a copy exists — the interesting
                fact is never "this was printed", it's "this was printed
                again", and by whom. */}
            {(trail.data?.length ?? 0) > 1 && (
              <div className="mb-4 rounded-lg border border-warning-200 bg-warning-25 p-3 dark:border-warning-500/30 dark:bg-warning-500/10">
                <p className="mb-2 text-theme-xs font-medium uppercase text-warning-600 dark:text-warning-400">
                  Receipt copies · {(trail.data ?? []).filter((p) => p.kind !== "original").length}
                </p>
                {(trail.data ?? []).map((p) => (
                  <div key={p.id} className="flex flex-wrap justify-between gap-2 text-theme-sm text-gray-600 dark:text-gray-300">
                    <span>
                      {p.kind === "original" ? "Original" : p.kind === "gift" ? "Gift copy" : `Copy ${p.copy_no}`}
                      {p.reason ? ` — ${p.reason}` : ""}
                      {p.status === "failed" ? " · didn't print" : ""}
                    </span>
                    <span className="text-gray-400">
                      {p.user?.name ?? "—"}
                      {p.register?.name ? ` · ${p.register.name}` : ""}
                      {" · "}
                      {shopDateTime(p.printed_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {confirmingCancel ? (
              <div className="space-y-3">
                {/* A coded reason is required: free text can't be tallied, and a
                    per-cashier void count is what catches a ring-and-void. */}
                <Label>Why is this being cancelled?</Label>
                <Select
                  value={cancelCode}
                  options={VOID_REASONS.map((r) => ({ value: r.value, label: r.label }))}
                  onChange={(v) => setCancelCode(v as VoidReasonCode)}
                />
                <Label>Note <span className="font-normal text-gray-400">(optional)</span></Label>
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Shelf label was stale" />
                {/* What leaves the drawer, said before the press. */}
                {(detail.data.void?.cash_back ?? 0) > 0 && (
                  <p data-testid="void-cash-back" className="text-theme-sm text-gray-700 dark:text-gray-300">
                    Hands back <span className="font-semibold">{money(detail.data.void?.cash_back ?? 0)}</span> in cash
                    {detail.data.void?.from_drawer ? " out of the drawer." : " — no drawer took it in, so none is counted."}
                  </p>
                )}
                {detail.data.void && (
                  <RefundApproval
                    purpose="void"
                    needsApproval={may.voidNeedsApproval}
                    ownDrawer={detail.data.void.drawer}
                    drawerNeeded={detail.data.void.from_drawer}
                    value={approval}
                    onChange={setApproval}
                  />
                )}
                {voidHeldBack && (
                  <p data-testid="void-held-back" role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">
                    {voidHeldBack}
                  </p>
                )}
                <div className="flex justify-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => { setConfirmingCancel(false); setApproval(NO_APPROVAL); }}>Back</Button>
                  <Button size="sm" onClick={doCancel} disabled={cancel.isPending || voidHeldBack !== null || !approvalReady(approval, may.voidNeedsApproval)}>
                    {cancel.isPending ? "Cancelling…" : "Confirm cancel — restore stock"}
                  </Button>
                </div>
              </div>
            ) : returning ? (
              <div className="space-y-3">
                <Label>Select quantities to return</Label>
                <div className="space-y-2">
                  {(detail.data.items ?? []).map((item) => {
                    const max = remainingToReturn(item.id, item.quantity);
                    const back = backOf(item.id, item.quantity);
                    return (
                      <div key={item.id}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                            {lineName(item)}
                            <span className="text-theme-xs text-gray-400"> · {max} returnable</span>
                          </span>
                          {/* Named with its SIZE. Two sizes of one design are two
                              boxes, and both were announced as the design. */}
                          <Input
                            aria-label={`How many ${lineName(item)} to return`}
                            type="number" min="0" max={String(max)}
                            value={String(returnQty[item.id] ?? 0)}
                            onChange={(e) => setReturnQty((m) => ({ ...m, [item.id]: Math.max(0, Math.min(max, Number(e.target.value))) }))}
                          />
                        </div>
                        <UnitsBack name={item.product_name} out={back.out} which={back.which} ticked={back.ticked} onToggle={(serial) => toggleUnit(item.id, serial)} />
                      </div>
                    );
                  })}
                </div>
                {/* The money, BEFORE the press. It used to be known only after. */}
                {!nothingBack && backWorth && (backWorth.off_khata ?? 0) > 0 && (
                  <div data-testid="refund-off-khata" className="flex items-baseline justify-between rounded-lg border border-gray-200 px-3 py-2 text-theme-sm dark:border-gray-800">
                    <span className="text-gray-500 dark:text-gray-400">Comes off {detail.data?.customer_name ?? "the customer"}'s khata</span>
                    <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(backWorth.off_khata ?? 0)}</span>
                  </div>
                )}
                {!nothingBack && (
                  <div data-testid="refund-worth" className="flex items-baseline justify-between rounded-lg border border-gray-200 px-3 py-2 text-theme-sm dark:border-gray-800">
                    <span className="text-gray-500 dark:text-gray-400">Goes back to the customer</span>
                    <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">
                      {backWorth
                        ? <>{money(backWorth.handed_back ?? backWorth.refund_total)}{backWorth.refund_tax > 0 && (backWorth.off_khata ?? 0) === 0 && <span className="ml-1.5 font-normal text-theme-xs text-gray-400">incl. {money(backWorth.refund_tax)} tax</span>}</>
                        : worth.error instanceof ApiError ? <span className="font-normal text-error-500">{worth.error.message}</span> : "…"}
                    </span>
                  </div>
                )}
                {backWorth && approval.drawerId === "" && (backWorth.handed_back ?? backWorth.refund_total) > 0 && noDrawerFor(backWorth.drawer, backWorth.back_by ?? detail.data?.payment_method) && (
                  <div data-testid="refund-no-drawer">
                    <Alert variant="warning" title={NO_DRAWER[backWorth.drawer as "none" | "practice"].title} message={NO_DRAWER[backWorth.drawer as "none" | "practice"].message} />
                  </div>
                )}
                {shortBy !== null && (
                  <div data-testid="refund-more-than-drawer">
                    <Alert
                      variant="warning"
                      title="More than the drawer holds"
                      message={`The drawer holds ${money(shortBy)} — this hands back ${money(cashBack)} in cash. Put cash in the drawer first, or hand it back from a drawer that holds it.`}
                    />
                  </div>
                )}
                {!nothingBack && <RefundApproval needsApproval={may.needsApproval} ownDrawer={backWorth?.drawer} value={approval} onChange={setApproval} />}
                {processReturn.error instanceof ApiError && (
                  <Alert variant="error" title="Return failed" message={processReturn.error.message} />
                )}
                {!connected && (
                  <Alert
                    variant="warning"
                    title="Refunds need the connection"
                    message={`${MONEY_BACK_OFFLINE.refund.reason} ${MONEY_BACK_OFFLINE.refund.fix}`}
                  />
                )}
                <div className="flex justify-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => setReturning(false)}>Back</Button>
                  <Button size="sm" onClick={doReturn} disabled={!connected || processReturn.isPending || Object.values(returnQty).every((q) => !q) || !saidWhichUnits || shortBy !== null || !approvalReady(approval, may.needsApproval)}>
                    {processReturn.isPending ? "Processing…" : "Refund & restock"}
                  </Button>
                </div>
              </div>
            ) : exchanging ? (
              <div className="space-y-4">
                <div>
                  <Label>1 · Items to hand back</Label>
                  <div className="mt-1 space-y-2">
                    {(detail.data.items ?? []).map((item) => {
                      const max = remainingToReturn(item.id, item.quantity);
                      const back = backOf(item.id, item.quantity);
                      return (
                        <div key={item.id}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                              {lineName(item)}
                              <span className="text-theme-xs text-gray-400"> · {max} returnable</span>
                            </span>
                            <Input type="number" min="0" max={String(max)}
                              aria-label={`How many ${lineName(item)} to hand back`}
                              value={String(returnQty[item.id] ?? 0)}
                              onChange={(e) => setReturnQty((m) => ({ ...m, [item.id]: Math.max(0, Math.min(max, Number(e.target.value))) }))} />
                          </div>
                          <UnitsBack name={item.product_name} out={back.out} which={back.which} ticked={back.ticked} onToggle={(serial) => toggleUnit(item.id, serial)} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label>2 · Replacement items</Label>
                  <Input placeholder="Search products…" value={exSearch} onChange={(e) => setExSearch(e.target.value)} />
                  {exSearch && deniedReason(exProducts.error) && (
                    <div className="mt-1">
                      <NoAccess reason={deniedReason(exProducts.error)!} what="the product list" />
                    </div>
                  )}
                  {exSearch && !deniedReason(exProducts.error) && (
                    <div data-testid="exchange-offers" className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
                      {/* Each SIZE is its own row — with how many are left, and
                          unpressable when there are none. The design on its own
                          is never offered: the server would ask "which size?",
                          and this sheet had nowhere to answer. */}
                      {(exProducts.data?.data ?? []).slice(0, 8).flatMap((p) => offersOf(p)).map((offer) => (
                        <button key={offer.key} type="button" disabled={offer.whyNot !== null} title={offer.whyNot ?? undefined}
                          onClick={() => { setExItems((xs) => taken(xs, offer)); setExSearch(""); }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-theme-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent dark:hover:bg-white/5">
                          <span className="truncate text-gray-700 dark:text-gray-300">{offer.name}</span>
                          <span className="flex shrink-0 items-center gap-2 tabular-nums">
                            {offer.left !== null && (
                              <span className="text-theme-xs text-gray-400">{offer.left > 0 ? `${Number(offer.left.toFixed(3))} left` : "none left"}</span>
                            )}
                            <span className="text-gray-400">{money(offer.price)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {exItems.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {exItems.map((x) => (
                        <div key={x.key}>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{x.name} · {money(x.price)}</span>
                            <div className="flex items-center gap-1">
                              <button type="button" aria-label={`One fewer ${x.name}`} className="h-6 w-6 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" onClick={() => setExItems((xs) => changed(xs, x.key, -1))}>−</button>
                              <span className="w-6 text-center tabular-nums text-gray-800 dark:text-white/90">{x.quantity}</span>
                              <button type="button" aria-label={`One more ${x.name}`} className="h-6 w-6 rounded bg-brand-500 text-white" onClick={() => setExItems((xs) => changed(xs, x.key, 1))}>+</button>
                            </div>
                          </div>
                          {x.tracks_serial && (
                            <GoingOutNumbers
                              productId={x.product_id}
                              name={x.name}
                              quantity={x.quantity}
                              value={x.serials}
                              onChange={(serials) => setExItems((xs) => xs.map((y) => (y.key === x.key ? { ...y, serials } : y)))}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Not estimates any more: the credit is the server's own sum
                    and the replacement is the till's bill, tax and all. */}
                <div data-testid="exchange-sums" className="rounded-lg border border-gray-200 p-3 text-theme-sm tabular-nums dark:border-gray-800">
                  <div className="flex justify-between text-gray-500">
                    <span>Credit for what comes back</span>
                    <span>{exCredit !== null ? money(exCredit) : worth.error instanceof ApiError ? <span className="text-error-500">{worth.error.message}</span> : "…"}</span>
                  </div>
                  <div className="flex justify-between text-gray-500"><span>What goes out comes to</span><span>{exTotal !== null ? money(exTotal) : "…"}</span></div>
                  <div className="mt-1 flex justify-between font-semibold text-gray-800 dark:text-white/90">
                    <span>{exDiff >= 0 ? "Difference to collect" : "Hand back in cash"}</span>
                    <span>{exKnown ? money(Math.abs(exDiff)) : "…"}</span>
                  </div>
                  {exDiff > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <select value={exMethod} onChange={(e) => setExMethod(e.target.value)}
                        className="h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                      </select>
                      <div className="flex-1"><Input type="number" min="0" placeholder={String(exDiff)} value={exAmount} onChange={(e) => setExAmount(e.target.value)} /></div>
                    </div>
                  )}
                </div>

                {worth.data && worth.data.drawer && worth.data.drawer !== "open" && approval.drawerId === "" && exKnown && (exDiff < 0 || (exDiff > 0 && exMethod === "cash")) && (
                  <div data-testid="exchange-no-drawer">
                    <Alert variant="warning" title={NO_DRAWER[worth.data.drawer].title} message={NO_DRAWER[worth.data.drawer].message} />
                  </div>
                )}
                {exItems.length > 0 && <RefundApproval needsApproval={may.needsApproval} ownDrawer={worth.data?.drawer} value={approval} onChange={setApproval} />}
                {exchange.error instanceof ApiError && (
                  <Alert variant="error" title="Exchange failed" message={exchange.error.message} />
                )}
                {!connected && (
                  <Alert
                    variant="warning"
                    title="Exchanges need the connection"
                    message={`${MONEY_BACK_OFFLINE.exchange.reason} ${MONEY_BACK_OFFLINE.exchange.fix}`}
                  />
                )}
                <ShiftNeeded why={counterShift.why} />
                <div className="flex justify-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => setExchanging(false)}>Back</Button>
                  <Button size="sm" onClick={doExchange} disabled={!counterShift.ready || !connected || exchange.isPending || Object.values(returnQty).every((q) => !q) || exItems.length === 0 || !saidWhichUnits || !exKnown || !approvalReady(approval, may.needsApproval)}>
                    {exchange.isPending ? "Processing…" : "Complete exchange"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
              {/* Why there is no Cancel sale: its day is over (Q18). Said, not just missing. */}
              {may.voids && detail.data.status === "completed" && detail.data.void?.open === false && (
                <p data-testid="void-closed" className="mb-3 text-right text-theme-xs text-gray-500 dark:text-gray-400">
                  {detail.data.void.why_not}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-3">
                <Button size="sm" variant="outline" disabled={printing} onClick={() => printReceipt()}>
                  {printing ? "Printing…" : (trail.data?.length ?? 0) > 0 ? "Print a copy" : "Print receipt"}
                </Button>
                <Button size="sm" variant="outline" disabled={printing} onClick={() => printReceipt("gift")}>
                  Gift receipt
                </Button>
                {/* Only what this person may do to a sale already rung — see
                    afterTheSale.ts. A cashier was offered all three and
                    refused each, after choosing a reason. */}
                {may.refunds && (detail.data.status === "completed" || detail.data.status === "partially_refunded") && (
                  <Button size="sm" variant="outline" onClick={() => setReturning(true)}>
                    Return / Refund
                  </Button>
                )}
                {/* An exchange rings a new counter sale (POST …/exchange needs `pos`). */}
                {may.exchanges && hasPos && (detail.data.status === "completed" || detail.data.status === "partially_refunded") && (
                  <Button size="sm" variant="outline" onClick={() => setExchanging(true)}>
                    Exchange
                  </Button>
                )}
                {/* Only while its own day is going (Q18) — the server says so in `void`. */}
                {may.voids && detail.data.status === "completed" && detail.data.void?.open === true && (
                  <Button size="sm" variant="outline" onClick={() => { setApproval(NO_APPROVAL); setConfirmingCancel(true); }}>
                    Cancel sale
                  </Button>
                )}
                <Button size="sm" onClick={detailModal.closeModal}>Close</Button>
              </div>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
