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
import { useAuthStore } from "../../../stores/authStore";
import { useCategories, useProducts } from "../../catalog/hooks/useCatalog";
import { catalogService } from "../../catalog/services/catalogService";
import type { Product as CatalogProduct, ProductUnit } from "../../catalog/types";
import { salesService } from "../../sales/services/salesService";
import type { Sale } from "../../sales/types";
import { posService, type HeldSale } from "../services/posService";
import { posSound } from "../posSound";
import { useCurrentSession, useHeldMutations, useHeldSales, useShiftMutations } from "../hooks/usePos";
import { useShopSettings } from "../../shop/hooks/useShop";
import { couponsService } from "../../coupons/services/couponsService";
import { promotionsService, type PromoPreview } from "../../promotions/services/promotionsService";

interface CartLine {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
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
const methodLabel = (m: PayMethod): string =>
  m === "credit" ? "Credit (khata)" : m === "split" ? "Split payment" : m === "card" ? "Card" : "Cash";
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
  const businessType = useAuthStore(
    (s) => (s.user?.tenant as unknown as { business_type?: string })?.business_type,
  );
  // "food" is the current type; "restaurant" is its legacy code (kept for
  // existing tenants). Food shops browse a visual image grid; high-SKU shops
  // (mart, pharmacy, retail…) get a dense, search-first list of rows.
  const isRestaurant = businessType === "food" || businessType === "restaurant";
  const posLayout: "grid" | "list" = isRestaurant ? "grid" : "list";
  const canDiscount = hasPermission("discounts.apply");
  const qc = useQueryClient();

