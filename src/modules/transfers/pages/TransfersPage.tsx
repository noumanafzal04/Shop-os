import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import { NoAccess } from "../../../common/ui/NoAccess";
import { deniedReason } from "../../../common/api/denied";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import Pager from "../../../components/ui/pager";
import { ApiError } from "../../../common/types/api";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useAuthStore } from "../../../stores/authStore";
import { useBranches } from "../../branches/hooks/useBranches";
import { byKind, isWarehouse } from "../../branches/places";
import {
  useCancelTransfer,
  useCreateTransfer,
  useReceiveTransfer,
  useSendTransfer,
  useSettleTransfer,
  useStockByPlace,
  useTransfers,
} from "../hooks/useTransfers";
import {
  transferService,
  type ShortOutcome,
  type ShortReason,
  type StockTransfer,
  type TransferStatus,
  type TransfersWaiting,
} from "../services/transferService";
import type { StockRow } from "../services/stockByPlaceService";
import {
  askedSays,
  countedPayload,
  countProblem,
  lineName,
  qty,
  SHORT_REASONS,
  shortLines,
  shortSays,
  statusSays,
  unitsSent,
  whatCanBeDone,
  type Counted,
} from "../transferWords";
import { shopDateTime } from "../../../common/format/date";

/** One thing being sent: a product, or one size of it. */
interface Line {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  /** On hand at the place it is being sent from, when the screen knows. */
  held: number | null;
  quantity: string;
}

/** The box items are searched in — named once, because the form returns the cursor to it. */
const FIND = "transfer-find";

/** A row is a card on a phone and a table row from `sm` up; a cell follows it. */
const ROW = "block px-5 py-4 sm:table-row sm:p-0";
const CELL = "block py-0.5 sm:table-cell sm:px-6 sm:py-4";

const FILTERS: Array<{ value: TransferStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "requested", label: "Asked for" },
  { value: "in_transit", label: "On its way" },
  { value: "short", label: "Received short" },
  { value: "completed", label: "Received" },
  { value: "cancelled", label: "Called back" },
];

/**
 * Stock moving between places — a warehouse to a shop, one branch to another.
 *
 * ── It is sent, and then it is received ────────────────────────────────
 *
 * This screen had one button, "Transfer stock", and the stock was in the
 * other place the moment it was pressed. Thirty cartons went on a van,
 * twenty-eight came off it, and the record said thirty arrived.
 *
 * So a transfer is SENT — it leaves the sender's shelf and is on nobody's —
 * and the other end counts it in. Where less arrived than left, the receiver
 * says how much and why, and the sender says what became of the rest. "Move
 * now" is still here for the godown behind the shop, where the person moving
 * the cartons is standing at both ends.
 *
 * It also could not send a product sold in sizes at all: the form asked for a
 * product and a quantity, and the server — rightly — wanted to know WHICH
 * size. Each size is its own line now.
 */
