import { useRef, useState } from "react";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import { Link, useNavigate, useSearchParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import { uuid } from "../../../common/uuid";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import { catalogSizeStock, catalogStock, onHand, sizeOnHand } from "../../pos/availability";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useProducts } from "../../catalog/hooks/useCatalog";
import type { Product, ProductVariant } from "../../catalog/types";
import { useAdjustStock, useAgeing, useBatches, useBatchMutations, useExpiring, useLowStock, useMovements, useRaiseReorderOrders } from "../hooks/useInventory";
import { useAuthStore } from "../../../stores/authStore";
import { DisposeBatchModal } from "../components/DisposeBatchModal";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { useToast } from "../../../components/ui/toast";
import Pager from "../../../components/ui/pager";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";
import { formatQuantity, formatQuantityWithUnit } from "../../../common/format/quantity";
import { isPastDate } from "../../../common/shopDay";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useBranchStore } from "../../../stores/branchStore";
import { refillLink } from "../../transfers/stockWords";
import { useBranches } from "../../branches/hooks/useBranches";
import { useNarrow } from "../../../common/hooks/useNarrow";
import { shopShortDateTime } from "../../../common/format/date";
import { lotExpiry } from "../lotWords";
import { StockViewTabs, type StockView } from "../components/StockViewTabs";
import { stockQueries } from "../stockQueries";
import { StockHistoryModal } from "../components/StockHistoryModal";
import { movementChange, movementWhat } from "../movementWords";


type AdjustType = "in" | "out" | "set";

/** One tap for the reasons a shop writes every day; the box still takes anything. */
const QUICK_REASONS: Record<AdjustType, string[]> = {
  in: ["Supplier delivery", "Customer return", "Found in count"],
  out: ["Damaged", "Expired", "Used in the shop", "Lost"],
  set: ["Physical recount"],
};

/** "SKU MAR-000001 · Rice" — the second line under an item's name. */
const itemLine = (p: Product) => [p.sku ? `SKU ${p.sku}` : null, p.category?.name ?? null].filter(Boolean).join(" · ");

// Decimal stock renders clean: 5.000 → 5, 2.500 → 2.5