  const session = useCurrentSession();
  const shift = useShiftMutations();
  const held = useHeldSales();
  const heldMut = useHeldMutations();
  const settings = useShopSettings();
  const cur = settings.data?.currency_symbol ?? "Rs";
  const money = (n: string | number) => `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

  // ── Product browser: search + category tabs + accumulated pages ──
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const categories = useCategories();
  const products = useProducts({ search: search || undefined, category_id: categoryId || undefined, page });
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

  // Snap the highlight back to the top whenever the result set changes; keep
  // the highlighted tile scrolled into view as ↑/↓ move it.
  useEffect(() => { setActiveIndex(0); }, [search, categoryId]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  // ── Cart ──────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<"takeaway" | "dine_in">("takeaway");
  const [tableNo, setTableNo] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "credit" | "split">("cash");
  const [tenders, setTenders] = useState<Array<{ method: "cash" | "card" | "bank_transfer" | "credit"; amount: string }>>([{ method: "cash", amount: "" }]);
  const [tendered, setTendered] = useState("");
  const [payMenuOpen, setPayMenuOpen] = useState(false);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => posSound.isMuted());
  // Pharmacy prescription capture (shown when the cart holds an Rx item).
  const [rxNumber, setRxNumber] = useState("");
  const [rxPrescriber, setRxPrescriber] = useState("");
  const [rxPatient, setRxPatient] = useState("");
  // Soft cashier warning (Rx / near-expiry) — never blocks the sale.
  const [posNotice, setPosNotice] = useState<string | null>(null);
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
  const actionsRef = useRef<{ focusSearch: () => void; hold: () => void; pay: () => void; openHeld: () => void; clearSearch: () => void } | undefined>(undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      if (!a) return;
      switch (e.key) {
        case "F2": e.preventDefault(); a.focusSearch(); break;   // jump to scan/search
        case "F4": e.preventDefault(); a.hold(); break;          // hold (park) the ticket
        case "F6": e.preventDefault(); a.openHeld(); break;      // resume a held ticket
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
  const heldModal = useModal();
  const receiptModal = useModal();
  const lineEditModal = useModal();
  const serialModal = useModal();
  const customerModal = useModal();
  const discountModal = useModal();
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
  const [countedCash, setCountedCash] = useState("");
  const [holdLabel, setHoldLabel] = useState("");
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
  const taxAmount = subtotal > 0
    ? Math.round(cart.reduce((s, l) => {
        const rate = l.tax_rate == null ? taxRate : l.tax_rate;
        return rate > 0 ? s + (lineNet(l) * (taxableBase / subtotal) * rate) / 100 : s;
      }, 0) * 100) / 100
    : 0;
  const total = Math.max(0, subtotal - cartDiscount + taxAmount);
  // Cap redemption to the customer's balance and to the bill (after other
  // discounts); estimate points this sale will earn on the net merchandise.
  const otherDiscount = (Number(discount) || 0) + couponDiscount + promoDiscount;
  const maxRedeemable = Math.max(0, Math.min(customerPoints ?? 0, Math.floor((subtotal - otherDiscount) / (redeemValue || 1))));
  const earnEst = loyaltyOn && earnPer > 0 && customerPhone.trim() !== "" ? Math.floor(Math.max(0, subtotal - cartDiscount) / earnPer) : 0;
  const splitPaid = tenders.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const change = method === "cash" ? Math.max(0, (Number(tendered) || 0) - total)
    : method === "split" ? Math.max(0, splitPaid - total) : 0;
  const open = session.data;

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
    setTableNo(""); setOrderType("takeaway"); setMethod("cash"); setTenders([{ method: "cash", amount: "" }]); clearCoupon();
    setRxNumber(""); setRxPrescriber(""); setRxPatient("");
    setCustomerPoints(null); setRedeemPts(""); setPromo(null);
  };

  const checkout = useMutation({
    mutationFn: () =>
      salesService.create({
        channel: "pos",
        cash_session_id: open?.id ?? null,
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
          : { payment_method: method, amount_paid: method === "cash" ? Number(tendered) || total : total }),
        // Pharmacy: prescription record (sent when the cashier filled it in).
        ...(rxNumber || rxPrescriber || rxPatient
          ? { prescription_number: rxNumber || undefined, prescriber_name: rxPrescriber || undefined, patient_name: rxPatient || undefined }
          : {}),
        idempotency_key: idemRef.current,
      }),
    onSuccess: ({ data }) => {
      setLastSale(data);
      clearSale();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["pos", "session"] });
      receiptModal.openModal();
      // Auto-print the receipt when the shop setting is on (Shop Settings →
      // POS). Failures are surfaced softly — the receipt modal's Print button
      // is always available as the manual fallback.
      if (settings.data?.pos_auto_print) {
        salesService.printInvoice(data.id).catch(() =>
          setPosNotice("Auto-print failed — use Print receipt to try again."),
        );
      }
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
    if (out) { setPosNotice(`${p.name} is out of stock`); posSound.error(); return; }
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

  const setQty = (key: string, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: q } : l))));

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

  const doHold = () => {
    if (cart.length === 0) return;
    heldMut.hold.mutate(
      {
        label: holdLabel || undefined, total_estimate: total,
        // Park the WHOLE ticket so nothing is lost on resume.
        cart: {
          items: cart.map(({ key, ...l }) => l),
          customer_name: customer || undefined,
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
      { onSuccess: () => { clearSale(); setHoldLabel(""); } },
    );
  };

  const resume = (h: HeldSale) => {
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
    heldMut.remove.mutate(h.id);
    heldModal.closeModal();
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
  const canCheckout = cart.length > 0 && !!open && !creditNeedsCustomer && (
    method === "cash" ? (Number(tendered) || 0) >= total
      : method === "credit" ? total > 0
      : method === "split" ? total > 0 && splitPaid >= total
      : true
  );
  const quickTenders = [total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000]
    .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
    .slice(0, 4);

  // Publish the current handlers for the keyboard-shortcut listener.
  actionsRef.current = {
    focusSearch: () => scanRef.current?.focus(),
    hold: () => { if (cart.length > 0) doHold(); },
    pay: () => { if (canCheckout && !checkout.isPending) checkout.mutate(); },
    openHeld: () => { held.refetch(); heldModal.openModal(); },
    clearSearch: () => setSearch(""),
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <PageMeta title="POS | ShopOS" description="Point of sale terminal" />

      {/* Top bar — full-screen POS has no app sidebar/header, so it carries
          its own: exit, shift status, keyboard legend, shift + online. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 xl:px-10 2xl:px-16 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center gap-3">
          <Link
            to="/tenant"
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-theme-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            title="Exit POS"
          >
            <ChevronLeftIcon className="h-4 w-4" /> Exit
          </Link>
          <span className="text-base font-bold text-gray-800 dark:text-white/90">Point of Sale</span>
          <span className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-theme-xs font-medium sm:flex ${open ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400" : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-white/5 dark:text-gray-400"}`}>
            <span className={`h-2 w-2 rounded-full ${open ? "bg-success-500" : "bg-gray-400"}`} />
            {open ? `Shift open · float ${money(open.opening_float)}` : "No open shift"}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Keyboard shortcut legend — the till is keyboard-first. */}
          <div className="mr-1 hidden items-center gap-1.5 text-theme-xs text-gray-400 xl:flex">
            {[["F2", "Search"], ["↑↓ ↵", "Add"], ["F4", "Hold"], ["F6", "Held"], ["F9", "Pay"]].map(([k, label]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-sans text-[10px] text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">{k}</kbd>
                {label}
              </span>
            ))}
          </div>
          <span className="hidden items-center gap-1.5 text-theme-xs font-medium text-gray-500 sm:flex dark:text-gray-400">
            <span className="h-2 w-2 rounded-full bg-success-500" /> Online
          </span>
          {open ? (
            <Button size="sm" variant="outline" onClick={() => { setCountedCash(""); closeModal.openModal(); }}>Close shift</Button>
          ) : (
            <Button size="sm" onClick={() => { setOpeningFloat(""); openModal.openModal(); }}>Open shift</Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 p-4 xl:px-10 2xl:px-16 lg:grid-cols-12">
        {/* ── Products / scan ─────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col lg:col-span-7">
          <div className="mb-3">
            <div className="flex items-stretch gap-2">
              {/* Category dropdown — sits in front of the search box. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setCatMenuOpen((o) => !o)}
                  className="flex h-14 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:border-brand-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  <span className="max-w-[7rem] truncate">{categoryId === "" ? "All" : (catList.find((c) => c.id === categoryId)?.name ?? "All")}</span>
                  <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition ${catMenuOpen ? "rotate-180" : ""}`} />
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
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"><SearchGlyph /></span>
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
                className="h-14 w-full rounded-xl border border-gray-200 bg-white pl-12 pr-28 text-base text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
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
              <p className="mt-1.5 px-1 text-theme-xs text-gray-400">
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
          </div>

          {/* Scrollable product area — only this scrolls, search + category stay put */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* FOOD: visual image-tile grid. */}
          {posLayout === "grid" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.isLoading && tiles.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />)
              ) : tiles.length === 0 ? (
                <p className="col-span-full py-8 text-center text-sm text-gray-400">No products match.</p>
              ) : (
                tiles.map((p, i) => {
                  const img = p.images?.[0]?.url;
                  const sale = onSale(p);
                  return (
                    <button
                      key={p.id}
                      ref={i === activeIndex ? activeRef : null}
                      onClick={() => commitProduct(p)}
                      className={`group flex flex-col overflow-hidden rounded-xl border bg-white text-left transition hover:border-brand-400 hover:shadow-md dark:bg-white/[0.03] ${i === activeIndex ? "border-brand-500 ring-2 ring-brand-500/30" : "border-gray-200 dark:border-gray-800"}`}
                    >
                      <div className="relative h-20 w-full bg-gray-100 dark:bg-gray-800">
                        {img ? (
                          <img src={img} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-gray-300 dark:text-gray-600">
                            {p.name.charAt(0)}
                          </div>
                        )}
                        {sale && <span className="absolute left-1.5 top-1.5 rounded bg-error-500 px-1.5 py-0.5 text-[10px] font-bold text-white">SALE</span>}
                        {p.item_type === "deal" && <span className="absolute right-1.5 top-1.5 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">DEAL</span>}
                        {p.modifier_groups?.length ? <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">options</span> : null}
                      </div>
                      <div className="flex flex-1 flex-col justify-between p-2.5">
                        <span className="line-clamp-2 text-sm font-medium text-gray-800 dark:text-white/90">{p.name}</span>
                        <span className="mt-1 font-semibold text-brand-600 dark:text-brand-400">
                          {money(sellingPrice(p))}
                          {p.sold_by === "weight" && p.unit ? <span className="text-theme-xs font-normal text-gray-400">/{p.unit}</span> : null}
                          {sale && <span className="ml-1 text-theme-xs font-normal text-gray-400 line-through">{money(p.price)}</span>}
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
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {products.isLoading && tiles.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 animate-pulse bg-gray-100 dark:bg-gray-800" />)
              ) : tiles.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No products match.</p>
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
                      className={`relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-brand-50 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-brand-500 dark:bg-brand-500/10" : "bg-white hover:bg-brand-50/60 dark:bg-white/[0.02] dark:hover:bg-white/[0.06]"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                          {p.name}
                          {p.brand ? <span className="ml-1.5 text-theme-xs font-normal text-gray-400">{p.brand}</span> : null}
                        </div>
                        <div className="truncate text-theme-xs text-gray-400">
                          {p.generic_name ? <span className="text-gray-500 dark:text-gray-400">{p.generic_name}</span> : null}
                          {p.generic_name && (p.sku || p.type === "product") ? " · " : null}
                          {p.sku ? `#${p.sku}` : null}
                          {p.item_type === "deal" ? `${p.sku ? " · " : ""}Deal` : p.type === "product" && p.track_inventory ? `${p.sku ? " · " : ""}stock ${fmtQty(Number(p.stock_quantity))}${p.unit ? " " + p.unit : ""}` : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                          {money(sellingPrice(p))}
                          {p.sold_by === "weight" && p.unit ? <span className="text-theme-xs font-normal text-gray-400">/{p.unit}</span> : null}
                        </div>
                        {sale && <div className="text-theme-xs text-gray-400 line-through">{money(p.price)}</div>}
                      </div>
                      <span className={`shrink-0 rounded-lg px-2 py-1 text-theme-xs font-medium ${out ? "text-gray-400" : "bg-brand-500 text-white"}`}>
                        {out ? "Out" : "Add"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {hasMore && (
            <div className="mt-4 text-center">
              <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={products.isFetching}>
                {products.isFetching ? "Loading…" : `Load more (${tiles.length} of ${pagination?.total})`}
              </Button>
            </div>
          )}
          </div>
        </div>

        {/* ── Cart + payment ──────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col lg:col-span-5">
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
            {/* Cart header — item count, customer, clear */}
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-white/90">
                Cart
                {cart.length > 0 && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">{cart.length}</span>}
              </span>
              {/* Customer — defaults to walk-in; click to attach a name/phone */}
              <button
                onClick={customerModal.openModal}
                className={`ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-theme-sm ${customer || customerPhone ? "border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-500/10" : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"} hover:bg-gray-100 dark:hover:bg-white/5`}
                title="Customer"
              >
                <UserCircleIcon className="h-4 w-4" />
                <span className="max-w-32 truncate">{customer || customerPhone || "Walk-in"}</span>
              </button>
              {cart.length > 0 && (
                <button onClick={clearSale} title="Clear cart" className="rounded-lg p-1.5 text-gray-400 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"><TrashBinIcon className="h-4 w-4" /></button>
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
                below stays pinned and always visible. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-0.5 p-2 pb-1">
              {cart.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">Cart is empty — scan or tap a product.</p>
              ) : (
                cart.map((l) => {
                  const eff = lineUnit(l);
                  const isWeight = l.sold_by === "weight";
                  const step = isWeight ? 0.25 : 1;
                  const disc = lineDiscountAmt(l);
                  const hasWholesale = l.wholesale_price != null && Number(l.wholesale_price) > 0;
                  return (
                    <div
                      key={l.key}
                      role="button"
                      tabIndex={0}
                      title="Tap to edit line"
                      onClick={() => { setEditKey(l.key); lineEditModal.openModal(); }}
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); setEditKey(l.key); lineEditModal.openModal(); } }}
                      className="cursor-pointer rounded-xl border border-gray-100 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-gray-800 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
                    >
                      <div className="flex items-center gap-2.5">
                        {/* name + unit price */}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{l.name}</div>
                          <div className="truncate text-theme-xs text-gray-400">
                            {money(eff)}{isWeight && l.unit_label ? `/${l.unit_label}` : " ea"}
                            {l.unit_name ? ` · ${l.unit_name}` : null}
                            {!l.product_unit_id && l.price_level !== "wholesale" && eff < (l.base_price ?? l.unit_price) && <span className="ml-1 font-medium text-success-500">bulk</span>}
                          </div>
                        </div>
                        {/* qty stepper */}
                        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button type="button" aria-label="Decrease" className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300" onClick={() => setQty(l.key, Math.max(0, l.quantity - step))}><MinusGlyph /></button>
                          <input
                            type="number"
                            min="0"
                            step={isWeight ? 0.001 : 1}
                            value={fmtQty(l.quantity)}
                            onChange={(e) => setQty(l.key, Math.max(0, Number(e.target.value) || 0))}
                            className="h-6 w-11 rounded-md border border-gray-200 bg-transparent text-center text-theme-sm tabular-nums dark:border-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button type="button" aria-label="Increase" className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500 text-white hover:bg-brand-600" onClick={() => setQty(l.key, l.quantity + step)}><PlusGlyph /></button>
                        </div>
                        {/* line total */}
                        <div className="w-[4.75rem] shrink-0 text-right">
                          <div className="text-sm font-semibold text-gray-800 tabular-nums dark:text-white/90">{money(lineNet(l))}</div>
                          {disc > 0 && <div className="text-[10px] leading-tight text-gray-400 line-through tabular-nums">{money(lineGross(l))}</div>}
                        </div>
                        {/* remove */}
                        <button type="button" title="Remove" aria-label="Remove" className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10" onClick={(e) => { e.stopPropagation(); setQty(l.key, 0); }}><TrashBinIcon className="h-4 w-4" /></button>
                      </div>

                      {/* Extras — only render for items that have them: food modifiers,
                          serialized (IMEI), or a wholesale price list. Keeps the common
                          retail/mart row a single sleek line. */}
                      {(l.modifiers_label || l.tracks_serial || hasWholesale) && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 pl-0.5" onClick={(e) => e.stopPropagation()}>
                          {l.modifiers_label && <span className="min-w-0 flex-1 truncate text-theme-xs text-gray-400">{l.modifiers_label}</span>}
                          {l.tracks_serial && (
                            <button
                              type="button"
                              onClick={() => { setSerialKey(l.key); serialModal.openModal(); }}
                              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-theme-xs font-medium ${serialCount(l) >= l.quantity ? "bg-success-50 text-success-600 dark:bg-success-500/10" : "bg-warning-50 text-warning-600 dark:bg-warning-500/10"}`}
                            >
                              IMEI {serialCount(l)}/{Math.floor(l.quantity)}
                            </button>
                          )}
                          {hasWholesale && (
                            <select
                              value={l.price_level ?? "retail"}
                              onChange={(e) => setLineLevel(l.key, e.target.value as "retail" | "wholesale")}
                              className="h-6 rounded-md border border-gray-200 bg-transparent px-1 text-theme-xs text-gray-600 dark:border-gray-700 dark:text-gray-300"
                            >
                              <option value="retail">Retail</option>
                              <option value="wholesale">Wholesale</option>
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Contextual extras — only render when there's something to show,
                so nothing floats in the middle of an otherwise-empty panel. */}
            {((promo && promo.discount > 0) || (loyaltyOn && customerPoints !== null) || cartHasRx) && (
            <div className="space-y-2.5 border-t border-gray-100 p-4 pt-3 dark:border-gray-800">
              {/* Auto-promotion (no code) — applied automatically when live. */}
              {promo && promo.discount > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-1.5 text-theme-sm text-brand-600 dark:bg-brand-500/10">
                  <span>Promo · {promo.name}</span>
                  <span className="font-medium">−{money(promo.discount)}</span>
                </div>
              )}

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

            {/* Summary + payment — pinned to the bottom, always visible */}
            <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-gray-500 dark:text-gray-400"><span>Subtotal</span><span>{money(grossSubtotal)}</span></div>
                {lineDiscountTotal > 0 && <div className="flex justify-between text-success-600"><span>Line discounts</span><span>−{money(lineDiscountTotal)}</span></div>}
                {Number(discount) > 0 && <div className="flex justify-between text-gray-500"><span>Discount</span><span>−{money(Number(discount))}</span></div>}
                {couponDiscount > 0 && <div className="flex justify-between text-success-600"><span>Coupon</span><span>−{money(couponDiscount)}</span></div>}
                {taxAmount > 0 && <div className="flex justify-between text-gray-500"><span>Tax</span><span>{money(taxAmount)}</span></div>}
              </div>

              {/* Payment method — defaults to cash; tap to switch (opens upward). */}
              <div className="relative mt-3">
                <button
                  type="button"
                  onClick={() => setPayMenuOpen((o) => !o)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 transition hover:border-brand-400 dark:border-gray-700 dark:text-gray-200"
                >
                  <span className="flex items-center gap-2 font-medium"><MethodIcon m={method} /> {methodLabel(method)}</span>
                  <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition ${payMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {payMenuOpen && (
                  <>
                    <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setPayMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-1.5 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      {(["cash", "card", "credit", "split"] as const).map((m) => (
                        <button key={m} type="button"
                          onClick={() => { setMethod(m); setPayMenuOpen(false); }}
                          className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition ${method === m ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10" : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"}`}>
                          <MethodIcon m={m} /> {methodLabel(m)}
                          {method === m && <CheckLineIcon className="ml-auto h-4 w-4" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Credit (khata): the whole total goes on the customer's balance.
                  Needs a named customer (set via the Customer button up top). */}
              {method === "credit" && total > 0 && (
                <div className={`mt-2 rounded-lg border p-3 text-theme-sm ${creditNeedsCustomer ? "border-error-200 bg-error-50 text-error-600 dark:border-error-500/30 dark:bg-error-500/10" : "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-400"}`}>
                  {creditNeedsCustomer
                    ? "Attach a customer (top bar) to sell on credit — the balance is tracked against them."
                    : <>Adds <span className="font-semibold">{money(total)}</span> to {customer || customerPhone}'s khata (to pay later).</>}
                </div>
              )}

              {method === "cash" && total > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1.5">
                    {quickTenders.map((v) => (
                      <button key={v} onClick={() => setTendered(String(v))}
                        className={`flex-1 rounded-lg border py-1.5 text-theme-xs tabular-nums ${Number(tendered) === v ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"}`}>
                        {v === total ? "Exact" : Number(v).toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1"><Input type="number" min="0" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="Cash tendered" /></div>
                    {Number(tendered) > 0 && <span className="whitespace-nowrap text-sm font-medium text-success-600">Change {money(change)}</span>}
                  </div>
                </div>
              )}

              {method === "split" && total > 0 && (
                <div className="mt-2 space-y-2">
                  {tenders.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={t.method}
                        onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, method: e.target.value as typeof x.method } : x)))}
                        className="h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Transfer</option>
                        <option value="credit">Credit (khata)</option>
                      </select>
                      <div className="flex-1">
                        <Input type="number" min="0" value={t.amount}
                          onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                          placeholder="Amount" />
                      </div>
                      {tenders.length > 1 && (
                        <button onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))} className="text-gray-400 hover:text-error-500" aria-label="Remove tender">
                          <CloseIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button onClick={() => setTenders((ts) => [...ts, { method: "card", amount: "" }])}
                      className="flex items-center gap-1 text-theme-sm text-brand-600 hover:underline">
                      <PlusIcon className="h-4 w-4" /> Add tender
                    </button>
                    <span className={`text-theme-sm font-medium ${splitPaid >= total ? "text-success-600" : "text-warning-500"}`}>
                      {splitPaid >= total ? `Change ${money(change)}` : `Remaining ${money(total - splitPaid)}`}
                    </span>
                  </div>
                </div>
              )}

              {checkout.error instanceof ApiError && <div className="mt-2"><Alert variant="error" title="Sale failed" message={checkout.error.message} /></div>}
              {!open && cart.length > 0 && <p className="mt-2 text-theme-xs text-warning-500">Open a shift to complete sales.</p>}
              {method === "split" && splitHasCredit && !hasCustomer && (
                <p className="mt-2 text-theme-xs text-error-500">Attach a customer to put part of this sale on credit.</p>
              )}

              <Button size="sm" className="mt-3 w-full" onClick={() => checkout.mutate()} disabled={!canCheckout || checkout.isPending}>
                {checkout.isPending ? "Processing…" : method === "credit" ? `On credit · ${money(total)}` : `Charge ${money(total)}`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar — ticket-level actions. The total + Charge live in the
          cart panel, so this stays lean: park / resume / reset the ticket. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-4 py-2.5 xl:px-10 2xl:px-16 dark:border-gray-800 dark:bg-white/[0.03]">
        <button
          onClick={doHold}
          disabled={cart.length === 0 || heldMut.hold.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-theme-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          title="Hold ticket (F4)"
        >
          <PauseGlyph /> Hold
        </button>
        <button
          onClick={() => { held.refetch(); heldModal.openModal(); }}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-theme-sm font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          title="Resume held ticket (F6)"
        >
          <ListIcon className="h-4 w-4" /> Drafts{held.data?.length ? <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{held.data.length}</span> : ""}
        </button>
        <button
          onClick={clearSale}
          disabled={cart.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-theme-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          title="Reset ticket"
        >
          <TrashBinIcon className="h-4 w-4" /> Reset
        </button>
        <div className="ml-auto flex items-center gap-4">
          {/* Discount / coupon — right side of the footer, before the total. */}
          <button
            type="button"
            onClick={discountModal.openModal}
            title="Discount / coupon"
            className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-theme-sm font-medium transition ${
              Number(discount) > 0 || couponCode
                ? "border-success-300 bg-success-50 text-success-700 dark:border-success-500/40 dark:bg-success-500/10 dark:text-success-400"
                : "border-gray-200 text-gray-600 hover:border-brand-400 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
            }`}
          >
            <PlusIcon className="h-4 w-4" />
            {Number(discount) > 0 || couponCode
              ? `Discount −${money((Number(discount) || 0) + couponDiscount)}`
              : "Add discount"}
          </button>
          <span className="flex items-baseline gap-2.5 text-gray-500 dark:text-gray-400">
            <span className="uppercase tracking-wide text-theme-xs text-gray-400">Total</span>
            <span className="text-3xl font-bold text-gray-900 tabular-nums dark:text-white">{money(total)}</span>
          </span>
        </div>
      </div>

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

      {/* Open shift */}
      <Modal isOpen={openModal.isOpen} onClose={openModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Open shift</h3>
        <label className="text-sm text-gray-500 dark:text-gray-400">Opening cash float</label>
        <Input type="number" min="0" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={openModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={() => shift.open.mutate(Number(openingFloat) || 0, { onSuccess: openModal.closeModal })} disabled={shift.open.isPending}>Open</Button>
        </div>
      </Modal>

      {/* Close shift */}
      <Modal isOpen={closeModal.isOpen} onClose={closeModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Close shift</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Count the drawer and enter the cash total.</p>
        <label className="text-sm text-gray-500 dark:text-gray-400">Counted cash</label>
        <Input type="number" min="0" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} />
        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={closeModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={() => shift.close.mutate({ counted: Number(countedCash) || 0 }, { onSuccess: closeModal.closeModal })} disabled={shift.close.isPending}>Close shift</Button>
        </div>
      </Modal>

      {/* Held sales */}
      <Modal isOpen={heldModal.isOpen} onClose={heldModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Held sales</h3>
        {(held.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No held sales.</p>
        ) : (
          <div className="space-y-2">
            {(held.data ?? []).map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-white/90">{h.label || "Held sale"}</div>
                  <div className="text-theme-xs text-gray-400">{h.cart.items.length} items · {money(h.total_estimate)}</div>
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
              <Button size="sm" variant="outline" className="flex-1"
                onClick={() => salesService.printInvoice(lastSale.id).catch(() => setPosNotice("Could not load the invoice to print."))}>
                Print receipt
              </Button>
              <Button size="sm" className="flex-1" onClick={() => { receiptModal.closeModal(); scanRef.current?.focus(); }}>New sale</Button>
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