export default function TransfersPage() {
  const branches = useBranches();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<TransferStatus | "">("");
  const transfers = useTransfers(page, status || undefined);
  const create = useCreateTransfer();
  const sendAsked = useSendTransfer();
  const receive = useReceiveTransfer();
  const settle = useSettleTransfer();
  const cancel = useCancelTransfer();
  const toast = useToast();
  const confirm = useConfirm();
  // Moving in one step acts at BOTH ends, which the owner may and a keeper
  // pinned to one place may not. The server decides; this only keeps a button
  // it would refuse off the screen.
  const anywhere = useAuthStore((s) => s.hasPermission("inventory.any_place"));
  // The place a keeper works at: the one they are assigned to, and Main when
  // they are assigned to none — the answer the server gives.
  const assigned = useAuthStore((s) => s.user?.branch_id);

  // ── a new transfer ────────────────────────────────────────────────
  // A link from the reorder list or the stock screen arrives as
  // ?from=…&to=…&product=…, with the form already open on it.
  const [adding, setAdding] = useState(params.has("from") || params.has("product"));
  const [fromId, setFromId] = useState(params.get("from") ?? "");
  const [toId, setToId] = useState(params.get("to") ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState(params.get("product") ?? "");

  // ── answering a request ───────────────────────────────────────────
  const [answering, setAnswering] = useState<StockTransfer | null>(null);
  const [going, setGoing] = useState<Record<string, string>>({});

  // ── counting one in, and settling one ─────────────────────────────
  const [receiving, setReceiving] = useState<StockTransfer | null>(null);
  const [counted, setCounted] = useState<Record<string, Counted>>({});
  const [settling, setSettling] = useState<StockTransfer | null>(null);

  const places = useMemo(() => (branches.data ?? []).filter((b) => b.is_active), [branches.data]);
  const placeOptions = useMemo(() => {
    const { shops, warehouses } = byKind(places);

    return [...shops, ...warehouses].map((b) => ({ value: b.id, label: isWarehouse(b) ? `${b.name} — warehouse` : b.name }));
  }, [places]);
  const placeName = (id: string) => places.find((b) => b.id === id)?.name ?? "that place";
  const ownPlace = assigned ?? places.find((b) => b.is_default)?.id ?? null;
  // Send, ask, or move — whichever of them this person may do between these two.
  const may = whatCanBeDone(fromId, toId, { anywhere, ownPlace });

  // What can be sent is what is HELD — so the picker reads the stock screen's
  // own list, which says how much of each product and each size every place
  // has, in one request.
  const found = useStockByPlace({ search: search.trim(), at: fromId || undefined }, adding && search.trim().length >= 2);
  const results: StockRow[] = found.data?.data ?? [];

  const waiting = (transfers.data?.meta?.waiting ?? { to_send: 0, to_receive: 0, to_settle: 0 }) as TransfersWaiting;
  const rows = transfers.data?.data ?? [];

  const pick = (to: TransferStatus | "") => { setStatus(to); setPage(1); };

  const open = () => {
    setFromId(""); setToId(""); setNotes(""); setLines([]); setSearch("");
    setAdding(true);
  };
  const close = () => {
    setAdding(false);
    // The link that opened the form is spent; leaving it would reopen it.
    if (params.size > 0) setParams({}, { replace: true });
  };

  const add = (p: StockRow, size?: { id: string; name: string; places: Record<string, number> }) => {
    const key = `${p.id}:${size?.id ?? ""}`;
    const held = fromId ? Number((size?.places ?? p.places)[fromId] ?? 0) : null;

    setLines((ls) => (ls.some((l) => l.key === key)
      ? ls
      : [...ls, { key, product_id: p.id, variant_id: size?.id ?? null, name: size ? `${p.name} — ${size.name}` : p.name, held, quantity: "1" }]));
    // Chosen: the list goes away and the box is ready for the next thing.
    // Left open, it sat on top of the line it had just added — the choice
    // looked as though it had not been taken.
    setSearch("");
    document.getElementById(FIND)?.focus();
  };
  const setQty = (key: string, quantity: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity } : l)));
  const drop = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const canSubmit = fromId !== "" && toId !== "" && fromId !== toId && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);

  const submit = (mode: "send" | "move" | "request") => {
    create.mutate(
      {
        mode,
        from_branch_id: fromId,
        to_branch_id: toId,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: Number(l.quantity) })),
      },
      {
        onSuccess: (res) => { toast.success(res.message); close(); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "The transfer could not be saved."),
      },
    );
  };

  const startAnswering = (t: StockTransfer) => {
    // Every box starts at what was asked for; the sender lowers what cannot be spared.
    setGoing(Object.fromEntries((t.items ?? []).map((i) => [i.id, qty(i.quantity_requested ?? i.quantity)])));
    setAnswering(t);
  };
  const goingTotal = Object.values(going).reduce((n, v) => n + (Number(v) || 0), 0);
  const confirmSend = () => {
    if (!answering || goingTotal <= 0) return;
    const changed = (answering.items ?? [])
      .filter((i) => Number(going[i.id]) !== Number(i.quantity_requested ?? i.quantity))
      .map((i) => ({ id: i.id, quantity: Number(going[i.id]) || 0 }));

    sendAsked.mutate(
      { id: answering.id, items: changed },
      {
        onSuccess: (res) => { toast.success(res.message); setAnswering(null); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "The transfer could not be sent."),
      },
    );
  };

  const startReceiving = (t: StockTransfer) => {
    // Every box starts at what was sent: most transfers arrive whole, and the
    // person counting changes only the lines that did not.
    setCounted(Object.fromEntries((t.items ?? []).map((i) => [i.id, { received: qty(i.quantity), reason: "" as const }])));
    setReceiving(t);
  };
  const problem = receiving ? countProblem(receiving.items ?? [], counted) : null;
  const confirmReceive = () => {
    if (!receiving || problem) return;
    receive.mutate(
      { id: receiving.id, ...countedPayload(receiving.items ?? [], counted) },
      {
        onSuccess: (res) => { toast.success(res.message); setReceiving(null); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "The transfer could not be received."),
      },
    );
  };

  const confirmSettle = (outcome: ShortOutcome) => {
    if (!settling) return;
    settle.mutate(
      { id: settling.id, outcome },
      {
        onSuccess: (res) => { toast.success(res.message); setSettling(null); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "The shortage could not be settled."),
      },
    );
  };

  const callBack = async (t: StockTransfer) => {
    // A request has moved nothing: declining it (or withdrawing it) only
    // answers it. Stock on the road goes back on the sender's shelf.
    const asked = t.status === "requested";
    if (!(await confirm({
      title: asked ? `Decline ${t.reference}?` : `Call back ${t.reference}?`,
      message: asked
        ? `Nothing has been sent, and nothing will be. ${t.to_branch?.name ?? "The place that asked"} will see it was declined.`
        : `Everything on it goes back on the shelf at ${t.from_branch?.name ?? "the sender"}. Use this when it never left.`,
      tone: "danger",
    }))) return;

    cancel.mutate(t.id, {
      onSuccess: (res) => toast.success(res.message),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "The transfer could not be called back."),
    });
  };

  const printSlip = (t: StockTransfer) => {
    transferService.printSlip(t.id).catch(() => toast.error("The slip could not be printed."));
  };

  return (
    <>
      <PageMeta title="Stock transfers" description="Stock moving between your branches and warehouses" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Stock transfers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Stock sent from one place and counted in at another</p>
        </div>
        <Button size="sm" onClick={open} disabled={placeOptions.length < 2}>+ New transfer</Button>
      </div>

      {/* A refused branch list left this button greyed out with no reason
          given — indistinguishable from a shop that only has one place. */}
      {deniedReason(branches.error) && (
        <div className="mb-6">
          <NoAccess reason={deniedReason(branches.error)!} what="the list of places" />
        </div>
      )}

      {/* What is waiting on somebody HERE. Each is also the filter that shows them. */}
      {(waiting.to_send > 0 || waiting.to_receive > 0 || waiting.to_settle > 0) && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="transfers-waiting">
          {waiting.to_send > 0 && (
            <button
              type="button"
              onClick={() => pick("requested")}
              data-testid="waiting-to-send"
              className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-left transition hover:border-brand-300 dark:border-brand-500/30 dark:bg-brand-500/10"
            >
              <span className="block text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{waiting.to_send}</span>
              <span className="block text-sm text-gray-600 dark:text-gray-300">asked for — waiting to be sent</span>
            </button>
          )}
          {waiting.to_receive > 0 && (
            <button
              type="button"
              onClick={() => pick("in_transit")}
              data-testid="waiting-to-receive"
              className="rounded-2xl border border-blue-light-200 bg-blue-light-50 px-5 py-4 text-left transition hover:border-blue-light-300 dark:border-blue-light-500/30 dark:bg-blue-light-500/10"
            >
              <span className="block text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{waiting.to_receive}</span>
              <span className="block text-sm text-gray-600 dark:text-gray-300">on {waiting.to_receive === 1 ? "its" : "their"} way — to be counted in</span>
            </button>
          )}
          {waiting.to_settle > 0 && (
            <button
              type="button"
              onClick={() => pick("short")}
              data-testid="waiting-to-settle"
              className="rounded-2xl border border-warning-200 bg-warning-50 px-5 py-4 text-left transition hover:border-warning-300 dark:border-warning-500/30 dark:bg-warning-500/10"
            >
              <span className="block text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{waiting.to_settle}</span>
              <span className="block text-sm text-gray-600 dark:text-gray-300">arrived short — the difference is not settled</span>
            </button>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show transfers">
        {FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            aria-pressed={status === f.value}
            onClick={() => pick(f.value)}
            className={`rounded-full border px-3.5 py-1.5 text-theme-sm font-medium transition ${
              status === f.value
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-800 dark:bg-transparent dark:text-gray-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          {/* ONE LIST, TWO SHAPES. From `sm` up it is a table. On a phone —
              which is what the person counting a van in is usually holding —
              six columns squeezed "E2E Godown → Main" onto four lines, so each
              row stands as its own card there: the same cells, stacked. */}
          <table className="min-w-full text-sm">
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-gray-200 text-left text-theme-xs uppercase text-gray-400 dark:border-gray-800">
                <th className="px-6 py-3 font-medium">Transfer</th>
                <th className="px-6 py-3 font-medium">From → To</th>
                <th className="px-6 py-3 font-medium">Items</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Sent</th>
                <th className="px-6 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {transfers.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-6 py-4"><div className="h-5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <TableEmpty from={transfers} what="the transfers" colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    {status === "" ? "No transfers yet." : `No transfers that are ${FILTERS.find((f) => f.value === status)?.label.toLowerCase()}.`}
                  </TableEmpty>
                </tr>
              ) : (
                rows.map((t) => {
                  const says = statusSays(t.status);
                  const short = shortSays(t);

                  return (
                    <tr key={t.id} data-testid="transfer-row" data-status={t.status} className={ROW}>
                      <td className={CELL}>
                        <span className="block font-medium text-gray-800 dark:text-white/90">{t.reference}</span>
                        {t.notes && <span className="block max-w-[14rem] truncate text-theme-xs text-gray-400" title={t.notes}>{t.notes}</span>}
                      </td>
                      <td className={`${CELL} text-gray-600 dark:text-gray-300`}>
                        <span className="inline-flex flex-wrap items-center gap-x-2">
                          <span>{t.from_branch?.name ?? "—"}</span>
                          <span className="text-gray-400" aria-label="to">→</span>
                          <span>{t.to_branch?.name ?? "—"}</span>
                        </span>
                      </td>
                      <td className={`${CELL} text-gray-600 dark:text-gray-300`}>
                        <span className="block whitespace-nowrap">
                          {t.items?.length ?? 0} line{(t.items?.length ?? 0) === 1 ? "" : "s"} · {qty(unitsSent(t))} unit{unitsSent(t) === 1 ? "" : "s"}
                        </span>
                        {short && (
                          <span className={`block text-theme-xs ${short.open ? "text-warning-600 dark:text-warning-400" : "text-gray-400"}`}>
                            {short.text}
                          </span>
                        )}
                      </td>
                      <td className={CELL}>
                        <span title={says.hint}><Badge size="sm" color={says.color}>{says.label}</Badge></span>
                      </td>
                      <td className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}>
                        <span className="block">{shopDateTime(t.sent_at ?? t.created_at)}</span>
                        {t.status === "requested"
                          ? t.requester?.name && <span className="block text-theme-xs text-gray-400">asked by {t.requester.name}</span>
                          : t.sender?.name && <span className="block text-theme-xs text-gray-400">by {t.sender.name}</span>}
                      </td>
                      <td className={`${CELL} pt-3 sm:pt-4`}>
                        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
                          {t.can?.send && <Button size="sm" onClick={() => startAnswering(t)}>Send</Button>}
                          {t.can?.receive && <Button size="sm" onClick={() => startReceiving(t)}>Receive</Button>}
                          {t.can?.settle && <Button size="sm" onClick={() => setSettling(t)}>Settle</Button>}
                          {t.can?.cancel && (
                            // Each of the three takes something back, and is coloured as it.
                            <Button size="sm" variant="danger" onClick={() => callBack(t)}>
                              {/* The place asked declines; the place asking withdraws; stock on the road is called back. */}
                              {t.status !== "requested" ? "Call back" : t.can.send ? "Decline" : "Withdraw"}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => printSlip(t)} aria-label={`Print the slip for ${t.reference}`}>Slip</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager pagination={transfers.data?.meta?.pagination} onPage={setPage} noun="transfers" />
      </div>

      {/* ── New transfer ─────────────────────────────────────────────── */}
      <Modal isOpen={adding} onClose={close} className="max-w-2xl p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">New transfer</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>From <span className="text-error-500">*</span></Label>
            <Select
              aria-label="Send from"
              options={placeOptions.filter((o) => o.value !== toId)}
              value={fromId}
              onChange={(v) => { setFromId(v); setLines([]); }}
              placeholder="Where it is now"
            />
          </div>
          <div>
            <Label>To <span className="text-error-500">*</span></Label>
            <Select
              aria-label="Send to"
              options={placeOptions.filter((o) => o.value !== fromId)}
              value={toId}
              onChange={setToId}
              placeholder="Where it is going"
            />
          </div>
        </div>

        <div className="mt-5">
          <Label htmlFor={FIND}>Add items</Label>
          <div className="relative">
            <Input
              id={FIND}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={fromId ? `Search what ${placeName(fromId)} holds — name, SKU or barcode…` : "Choose where it is coming from first"}
              disabled={!fromId}
            />
            {fromId && search.trim().length >= 2 && (
              <div data-testid="transfer-results" className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {found.isLoading ? (
                  <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
                ) : results.length === 0 ? (
                  <ListEmpty from={found} what="the stock">
                    <div className="px-4 py-3 text-sm text-gray-400">Nothing in stock by that name.</div>
                  </ListEmpty>
                ) : (
                  results.map((p) => {
                    // A product sold in sizes holds its stock on the sizes,
                    // so each size is a thing to send and the product is not.
                    const things = p.sizes.length > 0
                      ? p.sizes.map((s) => ({ key: `${p.id}:${s.id}`, name: `${p.name} — ${s.name}`, held: Number(s.places[fromId] ?? 0), pick: () => add(p, s) }))
                      : [{ key: `${p.id}:`, name: p.name, held: Number(p.places[fromId] ?? 0), pick: () => add(p) }];

                    return things.map((thing) => (
                      <button
                        key={thing.key}
                        type="button"
                        onClick={thing.pick}
                        disabled={thing.held <= 0 || lines.some((l) => l.key === thing.key)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.04]"
                      >
                        <span className="text-gray-800 dark:text-white/90">{thing.name}</span>
                        <span className="shrink-0 text-theme-xs tabular-nums text-gray-400">
                          {thing.held > 0 ? `${qty(thing.held)} here` : "none here"}
                        </span>
                      </button>
                    ));
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400 dark:border-gray-800">
              No items added yet.
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.key} data-testid="transfer-line" className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-2.5 dark:border-gray-800">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-800 dark:text-white/90">{l.name}</span>
                  {l.held !== null && (
                    <span className={`block text-theme-xs ${Number(l.quantity) > l.held ? "text-error-500" : "text-gray-400"}`}>
                      {Number(l.quantity) > l.held ? `Only ${qty(l.held)} at ${placeName(fromId)}` : `${qty(l.held)} at ${placeName(fromId)}`}
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={l.quantity}
                  aria-label={`Quantity of ${l.name}`}
                  onChange={(e) => setQty(l.key, e.target.value)}
                  className="h-9 w-24 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm tabular-nums focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                />
                <button type="button" onClick={() => drop(l.key)} className="text-gray-400 hover:text-error-500" aria-label={`Remove ${l.name}`}>
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4">
          <Label htmlFor="transfer-notes">Notes</Label>
          <Input id="transfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — what this is for" />
        </div>

        <p className="mt-4 text-theme-xs text-gray-500 dark:text-gray-400" data-testid="transfer-verbs">
          {may.ask ? (
            <>
              <strong>Ask for it</strong> sends {placeName(fromId)} a request. Nothing moves until they send it — and they may send less than you asked.
            </>
          ) : fromId !== "" && toId !== "" && !may.send ? (
            // Neither end is theirs: said, rather than leaving a dead button.
            <>You work at {ownPlace ? placeName(ownPlace) : "another place"}, so you can send from there or ask for stock to be sent there.</>
          ) : (
            <>
              <strong>Send</strong> puts it on the road: it leaves {fromId ? placeName(fromId) : "the sender"} now and is counted in at the other end.
              {may.move && <> <strong>Move now</strong> puts it straight on the other shelf — for when it is already there.</>}
            </>
          )}
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button size="sm" variant="outline" onClick={close}>Cancel</Button>
          {may.move && (
            <Button size="sm" variant="outline" onClick={() => submit("move")} disabled={!canSubmit || create.isPending}>
              Move now
            </Button>
          )}
          {may.ask ? (
            <Button size="sm" onClick={() => submit("request")} disabled={!canSubmit || create.isPending}>
              {create.isPending ? "Saving…" : "Ask for it"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => submit("send")} disabled={!canSubmit || !may.send || create.isPending}>
              {create.isPending ? "Saving…" : "Send"}
            </Button>
          )}
        </div>
      </Modal>

      {/* ── Answer a request ─────────────────────────────────────────── */}
      <Modal isOpen={answering !== null} onClose={() => setAnswering(null)} className="max-w-2xl p-6">
        {answering && (
          <>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Send {answering.reference}</h3>
            <p className="mb-4 mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              {answering.to_branch?.name} asked {answering.from_branch?.name} for this. Lower what cannot be spared; it leaves the shelf when you press Send.
            </p>

            <div className="space-y-2">
              {(answering.items ?? []).map((item) => (
                <div key={item.id} data-testid="send-line" className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-800 dark:text-white/90">{lineName(item)}</span>
                    <span className="block text-theme-xs text-gray-400">{qty(item.quantity_requested ?? item.quantity)} asked for</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={going[item.id] ?? ""}
                    aria-label={`How many ${lineName(item)} to send`}
                    onChange={(e) => setGoing((g) => ({ ...g, [item.id]: e.target.value }))}
                    className="h-9 w-24 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm tabular-nums focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                  />
                </div>
              ))}
            </div>

            {goingTotal <= 0 && (
              <p className="mt-3 text-theme-sm text-error-500">Nothing is being sent. Decline the request instead, so {answering.to_branch?.name} knows.</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button size="sm" variant="outline" onClick={() => setAnswering(null)}>Cancel</Button>
              <Button size="sm" onClick={confirmSend} disabled={goingTotal <= 0 || sendAsked.isPending}>
                {sendAsked.isPending ? "Sending…" : "Send"}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Count one in ─────────────────────────────────────────────── */}
      <Modal isOpen={receiving !== null} onClose={() => setReceiving(null)} className="max-w-2xl p-6">
        {receiving && (
          <>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Receive {receiving.reference}</h3>
            <p className="mb-4 mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              From {receiving.from_branch?.name} to {receiving.to_branch?.name}. Change only the lines that did not arrive whole.
            </p>

            <div className="space-y-2">
              {(receiving.items ?? []).map((item) => {
                const row = counted[item.id] ?? { received: "", reason: "" };
                const isShort = row.received.trim() !== "" && Number(row.received) < Number(item.quantity);

                return (
                  <div key={item.id} data-testid="receive-line" className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-800 dark:text-white/90">{lineName(item)}</span>
                        <span className="block text-theme-xs text-gray-400">
                          {askedSays(item, true) ?? `${qty(item.quantity)} sent`}
                          {(item.lots ?? []).map((lot) => ` · batch ${lot.batch_number}${lot.expiry_date ? ` exp ${lot.expiry_date}` : ""}`).join("")}
                        </span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={Number(item.quantity)}
                        step="any"
                        value={row.received}
                        aria-label={`How many ${lineName(item)} arrived`}
                        onChange={(e) => setCounted((c) => ({ ...c, [item.id]: { ...row, received: e.target.value } }))}
                        className="h-9 w-24 rounded-lg border border-gray-300 bg-transparent px-3 text-right text-sm tabular-nums focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                      />
                    </div>
                    {isShort && (
                      <div className="mt-2">
                        <Select
                          aria-label={`Why ${lineName(item)} is short`}
                          options={SHORT_REASONS}
                          value={row.reason}
                          onChange={(v) => setCounted((c) => ({ ...c, [item.id]: { ...row, reason: v as ShortReason } }))}
                          placeholder={`Why did ${qty(Number(item.quantity) - Number(row.received))} not arrive?`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {problem && <p className="mt-3 text-theme-sm text-error-500" data-testid="receive-problem">{problem}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <Button size="sm" variant="outline" onClick={() => setReceiving(null)}>Cancel</Button>
              <Button size="sm" onClick={confirmReceive} disabled={problem !== null || receive.isPending}>
                {receive.isPending ? "Receiving…" : "Receive"}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Settle a shortage ────────────────────────────────────────── */}
      <Modal isOpen={settling !== null} onClose={() => setSettling(null)} className="max-w-lg p-6">
        {settling && (
          <>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Settle {settling.reference}</h3>
            <p className="mb-4 mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              {settling.to_branch?.name} counted less than {settling.from_branch?.name} sent. What became of the rest?
            </p>

            <ul className="mb-5 space-y-1.5">
              {shortLines(settling).map(({ item, short }) => (
                <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-white/[0.04]">
                  <span className="text-gray-800 dark:text-white/90">{lineName(item)}</span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">
                    {qty(short)} {item.short_reason === "damaged" ? "damaged" : "missing"}
                  </span>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => confirmSettle("returned")}
                disabled={settle.isPending}
                className="rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:border-brand-300 disabled:opacity-50 dark:border-gray-800"
              >
                <span className="block text-sm font-medium text-gray-800 dark:text-white/90">Put it back</span>
                <span className="block text-theme-xs text-gray-500 dark:text-gray-400">It never left, or it came back. It goes on the shelf at {settling.from_branch?.name} again.</span>
              </button>
              <button
                type="button"
                onClick={() => confirmSettle("written_off")}
                disabled={settle.isPending}
                className="rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:border-error-300 disabled:opacity-50 dark:border-gray-800"
              >
                <span className="block text-sm font-medium text-gray-800 dark:text-white/90">Write it off</span>
                <span className="block text-theme-xs text-gray-500 dark:text-gray-400">It is gone — broken or lost on the way. It stays off the books.</span>
              </button>
            </div>

            <div className="mt-5 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setSettling(null)}>Cancel</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
