import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { uuid } from "../../../common/uuid";
import { ChevronLeftIcon, ChevronDownIcon, TrashBinIcon, PlusIcon, AlertIcon, CloseIcon, DollarLineIcon, ListIcon, UserCircleIcon, CheckLineIcon } from "../../../icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { apiGet } from "../../../common/api/client";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import { useAuthStore } from "../../../stores/authStore";
import { useCategories, useProducts } from "../../catalog/hooks/useCatalog";
import { NoAccess } from "../../../common/ui/NoAccess";
import { deniedReason } from "../../../common/api/denied";
import { useVehicleLookup, useVehicleMutations } from "../../vehicles/hooks/useVehicles";
import type { Vehicle } from "../../vehicles/services/vehiclesService";
import { catalogService } from "../../catalog/services/catalogService";
import type { Product as CatalogProduct, ProductUnit } from "../../catalog/types";
import { salesService } from "../../sales/services/salesService";
import type { Sale } from "../../sales/types";
import { posService, type HeldSale } from "../services/posService";
import { posSound } from "../posSound";
import CashDrawerPanel from "../components/CashDrawerPanel";
import CloseShiftModal from "../components/CloseShiftModal";
import { useQuickKeys, useCoverMutations, useCurrentSession, useHeldMutations, useHeldSales, useShiftMutations } from "../hooks/usePos";
import { isCover, isTraining, type ActiveCover, type CashSession } from "../services/posService";
import { useLanes, useTerminal } from "../../registers/hooks/useRegisters";
import { receiptService, type ReceiptKind } from "../../receipts/services/receiptService";
import { useFailedReceipts } from "../../receipts/hooks/useReceipts";
import { useTillStore } from "../../../stores/tillStore";
import { useConnectionStore } from "../../../stores/connectionStore";
import { useIdleLock } from "../hooks/useIdleLock";
import TillLock from "../components/TillLock";
import SubstitutePicker from "../../pharmacy/components/SubstitutePicker";
import ParkAsDocumentModal from "../../documents/components/ParkAsDocumentModal";
import { parkCart, readParkedCart } from "../cartStorage";
import { canKick, kickDrawer } from "../../../common/escpos";
import { NumPad } from "../components/NumPad";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useShopSettings } from "../../shop/hooks/useShop";
import { couponsService } from "../../coupons/services/couponsService";
import { promotionsService, type PromoPreview } from "../../promotions/services/promotionsService";

interface CartLine {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  sku?: string | null;
  unit_price: number; // display estimate — the server prices lines authoritatively
  quantity: number;
  sold_by?: "unit" | "weight";
  unit_label?: string | null;
  price_tiers?: Array<{ min_qty: number | string; price: number | string }> | null;
  // Pack-breaking: the pack this line is sold in (null = base unit). units is
  // the set of packs offered for this product; base_price derives pack prices.
  product_unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number;
  units?: ProductUnit[];
  base_price?: number;        // retail per-base-unit price (level maths derive from this)
  // Price level (price list): "wholesale" uses wholesale_price when present.
  price_level?: "retail" | "wholesale";
  wholesale_price?: number | null;
  // Effective tax rate: null = use the shop default; a number (incl. 0 = exempt)
  // overrides it. Mirrors the server's per-product tax computation.
  tax_rate?: number | null;
  // Pharmacy: this line is a prescription-required medicine — the POS prompts
  // for prescription details before checkout.
  requires_prescription?: boolean;
  // Serialized retail: this line captures a serial/IMEI per unit. serials holds
  // what the cashier keyed; warranty_months overrides the product default.
  tracks_serial?: boolean;
  warranty_months?: number | null;
  serials?: string[];
  modifier_option_ids?: string[];
  modifiers_label?: string;
  // Per-line discount (needs discounts.apply). Value + mode; the server
  // recomputes/validates against its own price — this is display + intent.
  discountValue?: number;
  discountMode?: "amt" | "pct";
}
let ck = 0;

/**
 * The keyboard legend, colour-coded by what each key does. The colours are not
 * decoration: each one matches the button that performs the same action further
 * down the screen, so "the green one" is a usable instruction across a noisy
 * counter. Pay is brand-coloured because it is the only one that takes money.
 */
const SHORTCUTS: Array<{
  k: string;
  label: string;
  tone: string;
  run: "focusSearch" | "hold" | "openHeld" | "document" | "pay";
}> = [
  { k: "F2", label: "Search", tone: "border-blue-light-500/40 bg-blue-light-500/15 text-blue-light-300", run: "focusSearch" },
  { k: "F4", label: "Hold", tone: "border-warning-500/40 bg-warning-500/15 text-warning-300", run: "hold" },
  { k: "F6", label: "Drafts", tone: "border-orange-500/40 bg-orange-500/15 text-orange-300", run: "openHeld" },
  { k: "F7", label: "Quote", tone: "border-success-500/40 bg-success-500/15 text-success-300", run: "document" },
  { k: "F9", label: "Pay", tone: "border-brand-500/40 bg-brand-500/15 text-brand-300", run: "pay" },
];

/** First letter of the first two words — "Adeel Khan" -> AK, "Adeel" -> A. */
const initials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";

// A few glyphs the shared icon set doesn't ship — kept as inline SVG (real
// icons, never emoji) so the POS matches the rest of the UI.
const iconCls = "h-4 w-4";
const MinusGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className={iconCls}><path d="M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const PlusGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className={iconCls}><path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const CardGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className={iconCls}><rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.6" /></svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className={iconCls}><path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const SplitGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className={iconCls}><path d="M4 5h4l3.5 5H16M4 15h4l3.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const SearchGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" /><path d="M17 17l-3.4-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
// Credit / khata (pay-later) — a small ledger/notebook glyph.
const CreditGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className={iconCls}><rect x="4" y="2.5" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M7 6h6M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
// Scan-sound toggle glyphs — speaker with waves (on) / a slash (muted).
const SpeakerOnGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M4 8v4h2.5L10 15V5L6.5 8H4z" fill="currentColor" /><path d="M12.5 7.5a3 3 0 010 5M14.5 5.5a5.5 5.5 0 010 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
);
const SpeakerOffGlyph = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M4 8v4h2.5L10 15V5L6.5 8H4z" fill="currentColor" /><path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
);

type PayMethod = "cash" | "card" | "credit" | "split";
const MethodIcon = ({ m }: { m: PayMethod }) =>
  m === "cash" ? <DollarLineIcon className="h-4 w-4" /> : m === "card" ? <CardGlyph /> : m === "credit" ? <CreditGlyph /> : <SplitGlyph />;

/** Price for one of a pack: explicit pack price, else base price × factor. */
const packPrice = (basePrice: number, u: ProductUnit): number =>
  u.price != null && u.price !== "" ? Number(u.price) : Math.round(basePrice * Number(u.factor) * 100) / 100;

/** The retail-or-wholesale per-base-unit rate for a line (mirrors the server). */
const levelBase = (l: CartLine): number => {
  const retail = l.base_price ?? l.unit_price;
  const w = l.wholesale_price;
  return l.price_level === "wholesale" && w != null && Number(w) > 0 ? Math.min(Number(w), retail) : retail;
};

/** Recompute a line's display unit_price from its level + selected pack. */
const recalcLine = (l: CartLine, patch: Partial<CartLine>): CartLine => {
  const next = { ...l, ...patch };
  const base = levelBase(next);
  const u = next.product_unit_id ? next.units?.find((x) => x.id === next.product_unit_id) : undefined;
  next.unit_price = u ? packPrice(base, u) : base;
  return next;
};

/** Effective per-unit price for a line: deepest qty tier reached, else base. */
const lineUnit = (l: CartLine): number => {
  // A pack line is priced explicitly (pack price), and a wholesale line uses
  // the flat wholesale rate — quantity tiers apply to plain retail sales only.
  if (l.product_unit_id || l.price_level === "wholesale") return l.unit_price;
  let best: number | null = null;
  let bestMin = 0;
  for (const t of l.price_tiers ?? []) {
    const min = Number(t.min_qty);
    const price = Number(t.price);
    if (min > 0 && price > 0 && l.quantity >= min && min > bestMin) { best = price; bestMin = min; }
  }
  return best ?? l.unit_price;
};

const fmtQty = (n: number) => String(parseFloat(n.toFixed(3)));

/** Gross line value before any per-line discount. */
const lineGross = (l: CartLine): number => lineUnit(l) * l.quantity;
/** Per-line discount amount (clamped to the line), mirroring the server. */
const lineDiscountAmt = (l: CartLine): number => {
  const v = l.discountValue ?? 0;
  if (v <= 0) return 0;
  const gross = lineGross(l);
  return l.discountMode === "pct" ? Math.round(gross * Math.min(v, 100)) / 100 : Math.min(v, gross);
};
/** Line value the customer pays after its per-line discount. */
const lineNet = (l: CartLine): number => Math.max(0, lineGross(l) - lineDiscountAmt(l));

/** The price the buyer pays: an active sale price beats the regular price. */
const sellingPrice = (p: { price: string | number; discount_price?: string | number | null }) => {
  const price = Number(p.price);
  const sale = p.discount_price != null ? Number(p.discount_price) : null;
  return sale !== null && sale > 0 && sale < price ? sale : price;
};
const onSale = (p: { price: string | number; discount_price?: string | number | null }) =>
  sellingPrice(p) < Number(p.price);