export default function InventoryPage() {
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const buysThroughSystem = !!useAuthStore((s) => s.user?.tenant?.features?.purchasing);

  /**
   * The reorder view. Driven by the URL so the dashboard can send the
   * shopkeeper straight to it: the Attention panel says "12 items are running
   * low", and landing on an unfiltered list of 500 products with the low ones
   * merely badged is not an answer to that sentence.
   */
  const [params, setParams] = useSearchParams();
  const view: StockView = params.get("filter") === "low" ? "low" : params.get("filter") === "out" ? "out" : "all";
  const reorderOnly = view === "low";
  // The place a "bring it" link fills: the one chosen in the header, or — for
  // somebody pinned to a place — the one they work at. Unknown, the transfer
  // opens with the destination still to pick.
  const chosenPlace = useBranchStore((s) => s.activeBranchId);
  const ownPlace = useAuthStore((s) => s.user?.branch_id);
  const here = chosenPlace ?? ownPlace ?? null;
  const setView = (to: StockView) => {
    const next = new URLSearchParams(params);
    if (to === "all") next.delete("filter");
    else next.set("filter", to);
    setParams(next, { replace: true });
    setPage(1);
  };

  // What is COUNTED — see stockQueries for why the list and its counts ask
  // one question. The counts ignore what the list is showing or searching for.
  const products = useProducts(stockQueries.list(view, debounced, page));
  const everything = useProducts(stockQueries.all);
  const goneCount = useProducts(stockQueries.out);
  const uncounted = useProducts(stockQueries.uncounted);
  const narrow = useNarrow();
  const [historyOf, setHistoryOf] = useState<Product | null>(null);
  // Server-computed, and branch-correct: a product with no row on THIS
  // branch's shelf holds none of it, which the endpoint counts as the most
  // urgent case rather than dropping it.
  const toast = useToast();
  const lowStock = useLowStock();
  const raiseOrders = useRaiseReorderOrders();
  const adjust = useAdjustStock();
  const modal = useModal();
  const batchModal = useModal();
  const expiring = useExpiring();
  const ageing = useAgeing();
  const { add: addBatch, update: updateBatch, remove: removeBatch } = useBatchMutations();

  const [target, setTarget] = useState<Product | null>(null);
  const [variant, setVariant] = useState<ProductVariant | null>(null);
  const [adjustType, setAdjustType] = useState<AdjustType>("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  // Batch manager state
  const [batchTarget, setBatchTarget] = useState<Product | null>(null);
  const [bNo, setBNo] = useState("");
  const [bExpiry, setBExpiry] = useState("");
  const [bQty, setBQty] = useState("");
  const [bCost, setBCost] = useState("");
  /** Which size a new lot belongs to — required when the product has any. */
  const [bVariant, setBVariant] = useState("");
  // The four digits off a tyre's sidewall. Optional everywhere; the shops that
  // need it need it badly, and nobody else ever sees the consequence.
  const [bDot, setBDot] = useState("");

  /**
   * The lot being taken off the shelf, and what it belongs to.
   *
   * A lot with stock in it is an event, not a confirmation: forty strips are
   * binned or they go back to the distributor, and those are opposite facts
   * about the same money. The server refuses the removal without an answer.
   */
  const [disposing, setDisposing] = useState<{
    batch: { id: string; batch_number: string; quantity: number; expiry_date?: string | null };
    productName: string;
  } | null>(null);
  const batches = useBatches(batchTarget?.id ?? null);

  const movements = useMovements({ product_id: target?.id, per_page: 5 }, target !== null);
  const branchCol = useBranchColumn();
  // Where an adjustment lands: the place chosen in the header, the place this
  // person works at — or, in the whole-shop view, Main (the server's rule).
  const places = useBranches(branchCol.show);
  const placeName = (() => {
    const list = places.data ?? [];
    const id = here ?? list.find((b) => b.is_default)?.id ?? null;
    return list.find((b) => b.id === id)?.name ?? null;
  })();

  const openBatches = (p: Product) => {
    setBatchTarget(p);
    setBNo(""); setBExpiry(""); setBQty(""); setBCost("");
    // One size means there is nothing to choose — preselect it rather than
    // making somebody pick from a list of one.
    setBVariant((p.variants ?? []).length === 1 ? (p.variants ?? [])[0].id : "");
    addBatch.reset();
    batchModal.openModal();
  };

  /** A product sold in sizes must say WHICH size a lot belongs to. */
  const batchNeedsASize = (batchTarget?.variants ?? []).length > 0;

  const submitBatch = () => {
    if (!batchTarget || addBatch.isPending || !bNo.trim() || !bQty) return;
    if (batchNeedsASize && !bVariant) return;
    addBatch.mutate(
      {
        productId: batchTarget.id,
        batch_number: bNo.trim(),
        expiry_date: bExpiry || undefined,
        dot_code: bDot.length === 4 ? bDot : undefined,
        quantity: Number(bQty),
        cost: bCost ? Number(bCost) : undefined,
        variant_id: bVariant || undefined,
      },
      { onSuccess: () => { setBNo(""); setBExpiry(""); setBQty(""); setBCost(""); setBDot(""); } },
    );
  };

  // In the reorder view the server decides the rows, so there is no paging and
  // no client-side search — the whole point is that the list is already short.
  const lowRows = lowStock.data?.rows ?? [];
  // Tank fuel runs low too, but comes in by tanker with the dips; one litre of
  // petrol on the press refused the whole list (tester pass 4, B54).
  const orderable = lowRows.filter((p) => !p.by_tanker);
  /** How many items have a reorder level at all — see the empty state below. */
  const watched = lowStock.data?.watched ?? null;
  const lowShown = lowStock.data?.shown ?? null;
  const lowTotal = lowStock.data?.total ?? null;
  const rows = reorderOnly ? lowRows : products.data?.data ?? [];
  /** The one query the list below is drawn from — what it waits on, and what its empty state is about. */
  const listQuery = reorderOnly ? lowStock : products;
  const notCounted = uncounted.data?.meta.pagination?.total ?? 0;
  const counts: Record<StockView, number | null> = {
    all: everything.data?.meta.pagination?.total ?? null,
    low: lowStock.data ? (lowTotal ?? lowRows.length) : null,
    out: goneCount.data?.meta.pagination?.total ?? null,
  };
  const pagination = reorderOnly ? undefined : products.data?.meta.pagination;

  /**
   * Hand the whole shortfall to a purchase order.
   *
   * This is the step the flow was missing: the shop could be told what was
   * running low and then had to retype it into a PO by hand, product by
   * product, which is the moment a busy shopkeeper stops using the feature.
   */
  /**
   * Raise the orders, rather than half-writing one.
   *
   * This used to hand the whole list to Purchase Orders as ONE pre-filled form:
   * every item a line, quantity 1, priced at the shop's own blended cost, with
   * the supplier left blank. That saved the typing of names and nothing else —
   * and it could only ever make one order, while a Monday reorder list holds
   * lines from four or five different distributors.
   *
   * The server knows all three things the form could not: who each item was
   * last bought FROM, what was last PAID to them (not what the shop's stock is
   * worth), and how many it takes to get back above the reorder level. So it
   * creates one DRAFT per supplier and the buyer edits drafts — which is what
   * a draft is for.
   */
  const orderTheseItems = () => {
    raiseOrders.mutate(orderable.map((p) => p.id), {
      onSuccess: (res) => {
        // The server's own sentence, because it is the one that names any
        // items it could not place and says why.
        toast.success(res.message);
        navigate("/tenant/purchases");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Those orders could not be raised."),
    });
  };

  // One idempotency key per adjustment intent (a dialog open) — a resubmit
  // after a network error replays the same movement server-side.
  const idemRef = useRef<string>(uuid());

  const openAdjust = (product: Product, v: ProductVariant | null = null) => {
    setTarget(product);
    setVariant(v);
    setAdjustType("in");
    setQuantity("");
    setReason("");
    adjust.reset();
    idemRef.current = uuid();
    modal.openModal();
  };

  // catalogStock, not stock_quantity: for a product sold in sizes the parent's
  // column is an orphaned nought, and showing it as "currently 0" beside an
  // amount box is the same lie the parent Adjust button used to tell. And the
  // place the adjustment is WRITTEN to — a size read the whole shop's (B16).
  const currentStock = variant
    ? catalogSizeStock(variant)
    : target
      ? catalogStock(target)
      : 0;

  const submitAdjust = () => {
    if (!target || adjust.isPending || !quantity) return;
    adjust.mutate(
      {
        product_id: target.id,
        variant_id: variant?.id ?? undefined,
        type: adjustType,
        ...(adjustType === "set"
          ? { new_quantity: Number(quantity) }
          : { quantity: Number(quantity) }),
        reason: reason.trim() || undefined,
        idempotency_key: idemRef.current,
      },
      { onSuccess: () => modal.closeModal() },
    );
  };

  /** What an empty list says — the words differ by which tile is open. */
  const emptyWords =
    view === "out"
      ? `Nothing has run out${debounced ? " that matches your search" : ""}.`
      : `No tracked products${debounced ? " match your search" : " yet"}.`;

  /** The reorder view's "where does this come from" — one answer for the table and the cards. */
  const reorderNote = (p: Product) => (
    <>
      {/* BRING IT BEFORE BUYING IT. A shelf that has run
          down while the godown holds forty is not a
          purchase order, and this list used to offer a
          supplier for it all the same. */}
      {(p.held_elsewhere ?? []).length > 0 && (
        <Link
          to={refillLink(p.held_elsewhere![0].branch_id, here, p.name)}
          data-testid="held-elsewhere"
          className="mb-1 block text-theme-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {p.held_elsewhere![0].name} has {formatQuantity(p.held_elsewhere![0].quantity)} — bring it
        </Link>
      )}
      {p.by_tanker ? (
        <span data-testid="by-tanker" className="text-theme-xs text-gray-600 dark:text-gray-300">
          Comes by tanker — take it in from Fuel → Deliveries
        </span>
      ) : p.last_supplier_name ? (
        <span className="text-gray-700 dark:text-gray-300">{p.last_supplier_name}</span>
      ) : (
        /* Absent, never invented. A product nobody has bought
           has no supplier to propose, and guessing one would
           send a real order to a stranger. */
        <span className="text-theme-xs text-warning-600 dark:text-warning-400">
          Never bought — pick a supplier by hand
        </span>
      )}
    </>
  );

  const adjustError =
    adjust.error instanceof ApiError
      ? adjust.error.firstFieldError() ?? adjust.error.message
      : null;

  return (
    <>
      <PageMeta title="Inventory" description="Stock levels and movements" />

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Inventory</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Every stock change is recorded — open an item's History to see when, where and who.
        </p>
      </div>

      {/* Expiry alerts. The window is the SHOP's — 90 days for a pharmacy,
          30 for everyone else, or whatever it set. A distributor takes medicine
          back inside a window that closes months before the printed date, so a
          warning at thirty days arrived after the claim was already lost. */}
      {(expiring.data?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-2xl border border-warning-300 bg-warning-50 p-4 dark:border-warning-500/40 dark:bg-warning-500/10">
          <p className="mb-2 text-sm font-semibold text-warning-700 dark:text-warning-400">
            {/* NOT "within 30 days". The window is the shop's — 90 for a
                pharmacy — and a pharmacist told "within 30 days" about a
                90-day sweep reads the urgency wrong in both directions. Each
                row carries its own date, which is the honest answer. */}
            ⚠ Expiring stock — {expiring.data!.length} batch{expiring.data!.length > 1 ? "es" : ""} inside your expiry window
          </p>
          <div className="space-y-1 text-theme-sm text-gray-700 dark:text-gray-300">
            {expiring.data!.slice(0, 6).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.product?.name} · batch <span className="font-mono">{b.batch_number}</span> · {formatQuantity(b.quantity)} left
                </span>
                <span className="flex items-center gap-2">
                  <Badge size="sm" color={b.expired ? "error" : "warning"}>
                    {b.expired ? "EXPIRED" : `expires ${b.expiry_date}`}
                  </Badge>
                  {/* The action belongs where the shop is TOLD about it. Writing
                      the batch off was always possible, but only by leaving this
                      banner, finding the product in the table and opening its
                      batch manager — three steps away from the alert. */}
                  {Number(b.quantity) > 0 && (
                    <button
                      className={ROW_ACTION_DANGER}
                      disabled={removeBatch.isPending}
                      // Asked properly rather than confirmed away: near-expiry
                      // stock is exactly the stock a distributor will still
                      // take back, and this banner is where a pharmacist is
                      // told about it.
                      onClick={() =>
                        setDisposing({
                          batch: {
                            id: b.id,
                            batch_number: b.batch_number,
                            quantity: Number(b.quantity),
                            expiry_date: b.expiry_date,
                          },
                          productName: b.product?.name ?? "This item",
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            ))}
            {expiring.data!.length > 6 && (
              <p className="text-theme-xs text-gray-500">+{expiring.data!.length - 6} more…</p>
            )}
          </div>
        </div>
      )}

      {/* The other half of the same sweep. Stock can be dated two ways and only
          one of them used to be read again: an expiry had this banner, a
          dashboard tile, a counter warning and an alert, while a manufacture
          date had a badge inside one product's batch drawer. A tyre shop
          carrying two hundred sizes was never going to open two hundred
          drawers.

          Deliberately a different colour from the expiry banner. Expired stock
          is money already lost and unsellable; an old tyre is saleable stock
          that should go before the newer pallet. Painting them the same red
          would teach a shop to ignore both. */}
      {(ageing.data?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/[0.03]">
          <p className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
            Ageing stock — {ageing.data!.length} lot{ageing.data!.length > 1 ? "s" : ""} past your ageing threshold
          </p>
          <p className="mb-2 text-theme-xs text-gray-500 dark:text-gray-400">
            Nothing is blocked from sale. These go before the newer stock — the counter is told when one is scanned.
          </p>
          <div className="space-y-1 text-theme-sm text-gray-700 dark:text-gray-300">
            {ageing.data!.slice(0, 6).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.product?.name} · lot <span className="font-mono">{b.batch_number}</span>
                  {b.dot_code && <> · DOT <span className="font-mono">{b.dot_code}</span></>} · {formatQuantity(b.quantity)} left
                </span>
                <Badge size="sm" color={b.age_status === "old" ? "warning" : "light"}>
                  {b.age}{b.age_status === "old" ? " · old" : ""}
                </Badge>
              </div>
            ))}
            {ageing.data!.length > 6 && (
              <p className="text-theme-xs text-gray-500">+{ageing.data!.length - 6} more…</p>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StockViewTabs view={view} counts={counts} onPick={setView} />

        {!reorderOnly && (
          // Its own line on a phone, where the filter already fills the width.
          <div className="w-full sm:ml-auto sm:w-auto sm:min-w-48 sm:max-w-xs sm:flex-1">
            <Input placeholder="Search products…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        )}

        {/* Only offered to whoever can actually raise the order. */}
        {/* …and only in a shop that HAS purchase orders: the button posts
            to the Purchasing module, which Inventory no longer implies. */}
        {reorderOnly && orderable.length > 0 && hasPermission("purchases.manage") && buysThroughSystem && (
          <Button size="sm" className="sm:ml-auto" onClick={orderTheseItems}>
            Order these {orderable.length} item{orderable.length > 1 ? "s" : ""}
          </Button>
        )}
      </div>

      {/* WHAT IS NOT HERE, AND WHY. A restaurant's dishes are made to order:
          the till sells them whatever the books say, so they have no shelf to
          show. Left out silently, a shopkeeper looking for the samosas would
          think they had been lost. */}
      {!reorderOnly && notCounted > 0 && (
        <p data-testid="not-counted" className="mb-3 text-theme-sm text-gray-500 dark:text-gray-400">
          {notCounted.toLocaleString()} item{notCounted === 1 ? " does" : "s do"} not track stock — made to order, always
          available — so {notCounted === 1 ? "it is" : "they are"} not listed here. To count one, open it in Products
          and turn on “Track stock for this item”.
        </p>
      )}

      {reorderOnly && (
        <p className="mb-3 text-theme-sm text-gray-500 dark:text-gray-400">
          {/* EMPTY HAS TWO CAUSES AND THEY ARE NOT THE SAME NEWS.
              "Fully stocked" was said to shops that had never set a reorder
              level on anything — for whom this screen can never show a single
              row. It was reported as a breakage, reasonably: the list used to
              be full, because every sized product appeared in it whether it was
              low or not. */}
          {lowStock.isPending
            ? "Checking the shelf…"
            : lowRows.length > 0
              ? `${lowRows.length} item${lowRows.length > 1 ? "s are" : " is"} at or below the reorder level you set.`
              : watched === 0
                ? "No item has a reorder level yet, so there is nothing to watch. Open an item and set “Low stock alert at” — that is the number this list compares against."
                : watched === null
                  ? "Nothing is below its reorder level."
                  : `Nothing is below its reorder level. All ${watched} item${watched === 1 ? "" : "s"} with a reorder level are above it.`}
          {/* THE LIST IS A WORKLIST AND IT IS CAPPED. The most urgent two
              hundred come down; the rest arrive as these are dealt with. A
              screen that drew 200 of 569 and said nothing would read as the
              whole shop — which is the mistake the valuation report made. */}
          {lowShown !== null && lowTotal !== null && lowShown < lowTotal && (
            <>
              {" "}
              <span className="text-gray-400 dark:text-gray-500">
                Showing the {lowShown.toLocaleString()} closest to running out, of {lowTotal.toLocaleString()}. Deal
                with these and the next ones appear.
              </span>
            </>
          )}
        </p>
      )}

      {narrow ? (
        /* A HAND HOLDS CARDS, NOT A TABLE. On a phone the table squeezed each
           name onto four lines and pushed Adjust past the edge of the screen —
           the one thing a person opens this screen on a phone to do. */
        <div className="space-y-2" data-testid="stock-cards">
          {listQuery.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
            ))
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
              <ListEmpty from={listQuery} what="the stock list">
                <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{emptyWords}</p>
              </ListEmpty>
            </div>
          ) : (
            rows.map((p) => {
              const held = onHand(p);
              const low = p.low_stock_threshold !== null && held <= Number(p.low_stock_threshold);
              const sizes = p.variants ?? [];

              return (
                <div key={p.id} data-testid="stock-card" className="rounded-2xl border border-gray-200 bg-white p-3.5 dark:border-gray-800 dark:bg-white/[0.03]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 dark:text-white/90">{p.name}</p>
                      {itemLine(p) && <p className="mt-0.5 truncate text-theme-xs text-gray-400">{itemLine(p)}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-lg font-semibold tabular-nums ${held <= 0 ? "text-error-600 dark:text-error-400" : low ? "text-warning-600 dark:text-warning-400" : "text-gray-800 dark:text-white/90"}`}>
                        {formatQuantityWithUnit(held, p.sold_by, p.unit)}
                      </p>
                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {held <= 0 ? "Out of stock" : low ? "Low" : "In stock"}
                        {p.low_stock_threshold != null && ` · alert at ${formatQuantity(p.low_stock_threshold)}`}
                      </p>
                    </div>
                  </div>

                  {sizes.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {sizes.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => openAdjust(p, v)}
                          aria-label={`Adjust ${p.name} — ${v.name}`}
                          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-theme-xs text-gray-600 hover:border-brand-300 dark:border-gray-700 dark:text-gray-300"
                        >
                          {v.name} · <span className="font-semibold tabular-nums">{formatQuantity(sizeOnHand(v))}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {reorderOnly && <div className="mt-2.5 text-theme-sm">{reorderNote(p)}</div>}

                  <div className="mt-3 flex gap-2">
                    {sizes.length === 0 && (
                      <Button size="sm" className="flex-1" onClick={() => openAdjust(p)}>Adjust</Button>
                    )}
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setHistoryOf(p)}>History</Button>
                    <Button size="sm" variant="outline" onClick={() => openBatches(p)}>Batches</Button>
                  </div>
                </div>
              );
            })
          )}
          <Pager pagination={pagination} onPage={setPage} noun="products" />
        </div>
      ) : (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Stock</th>
                <th className="px-5 py-3 font-medium">Alert level</th>
                {/* Reorder view only. The button below raises real orders, and
                    a buyer pressing it without knowing who each line goes to is
                    guessing — so the screen says it before they press. */}
                {reorderOnly && <th className="px-5 py-3 font-medium">Last bought from</th>}
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {listQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={reorderOnly ? 5 : 4} className="px-5 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <TableEmpty from={listQuery} what="the stock list" colSpan={reorderOnly ? 5 : 4} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {emptyWords}
                  </TableEmpty>
                </tr>
              ) : (
                rows.flatMap((p) => [
                  <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-5 py-3">
                      <span className="font-medium text-gray-800 dark:text-white/90">{p.name}</span>
                      {itemLine(p) && <span className="mt-0.5 block text-theme-xs text-gray-400">{itemLine(p)}</span>}
                    </td>
                    <td className="px-5 py-3">
                      {/* The PARENT row of a sized product holds no stock of
                          its own — `onHand` sums the sizes, the same way the
                          till and the server's LowStock rule do, where the
                          person is looking (B16). Reading
                          `stock_quantity` badged a full rail of shirts "0 low". */}
                      {/* None left is its own news, not "0 low" — and a shelf
                          sold below nought (offline) still shows its number. */}
                      {onHand(p) <= 0 ? (
                        <Badge size="sm" color="error">{onHand(p) === 0 ? "Out of stock" : `${formatQuantity(onHand(p))} · out`}</Badge>
                      ) : p.low_stock_threshold !== null && onHand(p) <= Number(p.low_stock_threshold) ? (
                        <Badge size="sm" color="warning">{formatQuantity(onHand(p))} low</Badge>
                      ) : (
                        <span className={`font-semibold tabular-nums ${onHand(p) <= 0 ? "text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>
                          {formatQuantityWithUnit(onHand(p), p.sold_by, p.unit)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">{p.low_stock_threshold != null ? formatQuantity(p.low_stock_threshold) : "—"}</td>
                    {reorderOnly && <td className="px-5 py-3">{reorderNote(p)}</td>}
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button className={ROW_ACTION} onClick={() => setHistoryOf(p)}>
                          History
                        </button>
                        <button
                          className={ROW_ACTION}
                          onClick={() => openBatches(p)}
                        >
                          Batches
                        </button>
                        {/* A product sold in sizes holds no stock of its own:
                            its stock_quantity is an orphaned leftover nothing
                            reads. Adjusting the parent used to answer "Stock
                            updated" and move nothing at all. Each size below
                            carries its own Adjust. */}
                        {(p.variants ?? []).length === 0 && (
                          <button
                            className={ROW_ACTION}
                            onClick={() => openAdjust(p)}
                          >
                            Adjust
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  /* `?? []` is a real guard, not defensive noise. The type
                     says `variants: ProductVariant[]`, so tsc cannot help: it
                     is a RELATION, absent from any payload that did not load
                     it, and the reorder list was one of those. An unguarded
                     .map on undefined blanks the whole page. */
                  ...(p.variants ?? []).map((v) => (
                    <tr key={v.id} className="bg-gray-50/50 text-theme-sm text-gray-600 dark:bg-white/[0.01] dark:text-gray-400">
                      <td className="px-5 py-2.5 pl-10">
                        ↳ {v.name}
                        {v.sku && <span className="ml-2 text-theme-xs text-gray-400">SKU {v.sku}</span>}
                      </td>
                      {/* The size's stock where the person is looking
                          (`on_hand`), like its parent above (B16). */}
                      <td className={`px-5 py-2.5 tabular-nums ${sizeOnHand(v) <= 0 ? "font-semibold text-error-600 dark:text-error-400" : ""}`}>
                        {v.low_stock_threshold !== null && sizeOnHand(v) <= Number(v.low_stock_threshold) ? (
                          <Badge size="sm" color="warning">{formatQuantity(sizeOnHand(v))} low</Badge>
                        ) : (
                          formatQuantity(sizeOnHand(v))
                        )}
                      </td>
                      <td className="px-5 py-2.5">{v.low_stock_threshold != null ? formatQuantity(v.low_stock_threshold) : "—"}</td>
                      {reorderOnly && <td />}
                      <td className="px-5 py-2.5 text-right">
                        <button
                          className={ROW_ACTION}
                          onClick={() => openAdjust(p, v)}
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>
                  )),
                ])
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="products" />
      </div>
      )}

      {/* Adjust modal with recent movements for the product */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          Adjust stock — {target?.name}
          {variant && <span className="text-gray-500"> / {variant.name}</span>}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Current stock:{" "}
          <span className="font-semibold">
            {formatQuantityWithUnit(currentStock, target?.sold_by, target?.unit)}
          </span>
          {/* WHICH SHELF. With more than one place, an adjustment made from
              the whole-shop view lands on Main — and nothing on this dialog
              used to say so. */}
          {branchCol.show && placeName && (
            <span className="ml-1">
              · {adjustType === "in" ? "goes into" : adjustType === "out" ? "comes out of" : "counted at"}{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">{placeName}</span>
            </span>
          )}
        </p>

        {adjustError && (
          <div className="mb-4">
            <Alert variant="error" title="Couldn't adjust" message={adjustError} />
          </div>
        )}

        <div className="mb-4 flex gap-2">
          {(
            [
              ["in", "Stock in"],
              ["out", "Stock out"],
              ["set", "Recount"],
            ] as Array<[AdjustType, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAdjustType(value)}
              className={`rounded-lg border px-4 py-2 text-sm transition ${
                adjustType === value
                  ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                  : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <Label>{adjustType === "set" ? "New counted quantity" : "Quantity"}</Label>
          <Input
            type="number"
            min="0"
            step={target?.sold_by === "weight" ? 0.001 : 1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={adjustType === "set" ? "e.g. 42" : target?.sold_by === "weight" ? "e.g. 2.5" : "e.g. 5"}
          />
          {/* The answer before the press: "After this: 36" — or a warning
              when taking out more than the shelf holds. */}
          {quantity !== "" && Number.isFinite(Number(quantity)) && (() => {
            const q = Number(quantity);
            const now = Number(currentStock);
            const after = adjustType === "in" ? now + q : adjustType === "out" ? now - q : q;

            return (
              <p data-testid="adjust-after" className={`mt-1.5 text-theme-xs ${after < 0 ? "text-error-600 dark:text-error-400" : "text-gray-500 dark:text-gray-400"}`}>
                After this:{" "}
                <span className="font-semibold tabular-nums">{formatQuantity(now)} → {formatQuantity(after)}</span>
                {after < 0 && " — more than you have"}
              </p>
            );
          })()}
        </div>

        <div className="mb-6">
          <Label>Reason (optional)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              adjustType === "in" ? "e.g. Supplier delivery" : adjustType === "out" ? "e.g. Damaged" : "e.g. Physical recount"
            }
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_REASONS[adjustType].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                aria-pressed={reason === r}
                className={`rounded-full border px-2.5 py-1 text-theme-xs transition ${
                  reason === r
                    ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submitAdjust} disabled={adjust.isPending || !quantity}>
            {adjust.isPending ? "Applying…" : "Apply"}
          </Button>
        </div>

        {/* The last few changes, and the door to all of them. */}
        {target && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recent movements</h4>
              <button
                type="button"
                className="text-theme-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                onClick={() => {
                  const item = target;
                  modal.closeModal();
                  setHistoryOf(item);
                }}
              >
                See full history
              </button>
            </div>
            {movements.isLoading ? (
              <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            ) : (movements.data?.data ?? []).filter((m) => m.product_id === target.id).length === 0 ? (
              <ListEmpty from={movements} what="the stock movements">
                <p className="text-theme-xs text-gray-400">No movements yet.</p>
              </ListEmpty>
            ) : (
              <ul className="space-y-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                {(movements.data?.data ?? []).filter((m) => m.product_id === target.id).slice(0, 5).map((m) => (
                  <li key={m.id} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="text-gray-700 dark:text-gray-300">{movementWhat(m)}</span>
                      {m.variant ? ` · ${m.variant.name}` : ""}
                      {/* WHICH branch moved it. An owner looking at the
                          all-branches view sees "Out −3" twice with no way to
                          tell whether that is one shop or two — and stock is the
                          one figure where that distinction is the whole
                          question. */}
                      {branchCol.show ? ` · ${branchCol.label(m.branch_id)}` : ""}
                      {` · ${shopShortDateTime(m.created_at)}`}
                    </span>
                    <span className={`shrink-0 tabular-nums ${Number(m.quantity_change) > 0 ? "text-success-600" : "text-error-600"}`}>
                      {movementChange(m.quantity_change)} → {formatQuantity(m.quantity_after)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {/* Batch / lot manager (expiry tracking) */}
      <Modal isOpen={batchModal.isOpen} onClose={batchModal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          Batches — {batchTarget?.name}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Track lots with expiry dates. Adding a batch stocks it in; sales use the earliest expiry first.
        </p>

        {addBatch.error instanceof ApiError && (
          <div className="mb-3">
            <Alert variant="error" title="Couldn't add batch" message={addBatch.error.firstFieldError() ?? addBatch.error.message} />
          </div>
        )}

        {batchNeedsASize && (
          /* A lot of 10mg strips is not a lot of 20mg strips. Without this the
             batch was filed against the parent, whose stock column nothing
             reads — the lot existed and the size stayed at zero. */
          <div className="mb-4">
            <Label>Size</Label>
            <Select
              aria-label="Which size this lot belongs to"
              value={bVariant}
              onChange={setBVariant}
              options={[
                { value: "", label: "Choose a size…" },
                ...(batchTarget?.variants ?? []).map((v) => ({ value: v.id, label: v.name })),
              ]}
            />
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <div>
            <Label>Batch / lot no.</Label>
            <Input value={bNo} onChange={(e) => setBNo(e.target.value)} placeholder="e.g. LOT-2401" />
          </div>
          <div>
            <Label>
              Expiry date{batchTarget?.item_type === "medicine" && <span className="text-error-500"> *</span>}
            </Label>
            <Input type="date" value={bExpiry} onChange={(e) => setBExpiry(e.target.value)} />
            {batchTarget?.item_type === "medicine" && (
              <p className="mt-1 text-theme-xs text-gray-400">Required for medicines</p>
            )}
          </div>
          <div>
            <Label>DOT code (tyres)</Label>
            <Input value={bDot} onChange={(e) => setBDot(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 2224" />
            <p className="mt-1 text-theme-xs text-gray-400">
              Week then year off the sidewall — rubber ages on the shelf.
            </p>
          </div>
          <div>
            <Label>Quantity</Label>
            <Input type="number" min="0" step={batchTarget?.sold_by === "weight" ? 0.001 : 1} value={bQty} onChange={(e) => setBQty(e.target.value)} />
          </div>
          <div>
            <Label>Unit cost (optional)</Label>
            <Input type="number" min="0" step={0.01} value={bCost} onChange={(e) => setBCost(e.target.value)} />
          </div>
        </div>
        <Button
          size="sm"
          onClick={submitBatch}
          disabled={addBatch.isPending || !bNo.trim() || !bQty || (batchNeedsASize && !bVariant) || (batchTarget?.item_type === "medicine" && !bExpiry)}
        >
          {addBatch.isPending ? "Adding…" : "Add batch (stock in)"}
        </Button>

        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
          <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Current batches</h4>
          {batches.isLoading ? (
            <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          ) : (batches.data ?? []).length === 0 ? (
            <ListEmpty from={batches} what="the batches">
              <p className="text-theme-xs text-gray-400">No batches yet — stock is untracked by lot.</p>
            </ListEmpty>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(batches.data ?? []).map((b) => {
                // By the date on the shop's wall, as the till judges it — see isPastDate.
                const expired = isPastDate(b.expiry_date);
                return (
                  <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-theme-sm dark:border-gray-800">
                    <span className="text-gray-700 dark:text-gray-300">
                      <span className="font-mono">{b.batch_number}</span>
                      {/* Which size this lot is. Without it a chemist reads a
                          list of lot numbers and cannot tell the 10mg from the
                          20mg. The name is matched locally — the row carries
                          the id, and the sizes are already in hand. */}
                      {batchNeedsASize && (
                        <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-theme-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
                          {(batchTarget?.variants ?? []).find((v) => v.id === b.variant_id)?.name ?? "no size"}
                        </span>
                      )}
                      {" · "}{formatQuantity(b.quantity)} left
                      {" · "}<span data-lot-expiry className={b.expiry_date ? undefined : "text-gray-400"}>{lotExpiry(b.expiry_date)}</span>
                      {expired && <span className="ml-2 text-error-500">EXPIRED</span>}
                      {/* Age, not expiry. "old" is a nudge to price it or send
                          it back — never a block on selling it. */}
                      {b.age && (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-theme-xs ${
                            b.age_status === "old"
                              ? "bg-error-50 text-error-600 dark:bg-error-500/10"
                              : b.age_status === "ageing"
                                ? "bg-warning-50 text-warning-600 dark:bg-warning-500/10"
                                : "text-gray-400"
                          }`}
                        >
                          {b.age} old{b.dot_code ? ` · DOT ${b.dot_code}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {/* Lot metadata is editable in place (e.g. filling in the
                          expiry on a lot auto-created by a PO receipt). */}
                      <input
                        type="date"
                        aria-label={`Expiry of lot ${b.batch_number}`}
                        title="Change this lot's expiry"
                        className="rounded border border-gray-300 px-1.5 py-0.5 text-theme-xs dark:border-gray-700 dark:bg-gray-900"
                        value={b.expiry_date ? b.expiry_date.slice(0, 10) : ""}
                        disabled={updateBatch.isPending}
                        /* A DATE THAT DID NOT SAVE MUST NOT LOOK SAVED.
                           This writes on change and said nothing either way. A
                           refused expiry leaves the field showing what was
                           typed while the lot keeps its old date — and an
                           expiry is a fence a pharmacy dispenses against. */
                        onChange={(e) => updateBatch.mutate(
                          { id: b.id, expiry_date: e.target.value || null },
                          { onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't save that date.") },
                        )}
                      />
                      <button
                        className={ROW_ACTION_DANGER}
                        onClick={() =>
                          Number(b.quantity) > 0
                            ? setDisposing({
                                batch: {
                                  id: b.id,
                                  batch_number: b.batch_number,
                                  quantity: Number(b.quantity),
                                  expiry_date: b.expiry_date,
                                },
                                productName: batchTarget?.name ?? "This item",
                              })
                            // An empty lot is housekeeping — a mis-keyed batch
                            // number being tidied away. Nothing to explain.
                            : void confirm({ title: "Remove this empty batch?", message: "It holds no stock, so nothing moves.", confirmLabel: "Remove", tone: "danger" }).then((ok) => ok && removeBatch.mutate(
                              { id: b.id },
                              { onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't remove that batch.") },
                            ))
                        }
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      <StockHistoryModal
        product={historyOf}
        onClose={() => setHistoryOf(null)}
        onAdjust={(p) => {
          setHistoryOf(null);
          openAdjust(p);
        }}
      />

      {/* A lot with stock in it is an event, not a confirmation. */}
      {disposing && (
        <DisposeBatchModal
          batch={disposing.batch}
          productName={disposing.productName}
          busy={removeBatch.isPending}
          onClose={() => setDisposing(null)}
          onConfirm={(disposal) =>
            removeBatch.mutate(
              { id: disposing.batch.id, disposal },
              {
                onSuccess: () => setDisposing(null),
                onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't write off that stock."),
              },
            )
          }
        />
      )}
    </>
  );
}