export default function PosPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  // Resolved on the server, so an older code (`restaurant`, `clinic`,
  // `workshop`) answers as the type it became and the till behaves the same
  // for that shop as for a new one.
  const businessType = usePrimaryBusinessType();
  // Food shops browse a visual image grid; high-SKU shops (mart, pharmacy,
  // retail…) get a dense, search-first list of rows.
  const isRestaurant = businessType === "food";
  // Taking goods in part-payment moves stock, so it needs the inventory module
  // — a shop that doesn't count anything has nowhere to put a dead battery.
  const modules = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features,
  );
  const has = (key: string) => modules?.[key] ?? false;
  // The trades that work on vehicles. A grocery never sees the plate field, and
  // the ones that live by it never have to go looking for it.
  const isAutoTrade = businessType === "automotive" || businessType === "petroleum";
  const posLayout: "grid" | "list" = isRestaurant ? "grid" : "list";
  const canDiscount = hasPermission("discounts.apply");
  const qc = useQueryClient();

  const session = useCurrentSession();
  const shift = useShiftMutations();
  const held = useHeldSales();
  const heldMut = useHeldMutations();

  // ── Which lane is this terminal? ────────────────────────────────
  // A per-device choice (see terminalStore): the tablet bolted to lane 3 stays
  // lane 3 across shift changes and reboots. A shop with no lanes configured
  // never sees any of this — `lanes` comes back empty and the POS behaves
  // exactly as it did before registers existed.
  const lanes = useLanes();
  const laneList = lanes.data ?? [];
  const usesLanes = laneList.length > 0;
  const terminalId = useTerminalStore((s) => s.activeRegisterId);
  const terminalName = useTerminalStore((s) => s.activeRegisterName);
  const setTerminal = useTerminalStore((s) => s.setTerminal);
  // Per-device, like the lane: whether this till needs a keypad is a fact
  // about the hardware in front of you, not about who logged in.
  const showPad = useTerminalStore((s) => s.numPad);
  const setShowPad = useTerminalStore((s) => s.setNumPad);
  const laneModal = useModal();
  // The lane of the shift actually running beats the stored choice — after a
  // handover the badge must show where the drawer really is.
  // `/pos/session` answers with my own drawer, the one I'm covering, or null.
  // Covering is deliberately NOT a session: it carries the shift id to ring
  // against and nothing the cashier will be measured on, so it has to stay a
  // separate value rather than being smuggled in as a CashSession.
  const covering = isCover(session.data ?? null) ? (session.data as ActiveCover) : null;
  const open = covering ? null : ((session.data as CashSession | null) ?? null);
  // The drawer a sale must be rung into — mine, or the one I'm standing at.
  const activeSessionId = covering ? covering.session_id : (open?.id ?? null);
  // A practice shift. Server-decided and fixed at open; the till only reports
  // it. A reliever covering a training drawer is training too — the flag
  // belongs to the drawer, not the person standing at it.
  const training = isTraining(session.data ?? null);
  const myLane = laneList.find(
    (l) => l.id === (covering?.register?.id ?? open?.register_id ?? terminalId),
  );
  const coverMutations = useCoverMutations();
  // Whose drawer is sitting on the lane in front of me, when it isn't mine and
  // I don't have one of my own. Null means there is nothing here to cover.
  const laneIsSomeoneElses =
    !open && !covering && terminalId
      ? (laneList.find((l) => l.id === terminalId && l.is_busy)?.open_session?.user_name ?? null)
      : null;
  const laneLabel = myLane?.name ?? terminalName ?? null;
  const settings = useShopSettings();
  const cur = settings.data?.currency_symbol ?? "Rs";
  const money = (n: string | number) => `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

  // ── Receipts & drawer ───────────────────────────────────────────
  // The hardware this lane drives. The drawer usually hangs off the printer,
  // so either device's transport is a valid line to pulse.
  const terminal = useTerminal();
  const drawerDevice = terminal.data?.devices?.cash_drawer ?? terminal.data?.devices?.receipt_printer;
  const failedReceipts = useFailedReceipts();

  // ── Who's at the till, and can it reach the server ──────────────
  const me = useAuthStore((s) => s.user);
  // An old `clinic` dispenses medicine too — prescription capture must not
  // depend on which decade the shop was created in.
  const isPharmacy = businessType === "pharmacy";
  const lockTill = useTillStore((s) => s.lock);
  const tillLocked = useTillStore((s) => s.locked);
  const online = useConnectionStore((s) => s.online);
  const reachable = useConnectionStore((s) => s.reachable);
  const connected = online && reachable;
  // Auto-lock is off unless the shop turns it on (Settings → POS).
  useIdleLock(Number(settings.data?.pos_idle_lock_minutes ?? 0), !tillLocked);


  /**
   * Print a receipt and remember the attempt. The server decides whether it is
   * an original or a stamped copy — the till only reports what happened next.
   */
  const printReceipt = async (saleId: string, copy?: "gift") => {
    setPrinting(true);
    try {
      const attempt = await receiptService.printReceipt(saleId, copy ? { copy } : {});
      setLastPrint({ printId: attempt.printId, kind: attempt.kind, failed: !!attempt.handoffError });
      if (attempt.handoffError) setPosNotice(`Receipt didn't print — ${attempt.handoffError}`);
    } catch {
      setLastPrint(null);
      setPosNotice("Could not load the receipt to print.");
    } finally {
      setPrinting(false);
    }
  };

  /** The cashier's verdict on the last receipt. Silent on success. */
  const reportPrint = async (status: "printed" | "failed") => {
    if (!lastPrint?.printId) return;
    try {
      await receiptService.reportOutcome(lastPrint.printId, status);
      setLastPrint({ ...lastPrint, failed: status === "failed" });
      if (status === "failed") setPosNotice("Logged — the receipt is in the reprint tray. Print it again when the printer is back.");
    } catch {
      setPosNotice("Couldn't record that. The receipt itself is fine to print again.");
    }
  };

  /**
   * Pulse the drawer. Only where a direct transport exists — a browser print
   * dialog has no pulse to send, and saying nothing would leave the cashier
   * waiting for a drawer that was never going to open.
   */
  const openDrawer = async (announceWhenImpossible = true) => {
    if (!settings.data?.pos_drawer_kick) return;
    if (!canKick(drawerDevice?.connection_type)) {
      if (announceWhenImpossible && drawerDevice) {
        setPosNotice("This drawer isn't on a direct connection — open it by hand, or wire it over serial in Settings → Hardware.");
      }
      return;
    }
    const res = await kickDrawer();
    if (!res.ok) setPosNotice(res.message);
  };

  // ── Product browser: search + category tabs + accumulated pages ──
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const categories = useCategories();
  // 20 rather than the API's default 15: three full rows of tiles on a
  // 1366 laptop, so a cashier browsing by category usually finds the item
  // without paging at all.
  const POS_PAGE_SIZE = 20;
  const products = useProducts({ search: search || undefined, category_id: categoryId || undefined, page, per_page: POS_PAGE_SIZE });
  // The counter's shortlist — derived, never curated. See useQuickKeys.
  const quickKeys = useQuickKeys();
  const [tiles, setTiles] = useState<CatalogProduct[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  // Keyboard-first result navigation: ↑/↓ move the highlight, Enter adds it.
  // activeRef points at the highlighted result so it scrolls into view.
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Reset the accumulated grid when filters change; append on page loads.
  useEffect(() => { setPage(1); }, [search, categoryId]);
  useEffect(() => {
    const rows = products.data?.data;
    if (!rows) return;
    setTiles((prev) => {
      if ((products.data?.meta?.pagination?.current_page ?? 1) === 1) return rows;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
  }, [products.data]);
  const pagination = products.data?.meta?.pagination;
  const hasMore = !!pagination && pagination.current_page < pagination.last_page;
  // A refused catalog and an empty catalog used to draw the same blank grid.
  // If the till cannot read the product list, say so on the till.
  const productsDenied = deniedReason(products.error);

  // Snap the highlight back to the top whenever the result set changes; keep
  // the highlighted tile scrolled into view as ↑/↓ move it.
  useEffect(() => { setActiveIndex(0); }, [search, categoryId]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  // ── Cart ──────────────────────────────────────────────────────────
  // Restored from the device on first render, so a refresh mid-trolley is a
  // blink rather than "sorry, can you hand me those again". See cartStorage:
  // only line INTENTS are kept — the server still prices everything.
  const [cart, setCart] = useState<CartLine[]>(() => readParkedCart<CartLine>(terminalId)?.lines ?? []);
  const [restoredCart] = useState(() => readParkedCart<CartLine>(terminalId));

  // Park the cart on every change. Cheap (a few lines of JSON) and it is the
  // difference between a refresh costing a blink and costing the trolley.
  useEffect(() => {
    parkCart(terminalId, cart, me ? { id: me.id, name: me.name } : null);
  }, [cart, terminalId, me]);

  // Say so once, on the load that restored it — silently repopulating a cart
  // would be worse than losing it, because nobody would check it.
  useEffect(() => {
    if (restoredCart) {
      setPosNotice(
        `Picked up where you left off — ${restoredCart.lines.length} line${restoredCart.lines.length === 1 ? "" : "s"} still in the cart. Clear it if this isn't the same customer.`,
      );
    }
    // Deliberately once: restoredCart is captured at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<"takeaway" | "dine_in">("takeaway");
  const [tableNo, setTableNo] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "credit" | "split">("cash");
  const [tenders, setTenders] = useState<Array<{ method: "cash" | "card" | "bank_transfer" | "credit"; amount: string }>>([{ method: "cash", amount: "" }]);
  const [tendered, setTendered] = useState("");
  /**
   * Goods taken in part-payment: the dead battery, the worn set of tyres.
   *
   * NOT a discount. The sale keeps its full price and the allowance settles
   * part of it, so revenue stays true and the scrap becomes stock the shop can
   * count and sell on. Faking it as a discount lost both.
   */
  const [tradeIns, setTradeIns] = useState<Array<{
    product_id: string; product_name: string; quantity: string; unit_allowance: string; description: string;
  }>>([]);
  const [tradeInSearch, setTradeInSearch] = useState("");
  /**
   * The vehicle this job is on.
   *
   * A tyre shop's real customer key — what a warranty claim hangs off, and what
   * lets the counter say "your alignment was 11,000 km ago" instead of guessing.
   * Never required: most trades never touch it.
   */
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [odometer, setOdometer] = useState("");
  const [tradeInQuery, setTradeInQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTradeInQuery(tradeInSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [tradeInSearch]);
  const tradeInResults = useProducts({ search: tradeInQuery || undefined });
  const vehicleResults = useVehicleLookup(vehicleSearch);
  const { quickCreate: quickCreateVehicle } = useVehicleMutations();
  // Only stock items can be taken in: an allowance backed by a service is
  // backed by nothing you can put on a shelf.
  const tradeInOptions = (tradeInResults.data?.data ?? []).filter((p) => p.type === "product");
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => posSound.isMuted());
  // Pharmacy prescription capture (shown when the cart holds an Rx item).
  const [rxNumber, setRxNumber] = useState("");
  const [rxPrescriber, setRxPrescriber] = useState("");
  const [rxPatient, setRxPatient] = useState("");
  // Soft cashier warning (Rx / near-expiry) — never blocks the sale.
  const [posNotice, setPosNotice] = useState<string | null>(null);
  // Pharmacy: the drug whose equivalents the counter is looking at.
  const [substituteFor, setSubstituteFor] = useState<string | null>(null);
  // The last print attempt, so the receipt modal can ask "did it come out?"
  // and report the answer. A browser never tells us on its own.
  const [lastPrint, setLastPrint] = useState<{ printId: string | null; kind: ReceiptKind; failed: boolean } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  // Loyalty: the attached customer's point balance + points being redeemed.
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const [redeemPts, setRedeemPts] = useState("");
  // Promotions: the best auto-promo for the current cart (server preview).
  const [promo, setPromo] = useState<PromoPreview | null>(null);

  // One idempotency key per cart state: a network retry of the SAME cart
  // reuses the key (server dedupes); any cart change mints a new one.
  const idemRef = useRef<string>(uuid());
  useEffect(() => { idemRef.current = uuid(); }, [cart]);

  // Keyboard-first POS: function keys drive the till so a cashier never
  // reaches for the mouse. actionsRef always holds the latest handlers so the
  // once-mounted listener stays in sync with current cart/shift state.
  const actionsRef = useRef<{ focusSearch: () => void; hold: () => void; pay: () => void; openHeld: () => void; document: () => void; clearSearch: () => void } | undefined>(undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      if (!a) return;
      // The lock screen owns the keyboard while it's up — otherwise F9 would
      // open the tender modal behind it, and a scan would land in the cart of
      // whoever just walked away.
      if (useTillStore.getState().locked) return;
      switch (e.key) {
        case "F2": e.preventDefault(); a.focusSearch(); break;   // jump to scan/search
        case "F4": e.preventDefault(); a.hold(); break;          // park the ticket under a name
        case "F6": e.preventDefault(); a.openHeld(); break;      // reopen a parked ticket
        case "F7": e.preventDefault(); a.document(); break;      // quotation / advance booking
        case "F9": e.preventDefault(); a.pay(); break;           // complete / pay
        case "Escape": a.clearSearch(); break;                   // clear the search box
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openModal = useModal();
  const closeModal = useModal();
  const drawerModal = useModal();
  const heldModal = useModal();
  const receiptModal = useModal();
  const lineEditModal = useModal();
  const serialModal = useModal();
  const customerModal = useModal();
  const discountModal = useModal();
  const tenderModal = useModal();
  // Naming a parked ticket. See askHold().
  const holdModal = useModal();
  // "Estimate bana do" / "Advance rakh do" — the cart becomes a promise
  // instead of a sale.
  const documentModal = useModal();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [serialKey, setSerialKey] = useState<string | null>(null);

  // In-stock serials for the line being serialized — lets the cashier pick a
  // received IMEI instead of retyping it. Only fetched while the modal is open.
  const serialLineProductId = serialKey ? cart.find((x) => x.key === serialKey)?.product_id : undefined;
  const inStockSerials = useQuery({
    queryKey: ["product-serials", serialLineProductId],
    queryFn: async () => (await catalogService.serials(serialLineProductId!, "in_stock")).data,
    enabled: !!serialLineProductId && serialModal.isOpen,
  });
  const [openingFloat, setOpeningFloat] = useState("");
  // Only ever read when a shift is OPENED — the server fixes the mode for the
  // life of the shift, so this checkbox has no meaning afterwards.
  const [openTraining, setOpenTraining] = useState(false);
  // Shift conflicts are recoverable, so they're shown in the modal with the way
  // out (move the drawer here) rather than thrown away as a toast.
  const [shiftError, setShiftError] = useState<{ message: string; code?: string } | null>(null);
  const [holdLabel, setHoldLabel] = useState("");
  // Half-typed quantities, keyed by cart line. See commitQty().
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // Keying a quantity on a touch till. The +/− steppers are fine for three
  // packets of biscuits and useless for 1.250 kg of mince — that is 1,250 taps
  // at a step of one gram. With the keypad on, the quantity box opens a pad
  // instead of asking the OS for a keyboard that may never come.
  const [padLine, setPadLine] = useState<{ key: string; weight: boolean } | null>(null);
  const [padQty, setPadQty] = useState("");
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  // Modifier configurator (food items with choices / add-ons)
  const [cfg, setCfg] = useState<CatalogProduct | null>(null);
  const [cfgSel, setCfgSel] = useState<Record<string, string[]>>({});

  const openConfig = (p: CatalogProduct) => {
    const sel: Record<string, string[]> = {};
    (p.modifier_groups ?? []).forEach((g) => {
      sel[g.id!] = g.min_select > 0 && g.options[0]?.id ? [g.options[0].id] : [];
    });
    setCfgSel(sel);
    setCfg(p);
  };
  const toggleOpt = (g: NonNullable<CatalogProduct["modifier_groups"]>[number], oid: string) =>
    setCfgSel((s) => {
      const cur = s[g.id!] ?? [];
      if (g.max_select === 1) return { ...s, [g.id!]: [oid] };
      if (cur.includes(oid)) return { ...s, [g.id!]: cur.filter((x) => x !== oid) };
      if (g.max_select > 0 && cur.length >= g.max_select) return s;
      return { ...s, [g.id!]: [...cur, oid] };
    });
  const cfgDelta = cfg ? (cfg.modifier_groups ?? []).reduce((sum, g) => sum + (cfgSel[g.id!] ?? []).reduce((s, oid) => s + Number(g.options.find((o) => o.id === oid)?.price_delta ?? 0), 0), 0) : 0;
  const cfgPrice = cfg ? sellingPrice(cfg) + cfgDelta : 0;
  const cfgValid = cfg ? (cfg.modifier_groups ?? []).every((g) => { const n = (cfgSel[g.id!] ?? []).length; return n >= g.min_select && (g.max_select === 0 || n <= g.max_select); }) : false;

  const addConfigured = () => {
    if (!cfg || !cfgValid) return;
    const optionIds = Object.values(cfgSel).flat();
    const chosen = (cfg.modifier_groups ?? [])
      .flatMap((g) => (cfgSel[g.id!] ?? []).map((oid) => g.options.find((o) => o.id === oid)?.name))
      .filter(Boolean) as string[];
    setCart((c) => [...c, {
      key: `c${++ck}`, product_id: cfg.id, variant_id: null, name: cfg.name,
      unit_price: cfgPrice, quantity: 1, modifier_option_ids: optionIds,
      modifiers_label: chosen.join(", ") || undefined,
    }]);
    setCfg(null);
  };

  const grossSubtotal = useMemo(() => cart.reduce((s, l) => s + lineGross(l), 0), [cart]);
  const lineDiscountTotal = useMemo(() => cart.reduce((s, l) => s + lineDiscountAmt(l), 0), [cart]);
  // Net of per-line discounts — cart/coupon discounts and tax apply on top.
  const subtotal = useMemo(() => cart.reduce((s, l) => s + lineNet(l), 0), [cart]);
  // Tax is SERVER-authoritative; we mirror it here so the cashier's total
  // matches the printed receipt. Per line: product.tax_rate (else the shop
  // default; 0 = exempt) applied to the line's share of the DISCOUNTED base.
  const taxRate = Number(settings.data?.default_tax_rate ?? 0);
  // Loyalty: redeemed points become a discount (points × redeem_value),
  // mirrored here so the cashier's total matches the server-priced sale.
  const loyaltyOn = !!settings.data?.loyalty_enabled;
  const redeemValue = Number(settings.data?.loyalty_redeem_value ?? 1);
  const earnPer = Number(settings.data?.loyalty_earn_per_amount ?? 0);
  const minRedeem = Number(settings.data?.loyalty_min_redeem ?? 0);
  const redeemPtsNum = loyaltyOn ? Math.max(0, Math.floor(Number(redeemPts) || 0)) : 0;
  const loyaltyDiscount = redeemPtsNum * redeemValue;
  // Auto-promo discount (server preview) — folded in like a coupon.
  const promoDiscount = promo?.discount ?? 0;
  const cartDiscount = (Number(discount) || 0) + couponDiscount + promoDiscount + loyaltyDiscount;
  const taxableBase = Math.max(0, subtotal - cartDiscount);
  // INCLUSIVE mode ("prices already include tax"): the tax already sits INSIDE
  // each price, so it is EXTRACTED for display (share − share ÷ (1+rate)) and
  // must NOT be added on top — mirrors CreateSaleAction. Adding it here charged
  // the customer subtotal+tax on a card/exact tender while the sale recorded
  // only subtotal, and handed back a phantom "change" nobody paid.
  const taxInclusive = !!settings.data?.tax_inclusive;
  const taxAmount = subtotal > 0
    ? Math.round(cart.reduce((s, l) => {
        const rate = l.tax_rate == null ? taxRate : l.tax_rate;
        if (rate <= 0) return s;
        const share = lineNet(l) * (taxableBase / subtotal);
        return s + (taxInclusive ? share - share / (1 + rate / 100) : (share * rate) / 100);
      }, 0) * 100) / 100
    : 0;
  const total = Math.max(0, taxInclusive ? taxableBase : taxableBase + taxAmount);
  // Cap redemption to the customer's balance and to the bill (after other
  // discounts); estimate points this sale will earn on the net merchandise.
  const otherDiscount = (Number(discount) || 0) + couponDiscount + promoDiscount;
  const maxRedeemable = Math.max(0, Math.min(customerPoints ?? 0, Math.floor((subtotal - otherDiscount) / (redeemValue || 1))));
  const earnEst = loyaltyOn && earnPer > 0 && customerPhone.trim() !== "" ? Math.floor(Math.max(0, subtotal - cartDiscount) / earnPer) : 0;
  const splitPaid = tenders.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const tradeInTotal = tradeIns.reduce(
    (s, t) => s + (Number(t.quantity) || 1) * (Number(t.unit_allowance) || 0), 0,
  );
  // What the customer still hands over in rupees. Every tender comparison
  // below works off THIS, not the bill — the goods have already settled their
  // share, and asking for the full total again would refuse a paid sale.
  const exactPayable = Math.max(0, Math.round((total - tradeInTotal) * 100) / 100);
  // ── Settling in coins that exist ────────────────────────────────
  // A bill of Rs 1,238.15 has no exact cash tender: sub-rupee coins don't
  // circulate and plenty of counters can't break a five. The shop states the
  // smallest coin it handles and a CASH bill settles to it — the till has to
  // show the cashier the figure they will actually take, or they compute it in
  // their head at the counter and the drawer stops matching. Card and split
  // are exact, so they see the exact number. Mirrors CashRounding on the
  // server, which is the authority; this only has to agree with it on screen.
  const roundingStep = Number(settings.data?.cash_rounding ?? 0);
  const roundCash = (n: number) => {
    if (!roundingStep) return n;
    const units = n / roundingStep;
    const floor = Math.floor(units);
    // A tie goes down, in the customer's favour — same rule as the server.
    return ((units - floor > 0.5 ? floor + 1 : floor) * roundingStep);
  };
  const payable = method === "cash" ? roundCash(exactPayable) : exactPayable;
  const rounding = Math.round((payable - exactPayable) * 100) / 100;
  const change = method === "cash" ? Math.max(0, (Number(tendered) || 0) - payable)
    : method === "split" ? Math.max(0, splitPaid - payable) : 0;

  // Validate a code against a given subtotal and store the resulting discount.
  // Shared by manual apply, resume, and the auto-revalidate effect below.
  const revalidateCoupon = async (code: string, againstSubtotal: number) => {
    setCouponMsg(null);
    try {
      const { data } = await couponsService.validate(code, againstSubtotal);
      setCouponCode(data.code);
      setCouponDiscount(data.discount);
    } catch (e) {
      setCouponCode(null); setCouponDiscount(0);
      setCouponMsg(e instanceof ApiError ? e.message : "Invalid coupon.");
    }
  };
  const applyCoupon = () => {
    if (!couponInput.trim()) return;
    revalidateCoupon(couponInput.trim(), subtotal);
  };
  const clearCoupon = () => { setCouponCode(null); setCouponDiscount(0); setCouponInput(""); setCouponMsg(null); };

  // Keep an applied coupon honest: when the cart (hence subtotal) changes, a
  // percentage coupon's amount or its min-spend eligibility can shift, so
  // re-check it instead of tendering a stale discount. Cleared automatically
  // if it no longer qualifies (e.g. items removed below the minimum spend).
  useEffect(() => {
    if (couponCode) revalidateCoupon(couponCode, subtotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  // Loyalty: look up the attached customer's point balance by phone so the
  // till can show it and offer redemption. Cleared when no/short phone.
  useEffect(() => {
    const phone = customerPhone.trim();
    if (!loyaltyOn || phone.length < 7) { setCustomerPoints(null); setRedeemPts(""); return; }
    let alive = true;
    apiGet<{ loyalty_points: number } | null>("/customers-lookup", { params: { phone } })
      .then(({ data }) => { if (alive) setCustomerPoints(data?.loyalty_points ?? 0); })
      .catch(() => { if (alive) setCustomerPoints(null); });
    return () => { alive = false; };
  }, [customerPhone, loyaltyOn]);

  // Promotions: preview the best auto-promo whenever the cart changes. The
  // server re-applies it authoritatively at checkout — this is display only.
  useEffect(() => {
    if (cart.length === 0) { setPromo(null); return; }
    let alive = true;
    promotionsService
      .preview(cart.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })))
      .then(({ data }) => { if (alive) setPromo(data); })
      .catch(() => { if (alive) setPromo(null); });
    return () => { alive = false; };
  }, [cart]);

  const clearSale = () => {
    setCart([]); setDiscount(""); setTendered(""); setCustomer(""); setCustomerPhone("");
    setTradeIns([]); setTradeInSearch("");
    setVehicle(null); setVehicleSearch(""); setOdometer("");
    setTableNo(""); setOrderType("takeaway"); setMethod("cash"); setTenders([{ method: "cash", amount: "" }]); clearCoupon();
    setRxNumber(""); setRxPrescriber(""); setRxPatient("");
    setCustomerPoints(null); setRedeemPts(""); setPromo(null);
  };

  const checkout = useMutation({
    mutationFn: () =>
      salesService.create({
        channel: "pos",
        cash_session_id: activeSessionId,
        customer_name: customer || undefined,
        customer_phone: customerPhone || undefined,
        ...(isRestaurant
          ? { order_type: orderType, table_no: orderType === "dine_in" ? tableNo || undefined : undefined }
          : {}),
        items: cart.map((l) => ({
          product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity,
          product_unit_id: l.product_unit_id || undefined,
          price_level: l.price_level === "wholesale" ? "wholesale" : undefined,
          // No unit_price sent: the SERVER prices every line (sale price, qty
          // tiers, modifier deltas) — the cart shows an estimate only. A
          // per-line discount is sent as intent; the server validates it.
          ...(l.discountValue && l.discountValue > 0
            ? l.discountMode === "pct"
              ? { line_discount_pct: l.discountValue }
              : { line_discount: l.discountValue }
            : {}),
          modifier_option_ids: l.modifier_option_ids?.length ? l.modifier_option_ids : undefined,
          // Serialized retail: captured serials + any per-sale warranty override.
          ...(l.tracks_serial && l.serials?.some((s) => s.trim())
            ? { serials: l.serials.map((s) => s.trim()).filter(Boolean) }
            : {}),
          ...(l.tracks_serial && l.warranty_months != null ? { warranty_months: l.warranty_months } : {}),
        })),
        discount: Number(discount) || 0,
        coupon_code: couponCode || undefined,
        // Loyalty: points redeemed on this sale (server prices the discount).
        ...(redeemPtsNum > 0 ? { redeem_points: redeemPtsNum } : {}),
        // Tax is server-authoritative (computed per product) — nothing sent.
        // Split payment sends the tender breakdown; otherwise a single tender.
        ...(method === "split"
          ? { payments: tenders.filter((t) => Number(t.amount) > 0).map((t) => ({ method: t.method, amount: Number(t.amount) })) }
          : { payment_method: method, amount_paid: method === "cash" ? Number(tendered) || payable : payable }),
        // Only the lines — never an amount. The server computes the allowance
        // and adds it as a `trade_in` tender itself, because a till that could
        // name its own would be able to settle any bill with nothing crossing
        // the counter.
        ...(tradeIns.length > 0
          ? {
              trade_ins: tradeIns.map((t) => ({
                product_id: t.product_id,
                quantity: Number(t.quantity) || 1,
                unit_allowance: Number(t.unit_allowance) || 0,
                description: t.description.trim() || undefined,
              })),
            }
          : {}),
        // Auto: the vehicle worked on, and the reading taken while it was on
        // the ramp. The vehicle's own record moves forward from this.
        ...(vehicle ? { vehicle_id: vehicle.id } : {}),
        ...(odometer ? { odometer: Number(odometer) } : {}),
        // Pharmacy: prescription record (sent when the cashier filled it in).
        ...(rxNumber || rxPrescriber || rxPatient
          ? { prescription_number: rxNumber || undefined, prescriber_name: rxPrescriber || undefined, patient_name: rxPatient || undefined }
          : {}),
        idempotency_key: idemRef.current,
      }),
    onSuccess: ({ data }) => {
      setLastSale(data);
      clearSale();
      tenderModal.closeModal();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["pos", "session"] });
      receiptModal.openModal();
      setLastPrint(null);
      // The drawer opens on cash, not on card — that's the whole reason the
      // setting exists. `payments` is set for a split tender.
      const tookCash = data.payments?.some((p) => p.method === "cash") ?? data.payment_method === "cash";
      if (tookCash) void openDrawer(false);
      // Auto-print the receipt when the shop setting is on (Shop Settings →
      // POS). Failures are surfaced softly — the receipt modal's Print button
      // is always available as the manual fallback.
      if (settings.data?.pos_auto_print) void printReceipt(data.id);
    },
  });

  const addLine = (p: CatalogProduct | { id: string; name: string; price: string | number; discount_price?: string | number | null; sold_by?: "unit" | "weight"; unit?: string | null; price_tiers?: CartLine["price_tiers"]; units?: ProductUnit[] }, variantId: string | null = null, variantName?: string, variantPrice?: string | number, qtyOverride?: number, unitId?: string | null) => {
    // Rx warning when an item is tapped from the grid/list (scan handles its own).
    if ("requires_prescription" in p && p.requires_prescription) {
      setPosNotice(`℞ ${p.name} requires a prescription`);
    }
    const basePrice = sellingPrice(p);
    const packs = variantId == null && "units" in p ? p.units : undefined;
    const selUnit = unitId && packs ? packs.find((u) => u.id === unitId) : undefined;
    setCart((c) => {
      // A scale-weighed line (qtyOverride) is a distinct package — never merge
      // it into an existing line; add it with its exact weight.
      const existing = qtyOverride == null
        ? c.find((l) => l.product_id === p.id && l.variant_id === variantId && (l.product_unit_id ?? null) === (selUnit?.id ?? null) && !l.modifier_option_ids?.length)
        : undefined;
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, {
        key: `c${++ck}`, product_id: p.id, variant_id: variantId,
        sku: "sku" in p ? (p.sku ?? null) : null,
        name: variantName ? `${p.name} / ${variantName}` : p.name,
        unit_price: selUnit ? packPrice(basePrice, selUnit) : (variantId != null && variantPrice != null ? Number(variantPrice) : basePrice),
        quantity: qtyOverride ?? 1,
        sold_by: "sold_by" in p ? p.sold_by ?? "unit" : "unit",
        unit_label: "unit" in p ? p.unit : null,
        price_tiers: variantId == null && "price_tiers" in p ? p.price_tiers : null,
        product_unit_id: selUnit?.id ?? null,
        unit_name: selUnit?.name ?? null,
        unit_factor: selUnit ? Number(selUnit.factor) : 1,
        units: packs && packs.length ? packs : undefined,
        base_price: basePrice,
        price_level: "retail",
        wholesale_price: "wholesale_price" in p && p.wholesale_price != null ? Number(p.wholesale_price) : null,
        tax_rate: "tax_rate" in p && p.tax_rate != null ? Number(p.tax_rate) : null,
        requires_prescription: "requires_prescription" in p ? !!p.requires_prescription : false,
        tracks_serial: "tracks_serial" in p ? !!p.tracks_serial : false,
        warranty_months: "warranty_months" in p && p.warranty_months != null ? Number(p.warranty_months) : null,
      }];
    });
  };

  // Switch the pack a line is sold in (base unit = ""). Re-prices via recalcLine.
  const setLineUnit = (key: string, unitId: string) =>
    setCart((c) => c.map((l) => (l.key === key
      ? recalcLine(l, {
          product_unit_id: unitId || null,
          unit_name: unitId ? l.units?.find((x) => x.id === unitId)?.name ?? null : null,
          unit_factor: unitId ? Number(l.units?.find((x) => x.id === unitId)?.factor ?? 1) : 1,
        })
      : l)));

  // Switch a line's price level (retail / wholesale) — re-prices via recalcLine.
  const setLineLevel = (key: string, level: "retail" | "wholesale") =>
    setCart((c) => c.map((l) => (l.key === key ? recalcLine(l, { price_level: level }) : l)));

  const scan = async (code: string) => {
    setScanError(null);
    try {
      const { data } = await posService.lookup(code.trim());
      if (data.scale) {
        // Scale (embedded-weight) label: add the item with the weighed quantity
        // already filled in — no modifiers path for weighed groceries.
        addLine(data.product, null, undefined, undefined, data.scale.quantity);
      } else if (data.product.modifier_groups?.length) {
        openConfig(data.product);
      } else {
        const v = data.variant_id ? data.product.variants.find((x) => x.id === data.variant_id) : null;
        // A scanned pack barcode preselects that pack on the line.
        addLine(data.product, v?.id ?? null, v?.name, v?.price, undefined, data.product_unit_id ?? null);
      }
      // Cashier warnings (Rx / near-expiry / weighed) — informational, sale continues.
      const notices: string[] = [];
      if (data.scale) notices.push(`${data.product.name}: ${data.scale.quantity} ${data.product.unit ?? "kg"} weighed`);
      if (data.requires_prescription) notices.push(`℞ ${data.product.name} requires a prescription`);
      if (data.near_expiry) notices.push(`${data.product.name}: batch ${data.near_expiry.batch_number} expires in ${data.near_expiry.days} day(s) (${data.near_expiry.expiry_date})`);
      setPosNotice(notices.length ? notices.join(" · ") : null);
      setSearch("");
      posSound.success();
    } catch (e) {
      setScanError(e instanceof ApiError ? e.message : "Lookup failed.");
      posSound.error();
    }
  };

  // Add a product from the results — opens the modifier config if it has
  // choices, blocks out-of-stock, then clears the box so the next scan/search
  // starts fresh (focus never leaves the input, so the cashier keeps typing).
  const commitProduct = (p: CatalogProduct) => {
    const out = p.type === "product" && p.track_inventory && Number(p.stock_quantity) <= 0;
    if (out) {
      posSound.error();
      // At a chemist an out-of-stock brand is rarely the end of the sale: the
      // customer needs the SALT, and something else on the shelf usually has
      // it. Offer that instead of just refusing.
      if (isPharmacy) {
        setSubstituteFor(p.id);
        setPosNotice(`${p.name} is out of stock — checking for an equivalent`);
      } else {
        setPosNotice(`${p.name} is out of stock`);
      }
      return;
    }
    if (p.modifier_groups?.length) openConfig(p); else addLine(p);
    posSound.success();
    setSearch("");
    setActiveIndex(0);
  };

  // Enter in the search box: a long digit string is a barcode → scan it;
  // otherwise add the highlighted result (↑/↓ move the highlight).
  const onSearchEnter = () => {
    const term = search.trim();
    if (/^\d{5,}$/.test(term)) { scan(term); return; }
    if (!tiles.length) return;
    const p = tiles[Math.min(activeIndex, tiles.length - 1)];
    if (p) commitProduct(p);
  };

  /**
   * Set a line's quantity. Deliberately CANNOT delete the line.
   *
   * It used to: anything <= 0 filtered the row out, and the quantity box wrote
   * straight through on every keystroke. So clearing "1" to type "2" produced
   * an empty string for one keystroke, which parsed to 0, which deleted the
   * row — the cashier lost the line, its discount and any serials they had
   * keyed, mid-edit, for doing the most ordinary thing possible. Removing a
   * line is now only ever the ✕, which is an unambiguous request.
   */
  const setQty = (key: string, q: number) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: Math.max(l.sold_by === "weight" ? 0.001 : 1, q) } : l)));

  /** Forget a line's in-progress quantity edit. */
  const clearQtyDraft = (key: string) =>
    setQtyDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));

  const removeLine = (key: string) => {
    setCart((c) => c.filter((l) => l.key !== key));
    clearQtyDraft(key);
  };

  /**
   * What the quantity box is SHOWING while it's being typed in, per line. The
   * cart itself only ever holds a valid quantity; this lets the field sit empty
   * or half-typed without the cart having to represent that.
   */
  const commitQty = (l: CartLine) => {
    const raw = qtyDraft[l.key];
    clearQtyDraft(l.key);
    if (raw === undefined) return;
    const n = Number(raw);
    // Empty or nonsense → snap back to what it was. Never a deletion, and
    // never a silent zero.
    if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return;
    setQty(l.key, n);
  };

  const setLineDiscount = (key: string, value: number, mode: "amt" | "pct") =>
    setCart((c) => c.map((l) => (l.key === key
      ? { ...l, discountValue: value > 0 ? value : undefined, discountMode: value > 0 ? mode : undefined }
      : l)));

  // Serialized retail: set the serial for the i-th unit on a line.
  const setLineSerial = (key: string, i: number, value: string) =>
    setCart((c) => c.map((l) => {
      if (l.key !== key) return l;
      const next = [...(l.serials ?? [])];
      next[i] = value;
      return { ...l, serials: next };
    }));

  const setLineWarranty = (key: string, months: number | null) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, warranty_months: months } : l)));

  // Count of serials actually keyed on a line (blanks don't count).
  const serialCount = (l: CartLine): number => (l.serials ?? []).filter((s) => s.trim()).length;

  /**
   * Park the ticket under a NAME. A drafts list of "Held sale · Held sale ·
   * Held sale" is unusable the moment there is more than one — the cashier has
   * to resume each in turn to find the right customer, in front of that
   * customer. The prompt pre-fills from whatever name is already on the cart,
   * so naming it is usually just pressing Enter.
   */
  const askHold = () => {
    if (cart.length === 0) return;
    setHoldLabel(customer.trim() || "");
    holdModal.openModal();
  };

  const doHold = () => {
    if (cart.length === 0) return;
    heldMut.hold.mutate(
      {
        label: holdLabel.trim() || undefined, total_estimate: total,
        // Park the WHOLE ticket so nothing is lost on resume.
        cart: {
          items: cart.map((l) => { const copy = { ...l }; delete (copy as Partial<CartLine>).key; return copy; }),
          // The name typed at the hold prompt becomes the cart's customer when
          // the cart had none — otherwise resuming loses the one piece of
          // information the cashier just took the trouble to record.
          customer_name: customer.trim() || holdLabel.trim() || undefined,
          customer_phone: customerPhone || undefined,
          discount: Number(discount) || 0,
          order_type: orderType,
          table_no: tableNo || undefined,
          coupon_code: couponCode,
          // Held tickets store a simple tender; split/credit are re-chosen at
          // checkout (credit also needs the customer confirmed), so park as cash.
          payment_method: method === "split" || method === "credit" ? "cash" : method,
        },
      },
      { onSuccess: () => { clearSale(); setHoldLabel(""); holdModal.closeModal(); } },
    );
  };

  /**
   * Resume a parked ticket by CLAIMING it: the server hands the cart back and
   * deletes the ticket in one locked step. Now that a ticket belongs to the
   * whole site, two lanes can open the held list at the same moment — whoever
   * loses the claim is told, instead of ringing the same basket twice.
   */
  const resume = (h: HeldSale) => {
    heldMut.claim.mutate(h.id, {
      onSuccess: (res) => {
        applyHeld(res.data ?? h);
        heldModal.closeModal();
      },
      onError: () => {
        setPosNotice(`"${h.label || "That ticket"}" was already resumed at another register.`);
        heldModal.closeModal();
      },
    });
  };

  const applyHeld = (h: HeldSale) => {
    setCart(h.cart.items.map((l) => ({
      key: `c${++ck}`, product_id: l.product_id, variant_id: l.variant_id ?? null, name: l.name,
      unit_price: l.unit_price, quantity: l.quantity,
      sold_by: (l as Partial<CartLine>).sold_by ?? "unit",
      unit_label: (l as Partial<CartLine>).unit_label ?? null,
      price_tiers: (l as Partial<CartLine>).price_tiers ?? null,
      product_unit_id: (l as Partial<CartLine>).product_unit_id ?? null,
      unit_name: (l as Partial<CartLine>).unit_name ?? null,
      unit_factor: (l as Partial<CartLine>).unit_factor ?? 1,
      units: (l as Partial<CartLine>).units,
      base_price: (l as Partial<CartLine>).base_price,
      price_level: (l as Partial<CartLine>).price_level ?? "retail",
      wholesale_price: (l as Partial<CartLine>).wholesale_price ?? null,
      tax_rate: (l as Partial<CartLine>).tax_rate ?? null,
      discountValue: l.discountValue, discountMode: l.discountMode,
      modifier_option_ids: l.modifier_option_ids, modifiers_label: l.modifiers_label,
    })));
    setCustomer(h.cart.customer_name ?? "");
    setCustomerPhone(h.cart.customer_phone ?? "");
    setDiscount(h.cart.discount ? String(h.cart.discount) : "");
    setOrderType(h.cart.order_type ?? "takeaway");
    setTableNo(h.cart.table_no ?? "");
    setMethod(h.cart.payment_method ?? "cash");
    // Re-validate the parked coupon against the resumed cart (subtotal may
    // differ from when it was applied) rather than trusting a stale amount.
    if (h.cart.coupon_code) {
      setCouponInput(h.cart.coupon_code);
      revalidateCoupon(h.cart.coupon_code, h.cart.items.reduce((s, l) => s + l.unit_price * l.quantity, 0));
    } else {
      clearCoupon();
    }
  };

  if (!hasPermission("sales.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to use the POS." />;
  }

  const catList = categories.data ?? [];
  // A credit (khata) sale — full or a split tender — needs a named customer.
  const hasCustomer = !!(customer.trim() || customerPhone.trim());
  const cartHasRx = cart.some((l) => l.requires_prescription);
  const splitHasCredit = method === "split" && tenders.some((t) => t.method === "credit" && Number(t.amount) > 0);
  const creditNeedsCustomer = (method === "credit" || splitHasCredit) && !hasCustomer;
  // The allowance can never exceed the bill: the shop would owe the customer
  // money for their scrap, which is buying stock, not selling any.
  const tradeInTooBig = tradeInTotal > total;
  const canCheckout = cart.length > 0 && !!open && !creditNeedsCustomer && !tradeInTooBig && (
    method === "cash" ? (Number(tendered) || 0) >= payable
      : method === "credit" ? total > 0
      : method === "split" ? total > 0 && splitPaid >= payable
      : true
  );
  const quickTenders = [payable, Math.ceil(payable / 500) * 500, Math.ceil(payable / 1000) * 1000, Math.ceil(payable / 5000) * 5000]
    .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
    .slice(0, 4);

  // Publish the current handlers for the keyboard-shortcut listener.
  actionsRef.current = {
    focusSearch: () => scanRef.current?.focus(),
    hold: () => { if (cart.length > 0) askHold(); },
    pay: () => { if (cart.length > 0 && open) { setMethod("cash"); setTendered((t) => t || String(payable)); tenderModal.openModal(); } },
    openHeld: () => { held.refetch(); heldModal.openModal(); },
    document: () => { if (cart.length > 0) documentModal.openModal(); },
    clearSearch: () => setSearch(""),
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <PageMeta title="POS | ShopOS" description="Point of sale terminal" />

      {/* Covers the till, keeping the cart intact underneath: locking is not
          the end of a sale, it's the end of a person's turn at the counter. */}
      {tillLocked && <TillLock />}

      {/* Same salt, in stock — opened when a prescribed brand is out. */}
      <SubstitutePicker
        isOpen={substituteFor !== null}
        onClose={() => setSubstituteFor(null)}
        productId={substituteFor}
        onPick={(alt) => {
          addLine({ id: alt.id, name: alt.name, price: alt.price });
          setPosNotice(`Substituted with ${alt.name}`);
          posSound.success();
        }}
      />

      {/* The cart as a promise instead of a sale. Prices are re-derived
          SERVER-side from the product ids — the till's own line prices are a
          display estimate, and a document freezes its price for weeks. */}
      <ParkAsDocumentModal
        isOpen={documentModal.isOpen}
        onClose={documentModal.closeModal}
        lines={cart.map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id,
          product_unit_id: l.product_unit_id || undefined,
          price_level: l.price_level === "wholesale" ? "wholesale" : undefined,
          quantity: l.quantity,
          ...(l.discountValue && l.discountValue > 0
            ? l.discountMode === "pct"
              ? { line_discount_pct: l.discountValue }
              : { line_discount: l.discountValue }
            : {}),
        }))}
        discount={Number(discount) || 0}
        customerName={customer}
        customerPhone={customerPhone}
        total={total}
        onDone={clearSale}
      />

      {/* Practice. A full-width bar rather than a chip among chips: a till in
          training looks EXACTLY like a live one, so the one thing that must
          never be mistaken gets the whole width and sits above everything
          else. It cannot be dismissed — the only way out is closing the
          shift, which is the truth of it. */}
      {training && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-warning-500 px-4 py-1.5 text-center text-theme-sm font-semibold uppercase tracking-wider text-white">
          <AlertIcon className="h-4 w-4 shrink-0" />
          Training shift — nothing here is real
          <span className="hidden font-normal normal-case tracking-normal text-white/85 sm:inline">
            · no stock moves, no money counts, receipts print TRAINING
          </span>
        </div>
      )}

      {/* Top bar — full-screen POS has no app sidebar/header, so it carries
          its own: exit, shift status, keyboard legend, shift + online. */}
      <div className="no-scrollbar flex shrink-0 flex-nowrap items-center justify-between gap-4 overflow-x-auto border-b border-white/10 bg-gray-900 px-4 py-2">
        <div className="flex shrink-0 items-center gap-4">
          <Link
            to="/tenant"
            className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-theme-sm text-white/70 hover:bg-white/10"
            title="Exit POS"
          >
            <ChevronLeftIcon className="h-4 w-4" /> Exit
          </Link>
          <span className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-theme-xs font-medium sm:flex ${open ? "border-success-500/40 bg-success-500/15 text-success-300" : "border-white/15 bg-white/5 text-white/60"}`}>
            <span className={`h-2 w-2 rounded-full ${open ? "bg-success-500" : "bg-white/40"}`} />
            {open ? `Shift open · float ${money(open.opening_float)}` : "No open shift"}
          </span>
          {/* Which lane this device is. Only shown once the shop has lanes —
              a single-counter shop is never asked to think about registers. */}
          {usesLanes && (
            <button
              type="button"
              onClick={laneModal.openModal}
              title="Which register is this device?"
              className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-theme-xs font-medium sm:flex ${
                laneLabel
                  ? "border-brand-500/40 bg-brand-500/15 text-brand-300"
                  : "border-warning-500/40 bg-warning-500/15 text-warning-300"
              }`}
            >
              <DollarLineIcon className="h-3.5 w-3.5" />
              {laneLabel ?? "Pick register"}
            </button>
          )}
        </div>
        {/* gap-3 with wrapping: on a 1366 laptop the legend, the status chips
            and three buttons used to jam into one another. */}
        <div className="flex shrink-0 items-center justify-end gap-4">
          {/* Keyboard legend. The till is keyboard-first, and a cashier learns
              these by GLANCING at them for the first week — a row of identical
              grey chips is read as decoration and never learned. Each key keeps
              the colour of the thing it does, matching its button below, so the
              eye can jump straight to the one it wants. Clickable too: the same
              action, for anyone still reaching for the mouse. */}
          <div className="hidden items-center gap-2.5 xl:flex">
            {SHORTCUTS.map(({ k, label, tone, run }) => (
              <button
                key={k}
                type="button"
                onClick={() => actionsRef.current?.[run]?.()}
                title={`${label} (${k})`}
                className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-theme-xs font-semibold transition hover:brightness-125 ${tone}`}
              >
                <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-sans text-[11px] font-bold tracking-wide text-white">{k}</kbd>
                {label}
              </button>
            ))}
          </div>
          {/* Who the next sale will be stamped with, and one tap to hand over.
              Pressing it locks the till and asks for a PIN, so the outgoing
              cashier's name comes off the sales the moment they step away.
              Given an avatar because that is the shape people press when they
              are looking for "who am I signed in as" — here the affordance and
              the action happen to be the same thing. */}
          <button
            type="button"
            onClick={() => lockTill("manual")}
            title={`${me?.name ?? "This till"} — press to lock and hand over (PIN)`}
            className="hidden items-center gap-2 rounded-full border border-white/30 bg-white/[0.14] py-1 pl-1 pr-3.5 text-theme-xs font-bold text-white shadow-[0_0_0_3px_rgba(255,255,255,0.06)] transition hover:border-brand-400 hover:bg-white/20 sm:flex"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold uppercase text-white ring-2 ring-white/25">
              {me?.name ? initials(me.name) : <UserCircleIcon className="h-4 w-4" />}
            </span>
            <span className="max-w-24 truncate">{me?.name?.split(" ")[0] ?? "Till"}</span>
          </button>

          {/* Standing at someone else's drawer is a state you must not be able
              to forget you are in — every sale from here lands in their
              reconciliation. Stated plainly, next to your own name. */}
          {covering && (
            <span
              title={`Sales you ring go into ${covering.cashier_name ?? "the cashier"}'s drawer. They still count it.`}
              className="flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/15 px-2.5 py-1 text-theme-xs font-semibold text-brand-300"
            >
              Covering {covering.cashier_name ?? "this till"}
            </span>
          )}
          {/* And the other way round: your drawer, someone else on it. */}
          {open?.covered_by && (
            <span
              title={`${open.covered_by.user_name ?? "Someone"} is ringing on your drawer. It is still yours to count.`}
              className="flex items-center gap-1.5 rounded-full border border-warning-500/40 bg-warning-500/15 px-2.5 py-1 text-theme-xs font-semibold text-warning-300"
            >
              {open.covered_by.user_name ?? "Someone"} is covering you
            </span>
          )}
          {/* A rule before the money buttons, so the status chips on the left
              and the actions on the right read as two groups rather than one
              long undifferentiated row. */}
          <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" />

          {/* The X-read. Always reachable — with no shift the panel explains
              why there is nothing to count rather than erroring. Blue: it only
              ever shows you something, it never moves money. */}
          <button
            type="button"
            onClick={drawerModal.openModal}
            title="Count the drawer (X-read)"
            className="flex items-center gap-1.5 rounded-lg border border-blue-light-500/40 bg-blue-light-500/15 px-3 py-1.5 text-theme-sm font-semibold text-blue-light-300 transition hover:bg-blue-light-500/25"
          >
            <DollarLineIcon className="h-4 w-4" /> Drawer
          </button>

          {/* Open vs close are opposite acts and must never be mistaken for
              each other at the end of a long shift: green starts the day,
              amber ends it and asks for a count.

              A reliever gets neither. They are standing at a drawer they will
              never count, so the only thing they can end is their own turn at
              it — "Hand back", not "Close shift". */}
          {covering ? (
            <button
              type="button"
              onClick={() => coverMutations.end.mutate()}
              disabled={coverMutations.end.isPending}
              title={`Give the till back to ${covering.cashier_name ?? "the cashier"}`}
              className="flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/15 px-3 py-1.5 text-theme-sm font-semibold text-brand-300 transition hover:bg-brand-500/25 disabled:opacity-60"
            >
              Hand back
            </button>
          ) : open ? (
            <button
              type="button"
              onClick={closeModal.openModal}
              title="Count up and close this shift"
              className="flex items-center gap-1.5 rounded-lg border border-warning-500/40 bg-warning-500/15 px-3 py-1.5 text-theme-sm font-semibold text-warning-300 transition hover:bg-warning-500/25"
            >
              Close shift
            </button>
          ) : (
            <>
              {/* Somebody else's drawer is open on this lane. Without this the
                  cashier covering a ten-minute break hits REGISTER_BUSY and has
                  no way forward but to count out a drawer that isn't theirs. */}
              {laneIsSomeoneElses && (
                <button
                  type="button"
                  onClick={() => coverMutations.start.mutate({})}
                  disabled={coverMutations.start.isPending}
                  title={`Hold the lane while ${laneIsSomeoneElses} is away — the drawer stays theirs`}
                  className="flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/15 px-3 py-1.5 text-theme-sm font-semibold text-brand-300 transition hover:bg-brand-500/25 disabled:opacity-60"
                >
                  Cover this till
                </button>
              )}
              <button
                type="button"
                onClick={() => { setOpeningFloat(""); openModal.openModal(); }}
                title="Open a shift to start selling"
                className="flex items-center gap-1.5 rounded-lg bg-success-500 px-3.5 py-1.5 text-theme-sm font-semibold text-white transition hover:bg-success-600"
              >
                Open shift
              </button>
            </>
          )}
        </div>
      </div>

      {/* Full-bleed workspace, split 5/7 in the CART's favour. The picker is
          scanned and clicked; the cart is read, corrected and argued over with
          a customer leaning across the counter — it carries more columns
          (qty, rate, discount, tax, total) and needs the room more. Panes are
          divided by a hairline rather than a gutter, so no width is wasted at
          the screen edges. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12">
        {/* ── Products / scan ─────────────────────────────────────── */}
        {/* The scan side sits on the dark primary. Two-tone is doing the work a
            border cannot: the eye finds "where I look things up" and "where the
            money is" without reading a word, which is the whole job at a
            counter you use ten hours a day. Dark on the left also stops white
            product tiles from bleeding into a white page — on this side the
            tile IS the content, so it should be the brightest thing on it. The
            GROUND is deliberately fixed rather than theme-dependent, so the
            two-tone split survives whichever theme the shop runs; the cards on
            it still follow the theme, which is why nothing inside had to be
            re-coloured except the few labels that had no card under them. */}
        <div className="flex min-h-0 flex-col bg-pos-ground p-3 lg:col-span-5">
          {/* Everything you type or scan into, in one raised card. Loose
              controls on a dark ground read as floating; a card gives the
              scan box a home and an edge to aim at. */}
          <div className="mb-3 rounded-2xl bg-white/[0.05] p-2.5 ring-1 ring-white/[0.08]">
            <div className="flex items-stretch gap-2">
              {/* Category dropdown — sits in front of the search box. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setCatMenuOpen((o) => !o)}
                  className={`flex h-12 items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 ${catMenuOpen ? "border-brand-400 ring-4 ring-brand-400/25" : "border-transparent"}`}
                >
                  <span className="max-w-[7rem] truncate">{categoryId === "" ? "All" : (catList.find((c) => c.id === categoryId)?.name ?? "All")}</span>
                  <ChevronDownIcon className={`h-4 w-4 shrink-0 text-gray-500 transition ${catMenuOpen ? "rotate-180 text-brand-500" : ""}`} />
                </button>
                {catMenuOpen && (
                  <>
                    <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setCatMenuOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      <button type="button" onClick={() => { setCategoryId(""); setCatMenuOpen(false); }}
                        className={`flex w-full items-center px-3 py-2.5 text-sm transition ${categoryId === "" ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10" : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"}`}>
                        All categories{categoryId === "" && <CheckLineIcon className="ml-auto h-4 w-4" />}
                      </button>
                      {catList.map((c) => (
                        <button key={c.id} type="button" onClick={() => { setCategoryId(c.id); setCatMenuOpen(false); }}
                          className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition ${categoryId === c.id ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10" : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"}`}>
                          <span className="truncate">{c.name}</span>{categoryId === c.id && <CheckLineIcon className="ml-auto h-4 w-4 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* Search */}
              <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"><SearchGlyph /></span>
              <input
                ref={scanRef}
                autoFocus
                placeholder="Scan barcode or search by name / SKU…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setScanError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); onSearchEnter(); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, tiles.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
                }}
                className="h-12 w-full rounded-xl border border-transparent bg-white pl-11 pr-24 text-sm text-gray-800 shadow-sm transition placeholder:text-gray-400 focus:border-brand-400 focus:outline-hidden focus:ring-4 focus:ring-brand-400/25"
              />
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                <button
                  type="button"
                  onClick={() => { const next = !soundMuted; posSound.setMuted(next); setSoundMuted(next); if (!next) posSound.success(); scanRef.current?.focus(); }}
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
                  title={soundMuted ? "Scan sounds off — click to enable" : "Scan sounds on — click to mute"}
                  aria-label={soundMuted ? "Enable scan sounds" : "Mute scan sounds"}
                >
                  {soundMuted ? <SpeakerOffGlyph /> : <SpeakerOnGlyph />}
                </button>
                {search ? (
                  <button onClick={() => { setSearch(""); scanRef.current?.focus(); }} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5" title="Clear (Esc)"><CloseIcon className="h-4 w-4" /></button>
                ) : (
                  <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-sans text-[10px] text-gray-400 sm:inline dark:border-gray-700 dark:bg-gray-800">F2</kbd>
                )}
              </div>
              </div>
            </div>
            {/* Live hint: how many results + how to add with the keyboard. */}
            {search.trim() && !scanError && (
              <p className="mt-1.5 px-1 text-theme-xs text-white/60">
                {tiles.length === 0 ? "No matches — check the spelling or scan the barcode."
                  : `${tiles.length}${hasMore ? "+" : ""} result${tiles.length === 1 ? "" : "s"} · ↑ ↓ to move · Enter to add`}
              </p>
            )}
            {scanError && <p className="mt-1 text-theme-xs text-error-500">{scanError}</p>}
            {posNotice && (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
                <span className="flex items-center gap-1.5"><AlertIcon className="h-4 w-4 shrink-0" /> {posNotice}</span>
                <button className="shrink-0 text-warning-500 hover:text-warning-600" onClick={() => setPosNotice(null)}><CloseIcon className="h-4 w-4" /></button>
              </div>
            )}
            {/* The reprint tray, at the till rather than in a report: a receipt
                that never came out is a customer still standing there. */}
            {(failedReceipts.data?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-theme-xs text-error-600 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
                <span className="flex items-center gap-1.5">
                  <AlertIcon className="h-4 w-4 shrink-0" />
                  {failedReceipts.data!.length} receipt{failedReceipts.data!.length === 1 ? "" : "s"} didn't print
                </span>
                <button
                  className="shrink-0 font-medium underline hover:no-underline"
                  disabled={printing}
                  onClick={() => {
                    const next = failedReceipts.data![0];
                    void printReceipt(next.sale_id).then(() => failedReceipts.refetch());
                  }}
                >
                  Print {failedReceipts.data![0].sale?.invoice_number ?? "it"} again
                </button>
              </div>
            )}
          </div>

          {/* ── Quick keys ─────────────────────────────────────────────
              What this counter reaches for. A scanner handles everything with
              a barcode; it cannot handle the loose half of a shop — tomatoes,
              rice by the kilo, chai, the samosas by the till — and in a mart
              those are the fastest-moving lines there are. Reaching them meant
              typing a name, per item, all day.

              Derived on the server from what this branch actually sells, with
              un-scannable items first. Nobody maintains it, and it disappears
              the moment the cashier starts searching — a shortlist is only
              useful when you have not already said what you want. */}
          {quickKeys.data && quickKeys.data.length > 0 && search === "" && categoryId === "" && (
            <div className="mb-3 shrink-0">
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className="text-theme-xs font-semibold uppercase tracking-wide text-white/60">Quick keys</span>
                <span className="text-theme-xs text-white/40">· what sells here</span>
              </div>
              <div className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-0.5">
                {quickKeys.data.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => commitProduct(p as unknown as CatalogProduct)}
                    className="group flex max-w-[9rem] shrink-0 snap-start items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.10] px-2.5 py-1.5 text-left transition hover:border-brand-400 hover:bg-white/[0.16] active:bg-brand-500/25"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium leading-tight text-white/90">
                        {p.name}
                      </span>
                      <span className="block text-[10px] leading-tight tabular-nums text-white/60">
                        {money(sellingPrice(p as unknown as CatalogProduct))}
                        {p.sold_by === "weight" && p.unit ? ` /${p.unit}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scrollable product area — only this scrolls, search + category stay put */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* FOOD: visual image-tile grid. */}
          {posLayout === "grid" && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
              {products.isLoading && tiles.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-white/10" />)
              ) : productsDenied ? (
                <div className="col-span-full"><NoAccess reason={productsDenied} what="the product list" /></div>
              ) : tiles.length === 0 ? (
                <p className="col-span-full py-8 text-center text-sm text-white/60">No products match.</p>
              ) : (
                tiles.map((p, i) => {
                  const img = p.images?.[0]?.url;
                  const sale = onSale(p);
                  return (
                    <button
                      key={p.id}
                      ref={i === activeIndex ? activeRef : null}
                      onClick={() => commitProduct(p)}
                      className={`group flex flex-col overflow-hidden rounded-xl border bg-white/[0.10] text-left transition hover:border-brand-400 hover:bg-white/[0.16] ${i === activeIndex ? "border-brand-400 bg-brand-500/25 ring-2 ring-brand-400/70" : "border-white/10"}`}
                    >
                      <div className="relative h-24 w-full bg-black/25">
                        {img ? (
                          <img src={img} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white/30">
                            {p.name.charAt(0)}
                          </div>
                        )}
                        {sale && <span className="absolute left-1.5 top-1.5 rounded bg-error-500 px-1.5 py-0.5 text-[10px] font-bold text-white">SALE</span>}
                        {p.item_type === "deal" && <span className="absolute right-1.5 top-1.5 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">DEAL</span>}
                        {p.modifier_groups?.length ? <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">options</span> : null}
                      </div>
                      <div className="flex flex-1 flex-col justify-between gap-1.5 p-3">
                        <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">{p.name}</span>
                        <span className="text-[13px] font-bold tabular-nums text-brand-200">
                          {money(sellingPrice(p))}
                          {p.sold_by === "weight" && p.unit ? <span className="text-[11px] font-normal text-white/60">/{p.unit}</span> : null}
                          {sale && <span className="ml-1 text-[11px] font-normal text-white/60 line-through">{money(p.price)}</span>}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* GROCERY / PHARMACY / others: dense, scan-first list of rows. */}
          {posLayout === "list" && (
            <div className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.10]">
              {products.isLoading && tiles.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 animate-pulse bg-white/10" />)
              ) : productsDenied ? (
                <NoAccess reason={productsDenied} what="the product list" />
              ) : tiles.length === 0 ? (
                <p className="py-8 text-center text-sm text-white/60">No products match.</p>
              ) : (
                tiles.map((p, i) => {
                  const sale = onSale(p);
                  const out = p.type === "product" && p.track_inventory && Number(p.stock_quantity) <= 0;
                  const active = i === activeIndex;
                  return (
                    <button
                      key={p.id}
                      ref={active ? activeRef : null}
                      disabled={out}
                      onClick={() => commitProduct(p)}
                      className={`group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-brand-500/25 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-brand-400" : "hover:bg-white/[0.06]"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-white">
                          {p.name}
                          {p.brand ? <span className="ml-1.5 text-[11px] font-normal text-white/60">{p.brand}</span> : null}
                        </div>
                        <div className="truncate text-[11px] text-white/60">
                          {p.generic_name ? <span className="text-white/60">{p.generic_name}</span> : null}
                          {p.generic_name && (p.sku || p.type === "product") ? " · " : null}
                          {p.sku ? `#${p.sku}` : null}
                          {p.item_type === "deal" ? `${p.sku ? " · " : ""}Deal` : p.type === "product" && p.track_inventory ? `${p.sku ? " · " : ""}stock ${fmtQty(Number(p.stock_quantity))}${p.unit ? " " + p.unit : ""}` : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[12px] font-bold tabular-nums text-brand-200">
                          {money(sellingPrice(p))}
                          {p.sold_by === "weight" && p.unit ? <span className="text-[11px] font-normal text-white/60">/{p.unit}</span> : null}
                        </div>
                        {sale && <div className="text-[11px] text-white/60 line-through">{money(p.price)}</div>}
                      </div>
                      <span
                        className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                          out
                            ? "border border-white/15 text-white/40"
                            : "bg-brand-500 text-white group-hover:bg-brand-400 group-active:bg-brand-600"
                        }`}
                      >
                        {!out && (
                          <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                          </svg>
                        )}
                        {out ? "Out" : "Add"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {hasMore && (
            /* The shared outline Button is a white pill built for a white
               page; on this ground it read as a stray card among the tiles.
               Same control, dressed for where it actually lives — and it says
               how much is left rather than only how much is loaded, because
               "20 of 340" is what tells a cashier to search instead of page. */
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={products.isFetching}
                className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.10] px-5 py-2.5 text-[13px] font-semibold text-white/85 transition hover:border-brand-400 hover:bg-white/[0.16] hover:text-white disabled:opacity-50"
              >
                {products.isFetching ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                    Loading…
                  </>
                ) : (
                  <>
                    Load more
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white/70">
                      {tiles.length} of {pagination?.total ?? tiles.length}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
          </div>
        </div>

        {/* ── Cart + payment ──────────────────────────────────────── */}
        {/* The money side wears the shop's colour. Two panes of identical
            white read as one long spreadsheet, and the cart is the half a
            cashier must find without looking — glance down, the tinted band IS
            the basket. The band carries the colour and the cart floats on it as
            a plain white card, so every chip, row and figure inside stays
            exactly as legible as it was; colour is doing navigation here, not
            decoration, and it never lands on anything you have to read. */}
        <div className="flex min-h-0 flex-col bg-pos-ground p-3 lg:col-span-7">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white dark:bg-gray-900">
            {/* Cart header — item count, customer, clear */}
            <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-3 dark:border-brand-500/20 dark:bg-brand-500/10">
              <span className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight text-gray-900 dark:text-white">
                Cart
                {/* The count is the one number in this header, so it gets a
                    ring to lift it off the tinted band rather than sitting
                    flat in it. */}
                {cart.length > 0 && (
                  <span className="min-w-6 rounded-full bg-brand-500 px-2 py-0.5 text-center text-[11px] font-bold tabular-nums text-white ring-2 ring-white dark:ring-gray-900">
                    {cart.length}
                  </span>
                )}
              </span>

              {/* Live promotion, pinned beside the Cart title.
                  It used to sit under the item list, inside the scroll area, so
                  on any basket longer than the panel it scrolled out of sight:
                  the cashier could see money coming off the bill and no longer
                  see why — which is exactly what the customer asks about. The
                  shop is giving this discount automatically, so it stays on
                  screen for the whole sale. */}
              {promo && promo.discount > 0 && (
                <span
                  title={`${promo.name} · −${money(promo.discount)}`}
                  className="flex min-w-0 items-center gap-2 rounded-full border border-brand-300 bg-white py-0.5 pl-0.5 pr-2.5 text-theme-xs text-brand-700 shadow-[0_1px_2px_rgba(70,95,255,0.10)] dark:border-brand-500/40 dark:bg-gray-900 dark:text-brand-300"
                >
                  <span className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Promo</span>
                  <span className="truncate font-medium">{promo.name}</span>
                  <span className="shrink-0 font-bold tabular-nums text-warning-600 dark:text-warning-400">−{money(promo.discount)}</span>
                </span>
              )}
              {/* Customer — defaults to walk-in; click to attach a name/phone.
                  Built as an avatar pill so the two states are legible at a
                  glance rather than by reading: a grey outline with a generic
                  glyph means nobody is attached to this sale, a brand avatar
                  with their initials means somebody is, and khata/loyalty
                  therefore apply. Same shape as the till's own identity button,
                  because it answers the same kind of question. */}
              {(() => {
                const named = (customer || customerPhone || "").trim();
                return (
                  <button
                    onClick={customerModal.openModal}
                    className={`ml-auto flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-theme-sm font-medium transition ${
                      named
                        ? "border-brand-300 bg-white text-brand-700 hover:border-brand-400 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
                        : "border-gray-300 bg-white text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-transparent dark:text-gray-300"
                    }`}
                    title={named ? `Customer: ${named} — click to change` : "No customer attached — click to add one"}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase ${
                        named ? "bg-brand-500 text-white" : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {named ? initials(named) : <UserCircleIcon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="max-w-32 truncate">{named || "Walk-in"}</span>
                  </button>
                );
              })()}
              {/* Emptying the basket is destructive, so it wears the colour of
                  what it does before the hand arrives — same rule as Reset in
                  the footer. Solid red under the finger. */}
              {cart.length > 0 && (
                <button
                  onClick={clearSale}
                  title="Clear cart"
                  aria-label="Clear cart"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-error-200 bg-error-50 text-error-500 transition hover:border-error-500 hover:bg-error-500 hover:text-white dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400 dark:hover:bg-error-500 dark:hover:text-white"
                >
                  <TrashBinIcon className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Restaurant: dine-in / takeaway + table */}
            {isRestaurant && (
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
                {(["takeaway", "dine_in"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    className={`rounded-lg border px-3 py-1.5 text-theme-sm ${orderType === t ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"}`}
                  >
                    {t === "dine_in" ? "Dine-in" : "Takeaway"}
                  </button>
                ))}
                {orderType === "dine_in" && (
                  <input
                    value={tableNo}
                    onChange={(e) => setTableNo(e.target.value)}
                    placeholder="Table #"
                    className="h-9 w-24 rounded-lg border border-gray-200 bg-transparent px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                  />
                )}
              </div>
            )}

            {/* Lines + details share ONE scroll area, so the item list keeps the
                most room on short laptop screens; only the totals/payment bar
                below stays pinned and always visible.
                min-h holds room for about seven lines: a basket shorter than
                that shouldn't make the payment bar jump up the screen, and a
                cart that resizes under the cashier's hand is how the wrong row
                gets clicked. */}
            <div className="min-h-[19rem] flex-1 overflow-y-auto">
              <div className="min-w-full overflow-x-auto">
                {cart.length === 0 ? (
                  <p className="py-16 text-center text-sm text-gray-400">Cart is empty — scan or tap a product.</p>
                ) : (
                  <table className="min-w-full border-collapse text-[12px]">
                    <thead>
                      {/* Half-width pane: the code rides under the item name and
                          the discount shows amount + % in one cell, so eight
                          columns carry what ten used to. */}
                      <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <th className="sticky top-0 z-1 w-8 border-b border-brand-100 bg-brand-50 px-2 py-2 text-left font-semibold dark:border-gray-800 dark:bg-gray-900">#</th>
                        <th className="sticky top-0 z-1 border-b border-brand-100 bg-brand-50 px-2 py-2 text-left font-semibold dark:border-gray-800 dark:bg-gray-900">Item</th>
                        <th className="sticky top-0 z-1 border-b border-brand-100 bg-brand-50 px-2 py-2 text-center font-semibold dark:border-gray-800 dark:bg-gray-900">Qty</th>
                        {["Price","Disc","Tax","Total"].map((h) => (<th key={h} className="sticky top-0 z-1 border-b border-brand-100 bg-brand-50 px-2 py-2 text-right font-semibold dark:border-gray-800 dark:bg-gray-900">{h}</th>))}
                        <th className="sticky top-0 z-1 w-8 border-b border-brand-100 bg-brand-50 px-2 py-2 dark:border-gray-800 dark:bg-gray-900" />
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((l, idx) => {
                        const eff = lineUnit(l);
                        const isWeight = l.sold_by === "weight";
                        const step = isWeight ? 0.25 : 1;
                        const disc = lineDiscountAmt(l);
                        const gross = lineGross(l);
                        const discPct = disc > 0 && gross > 0 ? Math.round((disc / gross) * 100) : 0;
                        const rate = l.tax_rate == null ? taxRate : l.tax_rate;
                        // Same inclusive/exclusive rule as the cart total.
                        const lineShare = subtotal > 0 ? lineNet(l) * (taxableBase / subtotal) : 0;
                        const lineTax = rate > 0
                          ? (taxInclusive ? lineShare - lineShare / (1 + rate / 100) : (lineShare * rate) / 100)
                          : 0;
                        const hasWholesale = l.wholesale_price != null && Number(l.wholesale_price) > 0;
                        return (
                          <tr key={l.key} onClick={() => { setEditKey(l.key); lineEditModal.openModal(); }}
                            className="cursor-pointer border-b border-gray-100 transition hover:bg-brand-50/40 dark:border-gray-800 dark:hover:bg-brand-500/5">
                            <td className="px-2 py-1.5 text-left font-medium text-gray-400 tabular-nums">{idx + 1}</td>
                            <td className="px-2 py-1.5 text-left">
                              <div className="font-semibold leading-tight text-gray-900 dark:text-white/90">{l.name}</div>
                              <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                                {l.sku ? <span className="font-medium text-brand-600 tabular-nums dark:text-brand-400">{l.sku}</span> : null}
                                {isWeight && l.unit_label ? <span>per {l.unit_label}</span> : null}
                                {l.unit_name ? <span>{l.unit_name}</span> : null}
                                {!l.product_unit_id && l.price_level !== "wholesale" && eff < (l.base_price ?? l.unit_price) ? <span className="font-medium text-success-500">bulk</span> : null}
                                {l.modifiers_label ? <span className="truncate">{l.modifiers_label}</span> : null}
                              </div>
                              {(l.tracks_serial || hasWholesale) && (
                                <div className="mt-1 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  {l.tracks_serial && (
                                    <button type="button" onClick={() => { setSerialKey(l.key); serialModal.openModal(); }}
                                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${serialCount(l) >= l.quantity ? "bg-success-50 text-success-600 dark:bg-success-500/10" : "bg-warning-50 text-warning-600 dark:bg-warning-500/10"}`}>
                                      IMEI {serialCount(l)}/{Math.floor(l.quantity)}
                                    </button>
                                  )}
                                  {hasWholesale && (
                                    <select value={l.price_level ?? "retail"} onChange={(e) => setLineLevel(l.key, e.target.value as "retail" | "wholesale")}
                                      className="h-6 rounded-md border border-gray-200 bg-transparent px-1 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
                                      <option value="retail">Retail</option>
                                      <option value="wholesale">Wholesale</option>
                                    </select>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {/* At the minimum, minus is spent — the ✕ two
                                    columns over is how you remove a line, and
                                    stepping down into a deletion is how people
                                    lose one by accident. */}
                                <button type="button" aria-label="Decrease" disabled={l.quantity <= (isWeight ? 0.001 : 1)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 dark:bg-gray-800 dark:text-gray-300"
                                  onClick={() => setQty(l.key, l.quantity - step)}><MinusGlyph /></button>
                                <input type="number" min="0" step={isWeight ? 0.001 : 1}
                                  // While typing, the box shows the draft — it may be empty
                                  // or half a number, which the cart itself never has to be.
                                  value={qtyDraft[l.key] ?? fmtQty(l.quantity)}
                                  // Click in and type: the old value is replaced instead of
                                  // having to be deleted first, which is what caused the
                                  // empty-string keystroke in the first place.
                                  onFocus={(e) => {
                                    // On a keypad till, the box is a target, not
                                    // a text field — hand it to the pad rather
                                    // than waiting on an OS keyboard.
                                    if (showPad) {
                                      e.currentTarget.blur();
                                      setPadLine({ key: l.key, weight: isWeight });
                                      setPadQty(fmtQty(l.quantity));
                                      return;
                                    }
                                    e.currentTarget.select();
                                  }}
                                  onChange={(e) => setQtyDraft((d) => ({ ...d, [l.key]: e.target.value }))}
                                  onBlur={() => commitQty(l)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                                    // Abandon the edit and put the old number back.
                                    if (e.key === "Escape") {
                                      clearQtyDraft(l.key);
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  className="h-7 w-12 rounded-md border border-gray-200 bg-transparent text-center text-theme-sm tabular-nums focus:border-brand-400 focus:outline-none dark:border-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                <button type="button" aria-label="Increase" className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500 text-white hover:bg-brand-600" onClick={() => setQty(l.key, l.quantity + step)}><PlusGlyph /></button>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{money(eff)}</td>
                            <td className={`px-2 py-1.5 text-right tabular-nums ${disc > 0 ? "font-medium text-warning-600 dark:text-warning-400" : "text-gray-400"}`}>
                              {disc > 0 ? (
                                <>
                                  −{money(disc)}
                                  {discPct > 0 && <div className="text-[11px] font-normal text-gray-400">{discPct}%</div>}
                                </>
                              ) : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{lineTax > 0 ? money(lineTax) : "—"}</td>
                            <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900 dark:text-white/90">{money(lineNet(l))}</td>
                            <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                              {/* The ONE way a line leaves the cart, so it is
                                  worth being able to hit: a proper 28px target
                                  that turns red on approach, instead of a pale
                                  grey glyph the cashier stabs at twice. */}
                              <button
                                type="button"
                                title="Remove this line"
                                aria-label="Remove"
                                onClick={() => removeLine(l.key)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-gray-400 transition hover:border-error-200 hover:bg-error-50 hover:text-error-600 dark:text-gray-500 dark:hover:border-error-500/40 dark:hover:bg-error-500/10 dark:hover:text-error-400"
                              >
                                <CloseIcon className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

            {/* Contextual extras — only render when there's something to show,
                so nothing floats in the middle of an otherwise-empty panel.
                The promotion is NOT here any more: it moved up beside the Cart
                title, where it can't scroll away mid-sale. */}
            {((loyaltyOn && customerPoints !== null) || cartHasRx) && (
            <div className="space-y-2.5 border-t border-gray-100 p-4 pt-3 dark:border-gray-800">
              {/* Loyalty — shown when enabled and a known customer is attached. */}
              {loyaltyOn && customerPoints !== null && (
                <div className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-800">
                  <div className="flex items-center justify-between text-theme-sm">
                    <span className="text-gray-500 dark:text-gray-400">Loyalty points</span>
                    <span className="font-medium text-gray-800 dark:text-white/90">{customerPoints} available</span>
                  </div>
                  {customerPoints > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number" min="0" max={maxRedeemable} value={redeemPts}
                        onChange={(e) => setRedeemPts(e.target.value)} placeholder="Redeem points"
                        className="h-8 w-28 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm dark:border-gray-700"
                      />
                      {redeemPtsNum > 0 && <span className="text-theme-xs font-medium text-success-600">−{money(loyaltyDiscount)}</span>}
                      {maxRedeemable > 0 && redeemPtsNum !== maxRedeemable && (
                        <button type="button" onClick={() => setRedeemPts(String(maxRedeemable))} className="text-theme-xs text-brand-500 hover:text-brand-600">Max {maxRedeemable}</button>
                      )}
                    </div>
                  )}
                  {redeemPtsNum > 0 && redeemPtsNum < minRedeem && (
                    <p className="mt-1 text-theme-xs text-error-500">Minimum {minRedeem} points to redeem.</p>
                  )}
                  {earnEst > 0 && <p className="mt-1 text-theme-xs text-gray-400">This sale earns ~{earnEst} pts</p>}
                </div>
              )}

              {/* Auto: the vehicle on the ramp. A tyre shop's real customer
                  key — what a warranty claim hangs off, and what lets the
                  counter say "your alignment was 11,000 km ago" instead of
                  guessing. Shown for the trades that work on vehicles; never
                  required, and invisible everywhere else. */}
              {isAutoTrade && (
                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  {vehicle === null ? (
                    <>
                      <div className="mb-2 text-theme-sm font-medium text-gray-500 dark:text-gray-400">Vehicle (optional)</div>
                      <input
                        value={vehicleSearch}
                        onChange={(e) => setVehicleSearch(e.target.value.toUpperCase())}
                        placeholder="Registration — e.g. LEA-1234"
                        className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 font-mono text-theme-sm uppercase dark:border-gray-700 dark:bg-gray-900"
                      />
                      {vehicleSearch.trim().length >= 2 && (
                        <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                          {(vehicleResults.data ?? []).map((v) => (
                            <button key={v.id} type="button"
                              onClick={() => { setVehicle(v); setVehicleSearch(""); }}
                              className="block w-full px-2 py-1.5 text-left text-theme-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5">
                              <span className="font-mono font-medium">{v.registration}</span>
                              {(v.make || v.model) && <span className="text-gray-400"> · {[v.make, v.model].filter(Boolean).join(" ")}</span>}
                              {v.tyre_size && <span className="text-gray-400"> · {v.tyre_size}</span>}
                            </button>
                          ))}
                          {/* A plate nobody has seen before is the normal case,
                              not an error — register it without leaving the sale. */}
                          {(vehicleResults.data ?? []).length === 0 && !vehicleResults.isLoading && (
                            <button type="button"
                              disabled={quickCreateVehicle.isPending}
                              onClick={() =>
                                quickCreateVehicle.mutate(
                                  { registration: vehicleSearch.trim() },
                                  { onSuccess: ({ data }) => { setVehicle(data); setVehicleSearch(""); } },
                                )
                              }
                              className="block w-full px-2 py-2 text-left text-theme-sm text-brand-600 transition hover:bg-gray-50 dark:hover:bg-white/5">
                              + Register <span className="font-mono font-medium">{vehicleSearch.trim()}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-gray-800 dark:text-white/90">{vehicle.registration}</span>
                          <button onClick={() => { setVehicle(null); setOdometer(""); }} className="text-gray-400 hover:text-error-500" aria-label="Remove vehicle">
                            <CloseIcon className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="truncate text-theme-xs text-gray-400">
                          {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No make recorded"}
                          {vehicle.tyre_size ? ` · takes ${vehicle.tyre_size}` : ""}
                          {vehicle.odometer ? ` · last seen at ${vehicle.odometer.toLocaleString()} km` : ""}
                        </div>
                      </div>
                      <input
                        type="number" min="0" value={odometer}
                        onChange={(e) => setOdometer(e.target.value)}
                        placeholder="Odometer"
                        className="h-9 w-32 rounded-lg border border-gray-200 bg-white px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Pharmacy: prescription capture — shown when the cart holds an
                  Rx-required medicine. Optional, but recorded on the sale. */}
              {cartHasRx && (
                <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-500/30 dark:bg-warning-500/10">
                  <div className="mb-2 flex items-center gap-1.5 text-theme-sm font-medium text-warning-700 dark:text-warning-400">
                    <AlertIcon className="h-4 w-4" /> Prescription details
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={rxNumber} onChange={(e) => setRxNumber(e.target.value)} placeholder="Rx number"
                      className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900" />
                    <input value={rxPatient} onChange={(e) => setRxPatient(e.target.value)} placeholder="Patient name"
                      className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900" />
                    <input value={rxPrescriber} onChange={(e) => setRxPrescriber(e.target.value)} placeholder="Prescriber / doctor"
                      className="col-span-2 h-9 rounded-lg border border-gray-200 bg-white px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900" />
                  </div>
                </div>
              )}
            </div>
            )}
            </div>

            {/* Totals strip + Grand Total + Tender/Pay (opens the modal) */}
            <div className="grid shrink-0 grid-cols-1 gap-2.5 rounded-b-2xl border-t border-gray-100 bg-gray-50 p-2.5 sm:grid-cols-3 dark:border-gray-800 dark:bg-gray-900/40">
              {/* Eight figures used to carry identical weight, so "Charges
                  Rs 0" shouted as loudly as the subtotal and the eye had to
                  read all eight to find the two that moved. A zero is now
                  greyed, money is the only thing set bold, and the customer —
                  which is not a number — loses the tabular figures it never
                  should have had. */}
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:col-span-2 dark:border-gray-800 dark:bg-white/[0.02]">
                {(() => {
                  const discountTotal = cartDiscount + lineDiscountTotal;
                  const cells: Array<{ k: string; v: string; num?: boolean; tone?: "discount" | "muted" }> = [
                    { k: "Total Items", v: String(cart.length), num: true, tone: cart.length ? undefined : "muted" },
                    { k: "Total Qty", v: fmtQty(cart.reduce((s, l) => s + l.quantity, 0)), num: true, tone: cart.length ? undefined : "muted" },
                    { k: "Sub Total", v: money(grossSubtotal), num: true, tone: grossSubtotal ? undefined : "muted" },
                    { k: "Discount", v: discountTotal > 0 ? `−${money(discountTotal)}` : money(0), num: true, tone: discountTotal > 0 ? "discount" : "muted" },
                    { k: "Taxable", v: money(taxableBase), num: true, tone: taxableBase ? undefined : "muted" },
                    { k: "Tax", v: money(taxAmount), num: true, tone: taxAmount ? undefined : "muted" },
                    { k: "Charges", v: money(0), num: true, tone: "muted" },
                    { k: "Customer", v: customer || customerPhone || "Walk-in", tone: (customer || customerPhone) ? undefined : "muted" },
                  ];
                  return cells.map((c, i) => (
                    <div key={i} className="min-w-0">
                      <div className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wider text-gray-400 dark:text-gray-500">{c.k}</div>
                      <div
                        className={`mt-0.5 truncate text-[15px] font-bold leading-tight ${c.num ? "tabular-nums" : ""} ${
                          c.tone === "discount"
                            ? "text-warning-600 dark:text-warning-400"
                            : c.tone === "muted"
                              ? "text-gray-300 dark:text-gray-600"
                              : "text-gray-900 dark:text-white/90"
                        }`}
                      >
                        {c.v}
                      </div>
                    </div>
                  ));
                })()}
              </div>
              <div className="flex flex-col justify-center rounded-xl border border-brand-200 bg-gradient-to-br from-brand-100 to-brand-50 px-4 py-3 dark:border-brand-500/30 dark:from-brand-500/15 dark:to-brand-500/5">
                <div className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-brand-600 dark:text-brand-400">Grand Total</div>
                <div className="mb-2 mt-1 text-4xl font-extrabold leading-none tabular-nums text-gray-900 dark:text-white">{money(total)}</div>
                <button type="button" disabled={cart.length === 0 || !open}
                  onClick={() => { setMethod("cash"); setTendered((t) => t || String(payable)); tenderModal.openModal(); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-base font-bold text-white transition hover:bg-brand-600 disabled:opacity-40">
                  <CardGlyph /> Tender / Pay <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-sans text-[11px]">F9</kbd>
                </button>
                {!open && <p className="mt-1.5 text-center text-theme-xs text-warning-600 dark:text-warning-400">Open a shift to sell.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar. Ordered by what a hand reaches for: Reset is the only
          destructive one and sits alone on the left, well away from the three
          ticket actions on the right — a mis-click there loses the basket.
          Hold / Drafts / Quote carry the same colours as their keys in the top
          legend, so "F4" and the amber button are visibly the same thing. */}
      <div className="no-scrollbar flex shrink-0 items-center gap-3 overflow-x-auto border-t border-white/10 bg-gray-900 px-4 py-2 xl:px-10 2xl:px-16">
        {/* The footer's left half was empty while the top bar was fighting for
            room. The two things that belong here are the ones a cashier never
            acts on and only ever glances at: what this screen is, and whether
            it can still reach the server. */}
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">Point of Sale</span>
          {/* Connection. This used to be a green dot that said "Online" no
              matter what — the one indicator that must never lie, since the
              cashier decides whether to re-ring a sale by looking at it. */}
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-theme-xs font-semibold sm:flex ${
              connected
                ? "border-success-500/40 bg-success-500/15 text-success-300"
                : "border-error-500/50 bg-error-500/15 text-error-300"
            }`}
            title={connected ? "The till reached the server on its last request." : "The last request never reached the server. Sales can't be rung until this clears."}
          >
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-success-500" : "bg-error-500 animate-pulse"}`} />
            {connected ? "Online" : online ? "No server" : "Offline"}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-3">
          {/* Reset lives with the others now, but keeps its own gap and a red
              hover: near enough to reach, far enough that the hand going for
              Hold doesn't land on the one that empties the basket. */}
          <button
            onClick={clearSale}
            disabled={cart.length === 0}
            className="mr-2 flex items-center gap-1.5 rounded-lg border border-error-500/50 bg-error-500/15 px-3.5 py-2 text-theme-sm font-semibold text-error-300 transition hover:border-error-600 hover:bg-error-600 hover:text-white disabled:opacity-40"
            title="Empty this ticket"
          >
            <TrashBinIcon className="h-4 w-4" /> Reset
          </button>

          {/* Discount / coupon — stays next to the money it changes. */}
          <button
            type="button"
            onClick={discountModal.openModal}
            title="Discount / coupon"
            className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-theme-sm font-semibold transition ${
              Number(discount) > 0 || couponCode
                ? "border-success-400 bg-success-500/25 text-success-200"
                : "border-warning-500/50 bg-warning-500/15 text-warning-300 hover:border-warning-400 hover:bg-warning-500/25 hover:text-warning-200"
            }`}
          >
            <PlusIcon className="h-4 w-4" />
            {Number(discount) > 0 || couponCode
              ? `Discount −${money((Number(discount) || 0) + couponDiscount)}`
              : "Add discount"}
          </button>

          <span className="mx-1 h-6 w-px bg-white/15" />

          <button
            onClick={askHold}
            disabled={cart.length === 0 || heldMut.hold.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-warning-500/40 bg-warning-500/15 px-3.5 py-2 text-theme-sm font-semibold text-warning-300 transition hover:bg-warning-500/25 disabled:opacity-40"
            title="Hold this ticket (F4)"
          >
            <PauseGlyph /> Hold
            <kbd className="rounded bg-white/15 px-1 py-px font-sans text-[10px] font-bold">F4</kbd>
          </button>

          <button
            onClick={() => { held.refetch(); heldModal.openModal(); }}
            className="flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/15 px-3.5 py-2 text-theme-sm font-semibold text-orange-300 transition hover:bg-orange-500/25"
            title="Open a parked ticket (F6)"
          >
            <ListIcon className="h-4 w-4" /> Drafts
            {held.data?.length ? (
              <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{held.data.length}</span>
            ) : null}
            <kbd className="rounded bg-white/15 px-1 py-px font-sans text-[10px] font-bold">F6</kbd>
          </button>

          {/* A hold is for the next five minutes; this is for the next five
              weeks. Sits beside Hold because the cashier reaches for it in the
              same moment — "the customer isn't buying today". */}
          <button
            onClick={documentModal.openModal}
            disabled={cart.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-success-500/40 bg-success-500/15 px-3.5 py-2 text-theme-sm font-semibold text-success-300 transition hover:bg-success-500/25 disabled:opacity-40"
            title="Quotation or advance booking (F7)"
          >
            <ListIcon className="h-4 w-4" /> Quote / Advance
            <kbd className="rounded bg-white/15 px-1 py-px font-sans text-[10px] font-bold">F7</kbd>
          </button>
        </div>
      </div>

      {/* Name the parked ticket — see askHold(). */}
      <Modal isOpen={holdModal.isOpen} onClose={holdModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Hold this ticket</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          {cart.length} item{cart.length === 1 ? "" : "s"} · {money(total)}
        </p>
        <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
          Whose ticket is it?
        </label>
        {/* A plain input rather than the shared one: this field wants focus the
            moment the prompt opens and Enter to commit, and the shared Input
            exposes neither. */}
        <input
          autoFocus
          value={holdLabel}
          onChange={(e) => setHoldLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doHold(); }}
          placeholder="Customer name, or 'blue shirt'"
          className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
        />
        <p className="mt-1.5 text-theme-xs text-gray-400">
          Anything that identifies them. A drafts list of unnamed tickets means opening each one
          to find the right customer — in front of the customer.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={holdModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={doHold} disabled={heldMut.hold.isPending}>
            {heldMut.hold.isPending ? "Holding…" : "Hold ticket"}
          </Button>
        </div>
      </Modal>

      {/* Discount & coupon */}
      <Modal isOpen={discountModal.isOpen} onClose={discountModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Discount &amp; coupon</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Manual discount (Rs)</label>
            <Input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Coupon code</label>
            {couponCode ? (
              <div className="flex items-center justify-between rounded-lg bg-success-50 px-3 py-2 text-theme-sm text-success-700 dark:bg-success-500/10">
                <span>{couponCode} · −{money(couponDiscount)}</span>
                <button className="text-gray-500 hover:text-error-500" onClick={clearCoupon}><CloseIcon className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder="Coupon code"
                  className="h-11 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900" />
                <button onClick={applyCoupon} className="rounded-lg border border-brand-500 px-4 text-theme-sm text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">Apply</button>
              </div>
            )}
            {couponMsg && <p className="mt-1 text-theme-xs text-error-500">{couponMsg}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={() => { setDiscount(""); clearCoupon(); }}>Clear</Button>
          <Button size="sm" onClick={discountModal.closeModal}>Done</Button>
        </div>
      </Modal>

      {/* Tender / Pay */}
      <Modal isOpen={tenderModal.isOpen} onClose={tenderModal.closeModal} className="max-w-lg p-0">
        <div onKeyDown={(e) => { if (e.key === "Enter" && canCheckout && !checkout.isPending) { e.preventDefault(); checkout.mutate(); } }}>
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Tender / Pay</h3>
            <button onClick={tenderModal.closeModal} className="text-gray-400 hover:text-gray-700"><CloseIcon className="h-5 w-5" /></button>
          </div>
          <div className="px-6 py-5">
            <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-baseline justify-between">
                <span className="text-theme-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                  {tradeInTotal > 0 ? "To pay" : "Amount due"}
                </span>
                <span className="text-3xl font-extrabold tabular-nums text-gray-900 dark:text-white">{money(payable)}</span>
              </div>
              {/* The bill and the goods, stated separately. The customer is
                  being charged the full price — their old unit is settling part
                  of it, not reducing what the shop asked for. */}
              {tradeInTotal > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-brand-200/60 pt-2 text-theme-xs dark:border-brand-500/20">
                  <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Bill</span><span className="tabular-nums">{money(total)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Traded in</span><span className="tabular-nums">− {money(tradeInTotal)}</span>
                  </div>
                </div>
              )}
              {/* The bill and what it settles to, stated separately — the
                  cashier is taking a figure the drawer can actually hold, and
                  the customer is entitled to see where the difference went. */}
              {rounding !== 0 && (
                <div className="mt-2 space-y-0.5 border-t border-brand-200/60 pt-2 text-theme-xs dark:border-brand-500/20">
                  <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Bill</span><span className="tabular-nums">{money(exactPayable)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Rounded to nearest {cur} {roundingStep}</span>
                    <span className="tabular-nums">{rounding < 0 ? "−" : "+"} {money(Math.abs(rounding))}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Goods taken in part-payment ───────────────────────────
                The dead battery on the counter. Recorded as a tender, so the
                sale keeps its price and the scrap becomes stock the shop can
                count — instead of a discount that loses both. */}
            {has("inventory") && (
              <div className="mb-5 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-theme-sm font-medium text-gray-500 dark:text-gray-400">Take goods in part-payment</span>
                  {tradeInTotal > 0 && (
                    <span className="text-theme-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">{money(tradeInTotal)}</span>
                  )}
                </div>

                {tradeIns.map((t, i) => (
                  <div key={i} className="mb-2 rounded-lg bg-gray-50 p-2 dark:bg-white/[0.04]">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{t.product_name}</span>
                      <button onClick={() => setTradeIns((xs) => xs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-error-500" aria-label="Remove trade-in">
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input type="number" min="0" step={1} value={t.quantity} placeholder="Qty"
                        onChange={(e) => setTradeIns((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                      <Input type="number" min="0" value={t.unit_allowance} placeholder="Allowance"
                        onChange={(e) => setTradeIns((xs) => xs.map((x, j) => (j === i ? { ...x, unit_allowance: e.target.value } : x)))} />
                      <Input value={t.description} placeholder="e.g. Osaka 70Ah"
                        onChange={(e) => setTradeIns((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    </div>
                  </div>
                ))}

                <Input value={tradeInSearch} placeholder="Search the item taken in — scrap battery, used tyre…"
                  onChange={(e) => setTradeInSearch(e.target.value)} />
                {tradeInSearch.trim().length > 1 && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    {tradeInOptions.length === 0 ? (
                      <p className="px-2 py-3 text-center text-theme-xs text-gray-400">
                        No stock item matches. Add one (e.g. "Scrap Battery") so what comes in can be counted.
                      </p>
                    ) : (
                      tradeInOptions.map((p) => (
                        <button key={p.id} type="button"
                          onClick={() => {
                            setTradeIns((xs) => [...xs, {
                              product_id: p.id, product_name: p.name,
                              quantity: "1", unit_allowance: "", description: "",
                            }]);
                            setTradeInSearch("");
                          }}
                          className="block w-full truncate px-2 py-1.5 text-left text-theme-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5">
                          {p.name}
                        </button>
                      ))
                    )}
                  </div>
                )}

                {tradeInTooBig && (
                  <p className="mt-2 text-theme-xs text-error-500">
                    The allowance is more than the bill. The shop would owe them money — record that as a purchase instead.
                  </p>
                )}
              </div>
            )}
            <div className="mb-2 text-theme-sm font-medium text-gray-500 dark:text-gray-400">Payment method</div>
            <div className="mb-5 grid grid-cols-4 gap-2">
              {(["cash", "card", "credit", "split"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-theme-sm font-medium transition ${method === m ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"}`}>
                  <MethodIcon m={m} />
                  {m === "credit" ? "Khata" : m === "split" ? "Split" : m === "card" ? "Card" : "Cash"}
                  {m === "cash" && <span className="text-[9px] font-bold uppercase text-gray-400">Default</span>}
                </button>
              ))}
            </div>
            {method === "cash" && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-theme-sm font-medium text-gray-500 dark:text-gray-400">Amount tendered</span>
                  {/* A tablet on a stand may have no keyboard at all, and the
                      OS one covers the figures the cashier is reading. Opt-in
                      per terminal, remembered — a shop with a real keyboard
                      never sees it. */}
                  <button
                    type="button"
                    onClick={() => setShowPad(!showPad)}
                    className={`rounded-lg border px-2.5 py-1 text-theme-xs font-medium transition-colors ${
                      showPad
                        ? "border-brand-400 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-400"
                        : "border-gray-300 text-gray-500 hover:text-brand-600 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    Keypad
                  </button>
                </div>
                <div className="mb-3"><Input type="number" min="0" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="Cash tendered" /></div>
                <div className="mb-4 flex flex-wrap gap-2">
                  {quickTenders.map((v) => (
                    <button key={v} onClick={() => setTendered(String(v))}
                      className={`rounded-lg border px-3.5 py-2 text-theme-sm font-semibold tabular-nums ${Number(tendered) === v ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"}`}>
                      {v === total ? `Exact · ${Number(v).toLocaleString()}` : Number(v).toLocaleString()}
                    </button>
                  ))}
                </div>
                {showPad && (
                  <NumPad
                    value={tendered}
                    onChange={setTendered}
                    className="mb-4"
                    allowDecimal={false}
                  />
                )}
                <div className="flex items-baseline justify-between border-t border-dashed border-gray-200 pt-3 dark:border-gray-700">
                  <span className="font-medium text-gray-500 dark:text-gray-400">Change due</span>
                  <span className="text-2xl font-extrabold tabular-nums text-success-600">{money(change)}</span>
                </div>
              </div>
            )}
            {method === "credit" && (
              <div className={`rounded-lg border p-3 text-theme-sm ${creditNeedsCustomer ? "border-error-200 bg-error-50 text-error-600 dark:border-error-500/30 dark:bg-error-500/10" : "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-400"}`}>
                {creditNeedsCustomer ? "Attach a customer (Customer button) to sell on credit — the balance is tracked against them." : <>Adds <span className="font-semibold">{money(payable)}</span> to {customer || customerPhone}'s khata (to pay later).</>}
              </div>
            )}
            {method === "split" && (
              <div className="space-y-2">
                {tenders.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={t.method} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, method: e.target.value as typeof x.method } : x)))}
                      className="h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                      <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Transfer</option><option value="credit">Credit (khata)</option>
                    </select>
                    <div className="flex-1"><Input type="number" min="0" value={t.amount} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="Amount" /></div>
                    {tenders.length > 1 && <button onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))} className="text-gray-400 hover:text-error-500" aria-label="Remove tender"><CloseIcon className="h-4 w-4" /></button>}
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button onClick={() => setTenders((ts) => [...ts, { method: "card", amount: "" }])} className="flex items-center gap-1 text-theme-sm text-brand-600 hover:underline"><PlusIcon className="h-4 w-4" /> Add tender</button>
                  <span className={`text-theme-sm font-medium ${splitPaid >= payable ? "text-success-600" : "text-warning-500"}`}>{splitPaid >= payable ? `Change ${money(change)}` : `Remaining ${money(payable - splitPaid)}`}</span>
                </div>
              </div>
            )}
            {checkout.error instanceof ApiError && <div className="mt-3"><Alert variant="error" title="Sale failed" message={checkout.error.message} /></div>}
            {method === "split" && splitHasCredit && !hasCustomer && <p className="mt-3 text-theme-xs text-error-500">Attach a customer to put part of this sale on credit.</p>}
          </div>
          <div className="flex gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
            <Button size="sm" variant="outline" onClick={tenderModal.closeModal}>Cancel</Button>
            <Button size="sm" className="flex-1" onClick={() => checkout.mutate()} disabled={!canCheckout || checkout.isPending}>
              {checkout.isPending ? "Processing…" : method === "credit" ? `Complete · on credit ${money(total)}` : `Complete sale · ${money(payable)}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Open shift */}
      <Modal isOpen={openModal.isOpen} onClose={openModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Open shift</h3>
        {usesLanes && (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {laneLabel ? <>On <span className="font-medium text-gray-700 dark:text-gray-200">{laneLabel}</span>.{" "}</> : "No register picked for this device. "}
            <button type="button" className="text-brand-500 hover:text-brand-600" onClick={() => { openModal.closeModal(); laneModal.openModal(); }}>
              {laneLabel ? "Change register" : "Pick a register"}
            </button>
          </p>
        )}
        <label className="mt-3 text-sm text-gray-500 dark:text-gray-400">Opening cash float</label>
        <Input type="number" min="0" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />

        {/* Chosen here and nowhere else. A switch inside a running shift is how
            practice and real money end up in one drawer, so the only way in or
            out of training is opening and closing a shift. */}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={openTraining}
            onChange={(e) => setOpenTraining(e.target.checked)}
          />
          <span>
            <span className="text-theme-sm font-medium text-gray-700 dark:text-gray-200">Training shift</span>
            <span className="block text-theme-xs text-gray-400">
              For practice. Nothing sold comes off the shelf, no money reaches the day's takings, and
              every receipt prints TRAINING. Close the shift to go back to real sales.
            </span>
          </span>
        </label>

        {shiftError && (
          <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
            <div className="flex items-start gap-1.5"><AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />{shiftError.message}</div>
            {/* The drawer is already open somewhere else — offer the handover
                instead of forcing a close-and-reopen, which would split one
                physical count across two shifts. */}
            {shiftError.code === "SHIFT_OPEN_ELSEWHERE" && terminalId && (
              <Button
                size="sm"
                className="mt-3"
                disabled={shift.move.isPending}
                onClick={() => shift.move.mutate(terminalId, {
                  onSuccess: () => { setShiftError(null); openModal.closeModal(); },
                  onError: (e) => setShiftError({ message: e instanceof ApiError ? e.message : "Could not move the shift." }),
                })}
              >
                {shift.move.isPending ? "Moving…" : `Move my shift to ${laneLabel ?? "this register"}`}
              </Button>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={openModal.closeModal}>Cancel</Button>
          <Button
            size="sm"
            disabled={shift.open.isPending}
            onClick={() => {
              setShiftError(null);
              shift.open.mutate({ float: Number(openingFloat) || 0, registerId: terminalId, training: openTraining }, {
                onSuccess: () => openModal.closeModal(),
                onError: (e) => setShiftError(
                  e instanceof ApiError
                    ? { message: e.message, code: e.errorCode }
                    : { message: "Could not open the shift." },
                ),
              });
            }}
          >
            {shift.open.isPending ? "Opening…" : "Open"}
          </Button>
        </div>
      </Modal>

      {/* Pick this device's register (lane) */}
      <Modal isOpen={laneModal.isOpen} onClose={laneModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">This register</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Which checkout is this device? Remembered on this device only.
        </p>
        <div className="space-y-2">
          {laneList.map((l) => {
            const mine = l.open_session?.user_id === user?.id;
            const busy = !!l.is_busy && !mine;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => { setTerminal(l.id, l.name); laneModal.closeModal(); }}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
                  l.id === terminalId
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                    : "border-gray-200 hover:border-brand-300 dark:border-gray-800"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {l.name}
                    {l.code ? <span className="ml-1.5 text-theme-xs font-normal text-gray-400">{l.code}</span> : null}
                  </div>
                  {/* Busy is information, not a block: a supervisor may still
                      need to stand here, and the server decides the conflict. */}
                  <div className="text-theme-xs text-gray-400">
                    {mine ? "Your open shift" : busy ? `In use · ${l.open_session?.user_name ?? "another cashier"}` : "Free"}
                  </div>
                </div>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${mine ? "bg-brand-500" : busy ? "bg-warning-500" : "bg-success-500"}`} />
                {l.id === terminalId && <CheckLineIcon className="h-4 w-4 shrink-0 text-brand-500" />}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="outline" onClick={laneModal.closeModal}>Done</Button>
        </div>
      </Modal>

      {/* Close shift — counted by note and coin, blind where the shop asks. */}
      <CloseShiftModal
        isOpen={closeModal.isOpen}
        onClose={closeModal.closeModal}
        busy={shift.close.isPending}
        onSubmit={(payload) => shift.close.mutate(payload, { onSuccess: closeModal.closeModal })}
      />

      {/* Drawer X-read + the cashier's cash movements */}
      <CashDrawerPanel
        isOpen={drawerModal.isOpen}
        onClose={drawerModal.closeModal}
        hasOpenShift={!!open}
        coveringFor={covering?.cashier_name ?? null}
      />

      {/* Held sales */}
      <Modal isOpen={heldModal.isOpen} onClose={heldModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Held sales</h3>
        {(held.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No held sales.</p>
        ) : (
          <div className="space-y-2">
            {(held.data ?? []).map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="min-w-0">
                  {/* The name is the headline — it's what the cashier is
                      scanning this list for. Falls back to the cart's own
                      customer before giving up on "Held sale". */}
                  <div className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                    {h.label || h.cart.customer_name || "Unnamed ticket"}
                  </div>
                  {h.cart.customer_phone && (
                    <div className="truncate text-theme-xs text-brand-500">{h.cart.customer_phone}</div>
                  )}
                  <div className="truncate text-theme-xs text-gray-400">
                    {h.cart.items.length} items · {money(h.total_estimate)}
                    {/* The list is site-wide now, so say whose ticket it is and
                        which lane parked it — otherwise six lanes' tickets are
                        an anonymous pile. */}
                    {h.user?.name ? ` · ${h.user.name}` : ""}
                    {h.register?.name ? ` · ${h.register.name}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="text-sm text-brand-500 hover:text-brand-600" onClick={() => resume(h)}>Resume</button>
                  <button className="text-sm text-error-500 hover:text-error-600" onClick={() => heldMut.remove.mutate(h.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Receipt */}
      <Modal isOpen={receiptModal.isOpen} onClose={receiptModal.closeModal} className="max-w-sm p-6">
        {lastSale && (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-2xl">✓</div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Sale complete</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {lastSale.invoice_number}
              {lastSale.order_type && ` · ${lastSale.order_type === "dine_in" ? `Dine-in${lastSale.table_no ? ` · Table ${lastSale.table_no}` : ""}` : "Takeaway"}`}
            </p>
            <div className="my-4 space-y-1 border-y border-gray-100 py-3 text-sm dark:border-gray-800">
              <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-bold">{money(lastSale.total)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Paid</span><span>{money(lastSale.amount_paid)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Change</span><span>{money(lastSale.change_due)}</span></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" disabled={printing}
                onClick={() => printReceipt(lastSale.id)}>
                {printing ? "Printing…" : lastPrint ? "Print again" : "Print receipt"}
              </Button>
              <Button size="sm" className="flex-1" onClick={() => { receiptModal.closeModal(); scanRef.current?.focus(); }}>New sale</Button>
            </div>

            {/* A browser never reports back, so the counter is asked. The
                answer is what puts a receipt in the reprint tray. */}
            {lastPrint && !lastPrint.failed && (
              <div className="mt-3 flex items-center justify-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
                <span>{lastPrint.kind === "gift" ? "Gift copy sent" : lastPrint.kind === "reprint" ? "Copy sent" : "Receipt sent"} to the printer.</span>
                <button type="button" className="font-medium text-error-500 hover:text-error-600" onClick={() => reportPrint("failed")}>
                  Didn't print
                </button>
              </div>
            )}

            <div className="mt-3 flex justify-center gap-4 text-theme-xs">
              <button type="button" className="font-medium text-gray-500 hover:text-brand-500 dark:text-gray-400" disabled={printing}
                onClick={() => printReceipt(lastSale.id, "gift")}>
                Gift receipt
              </button>
              <button type="button" className="font-medium text-gray-500 hover:text-brand-500 dark:text-gray-400"
                onClick={() => void openDrawer()}>
                Open drawer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modifier configurator */}
      {cfg && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4" onClick={() => setCfg(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{cfg.name}</h3>
              <button onClick={() => setCfg(null)} className="text-gray-400 hover:text-gray-700"><CloseIcon className="h-5 w-5" /></button>
            </div>
            {(cfg.modifier_groups ?? []).map((g) => {
              const sel = cfgSel[g.id!] ?? [];
              const rule = g.min_select > 0 ? `Choose ${g.min_select === g.max_select ? g.min_select : `${g.min_select}+`}` : g.max_select > 0 ? `Up to ${g.max_select}` : "Optional";
              return (
                <div key={g.id} className="mb-4">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{g.name}</p>
                    <span className="text-theme-xs text-gray-400">{rule}{g.min_select > 0 ? " · required" : ""}</span>
                  </div>
                  <div className="space-y-1">
                    {g.options.map((o) => {
                      const on = sel.includes(o.id!);
                      return (
                        <button key={o.id} onClick={() => toggleOpt(g, o.id!)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-theme-sm ${on ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-200 dark:border-gray-700"}`}>
                          <span className="flex items-center gap-2">
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center border ${g.max_select === 1 ? "rounded-full" : "rounded"} ${on ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 dark:border-gray-600"}`}>
                              {on && <CheckLineIcon className="h-3 w-3" />}
                            </span>
                            {o.name}
                          </span>
                          {Number(o.price_delta) > 0 && <span className="text-gray-500">+ {money(o.price_delta)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button onClick={addConfigured} disabled={!cfgValid}
              className="mt-2 w-full rounded-lg bg-brand-500 py-2.5 font-medium text-white hover:bg-brand-600 disabled:opacity-40">
              Add · {money(cfgPrice)}
            </button>
          </div>
        </div>
      )}

      {/* Per-line edit — price level, sale unit, discount (server prices the sale) */}
      <Modal isOpen={lineEditModal.isOpen} onClose={lineEditModal.closeModal} className="max-w-lg p-6">
        {(() => {
          const l = editKey ? cart.find((x) => x.key === editKey) : null;
          if (!l) return null;
          const hasWholesale = l.wholesale_price != null && Number(l.wholesale_price) > 0;
          const selectCls = "h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90 disabled:opacity-50";
          return (
            <>
              <div className="mb-5 flex items-start justify-between">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{l.name}</h3>
                <button onClick={lineEditModal.closeModal} className="text-gray-400 hover:text-gray-700"><CloseIcon className="h-5 w-5" /></button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Product price — server-set; the level dropdown changes it */}
                <div>
                  <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Product Price</label>
                  <div className="flex h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-700 tabular-nums dark:border-gray-700 dark:bg-white/5 dark:text-gray-200">
                    {money(lineUnit(l))}<span className="ml-1 text-theme-xs font-normal text-gray-400">/ {l.unit_name ?? l.unit_label ?? "unit"}</span>
                  </div>
                  <p className="mt-1 text-theme-xs text-gray-400">Set on the product — pick a price level to change it.</p>
                </div>
                {/* Price level (Retail / Wholesale) */}
                <div>
                  <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Price Level</label>
                  <select
                    className={selectCls}
                    value={l.price_level ?? "retail"}
                    disabled={!hasWholesale}
                    onChange={(e) => setLineLevel(l.key, e.target.value as "retail" | "wholesale")}
                  >
                    <option value="retail">Retail Price</option>
                    {hasWholesale && <option value="wholesale">Wholesale Price</option>}
                  </select>
                  {!hasWholesale && <p className="mt-1 text-theme-xs text-gray-400">No wholesale price set for this item.</p>}
                </div>
                {/* Sale unit (pack-breaking) */}
                {l.units && l.units.length > 0 && !l.variant_id && (
                  <div>
                    <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Sale Unit</label>
                    <select className={selectCls} value={l.product_unit_id ?? ""} onChange={(e) => setLineUnit(l.key, e.target.value)}>
                      <option value="">{l.unit_label ?? "Each"} (base)</option>
                      {l.units.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} (×{Number(u.factor)})</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Discount + type — needs the discounts permission */}
                {canDiscount && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Discount</label>
                      <Input type="number" min="0" value={l.discountValue ?? ""} placeholder="0"
                        onChange={(e) => setLineDiscount(l.key, Math.max(0, Number(e.target.value) || 0), l.discountMode ?? "amt")} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Discount Type</label>
                      <select className={selectCls} value={l.discountMode ?? "amt"}
                        onChange={(e) => setLineDiscount(l.key, l.discountValue ?? 0, e.target.value as "amt" | "pct")}>
                        <option value="amt">Fixed amount ({cur})</option>
                        <option value="pct">Percent %</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
                <span className="text-sm text-gray-500 dark:text-gray-400">Line total <span className="font-semibold text-gray-800 dark:text-white/90">{money(lineNet(l))}</span></span>
                <Button size="sm" onClick={lineEditModal.closeModal}>Done</Button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* Quantity on a keyboard-less till. Opened from the cart's quantity box
          when the keypad is on — a weight of 1.250 kg is not reachable with a
          stepper, and the OS keyboard is exactly what these terminals lack. */}
      <Modal isOpen={padLine !== null} onClose={() => setPadLine(null)} className="max-w-xs p-5">
        {padLine && (() => {
          const line = cart.find((x) => x.key === padLine.key);
          const commit = () => {
            const n = Number(padQty);
            if (Number.isFinite(n) && n > 0) setQty(padLine.key, n);
            setPadLine(null);
          };

          return (
            <>
              <h3 className="mb-1 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                {line?.name ?? "Quantity"}
              </h3>
              <p className="mb-3 text-theme-xs text-gray-400">
                {padLine.weight ? "Weight" : "How many"}
              </p>
              <div className="mb-3 rounded-xl border border-gray-200 px-3 py-2.5 text-right text-2xl font-bold tabular-nums text-gray-900 dark:border-gray-700 dark:text-white">
                {padQty || "0"}
              </div>
              <NumPad
                value={padQty}
                onChange={setPadQty}
                onSubmit={commit}
                submitLabel="Set quantity"
                allowDecimal={padLine.weight}
              />
            </>
          );
        })()}
      </Modal>

      {/* Serial / IMEI capture — one serial per unit + optional warranty override. */}
      <Modal isOpen={serialModal.isOpen} onClose={serialModal.closeModal} className="max-w-md p-6">
        {(() => {
          const l = serialKey ? cart.find((x) => x.key === serialKey) : null;
          if (!l) return null;
          const units = Math.max(1, Math.floor(l.quantity));
          return (
            <>
              <div className="mb-1 flex items-start justify-between">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Serial / IMEI</h3>
                <button onClick={serialModal.closeModal} className="text-gray-400 hover:text-gray-700"><CloseIcon className="h-5 w-5" /></button>
              </div>
              <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">{l.name} — one serial per unit ({units}).</p>
              <div className="space-y-2">
                {Array.from({ length: units }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-6 text-right text-theme-xs text-gray-400 tabular-nums">{i + 1}.</span>
                    <Input
                      value={l.serials?.[i] ?? ""}
                      onChange={(e) => setLineSerial(l.key, i, e.target.value)}
                      placeholder="Scan or type the serial / IMEI"
                    />
                  </div>
                ))}
              </div>

              {/* In-stock serials picker — tap a received IMEI to fill the next slot. */}
              {(() => {
                const chosen = new Set((l.serials ?? []).map((s) => s.trim()).filter(Boolean));
                const available = (inStockSerials.data ?? []).filter((s) => !chosen.has(s.serial));
                if (available.length === 0) return null;
                const fillNext = (serial: string) => {
                  const idx = Array.from({ length: units }).findIndex((_, i) => !(l.serials?.[i] ?? "").trim());
                  if (idx >= 0) setLineSerial(l.key, idx, serial);
                };
                return (
                  <div className="mt-3">
                    <p className="mb-1.5 text-theme-xs font-medium uppercase text-gray-400">In stock — tap to add</p>
                    <div className="flex flex-wrap gap-1.5">
                      {available.slice(0, 30).map((s) => (
                        <button key={s.id} type="button" onClick={() => fillNext(s.serial)}
                          className="rounded-md bg-brand-50 px-2 py-0.5 text-theme-xs font-medium text-brand-600 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300">
                          {s.serial}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="mt-4">
                <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                  Warranty (months) <span className="font-normal text-gray-400">— overrides the product default</span>
                </label>
                <Input
                  type="number"
                  min="0"
                  value={l.warranty_months ?? ""}
                  placeholder="Product default"
                  onChange={(e) => setLineWarranty(l.key, e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
                <span className="text-theme-sm text-gray-500 dark:text-gray-400">{serialCount(l)}/{units} captured</span>
                <Button size="sm" onClick={serialModal.closeModal}>Done</Button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* Customer — optional; blank = walk-in. Phone links the CRM record. */}
      <Modal isOpen={customerModal.isOpen} onClose={customerModal.closeModal} className="max-w-sm p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Customer</h3>
          <button onClick={customerModal.closeModal} className="text-gray-400 hover:text-gray-700"><CloseIcon className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">Leave blank for a walk-in sale. Add a name or phone only if the customer wants it on record.</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
            <Input placeholder="Customer name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Phone <span className="font-normal text-gray-400">(links CRM)</span></label>
            <Input placeholder="03xx-xxxxxxx" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-between gap-3">
          <Button size="sm" variant="outline" onClick={() => { setCustomer(""); setCustomerPhone(""); customerModal.closeModal(); }}>Walk-in</Button>
          <Button size="sm" onClick={customerModal.closeModal}>Done</Button>
        </div>
      </Modal>
    </div>
  );
}
