import { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useConfirm } from "../../../components/ui/confirm";
import { MODAL_CLOSE } from "../../../components/ui/modal/closeButton";
import { useAuthStore } from "../../../stores/authStore";
import { useCartStore, cartKeyOf } from "../../../stores/cartStore";
import { usePlaceOrder } from "../../orders/hooks/useOrders";
import type { PublicModifierGroup, PublicProduct } from "../services/marketplaceService";
import {
  useDeleteReview,
  useFavorites,
  useMarketProducts,
  useMarketShop,
  useMyReviews,
  useShopReviews,
  useSubmitReview,
  useToggleFavorite,
} from "../hooks/useMarketplace";
import { MarketHeader } from "../components/MarketHeader";
import { DeliveryAddressField } from "../components/DeliveryAddressField";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className={onChange ? "cursor-pointer select-none" : "select-none"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={onChange ? () => onChange(n) : undefined}
          className={n <= Math.round(value) ? "text-warning-400" : "text-gray-300 dark:text-gray-700"}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * Public shop page: header (with favorite toggle for customers) + catalog.
 */
export default function MarketShopPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [catId, setCatId] = useState("");
  const debounced = useDebouncedValue(search, 350);

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCustomer = user?.role === "customer";

  const shop = useMarketShop(slug);
  const products = useMarketProducts(slug, { search: debounced, category_id: catId || undefined });
  const favorites = useFavorites(isCustomer);
  const toggleFavorite = useToggleFavorite();
  const reviews = useShopReviews(slug);
  const submitReview = useSubmitReview();
  const myReviews = useMyReviews(isCustomer);
  const deleteReview = useDeleteReview(slug);

  const confirm = useConfirm();
  const cart = useCartStore();
  const placeOrder = usePlaceOrder();
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("pickup");
  const [address, setAddress] = useState("");
  const [couponCode, setCouponCode] = useState("");

  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState("");

  /** The review I already left here, if I left one. */
  const mine = myReviews.data?.find((r) => r.shop_slug === slug) ?? null;

  /**
   * Load my own words back into the box, once.
   *
   * The screen has always said "posting again updates it" and then shown an
   * empty form, which asks somebody to rewrite from memory a review they cannot
   * see. Keyed on the review id so a fresh answer refills the box, but typing
   * is never overwritten while the query refetches.
   */
  const loadedReview = useRef<string | null>(null);
  useEffect(() => {
    if (mine === null || loadedReview.current === mine.id) return;
    loadedReview.current = mine.id;
    setMyRating(mine.rating);
    setMyComment(mine.comment ?? "");
  }, [mine]);

  // Modifier configurator (food items with choices / add-ons)
  const [cfg, setCfg] = useState<PublicProduct | null>(null);
  const [cfgVariant, setCfgVariant] = useState<string | null>(null);
  const [cfgSel, setCfgSel] = useState<Record<string, string[]>>({});

  const openConfig = (p: PublicProduct) => {
    setCfgVariant(p.variants[0]?.id ?? null);
    const sel: Record<string, string[]> = {};
    p.modifier_groups.forEach((g) => {
      const defaults = g.options.filter((o) => o.is_default).map((o) => o.id);
      sel[g.id] = defaults.length ? defaults : g.min_select > 0 && g.options[0] ? [g.options[0].id] : [];
    });
    setCfgSel(sel);
    setCfg(p);
  };

  const toggleOpt = (g: PublicModifierGroup, oid: string) =>
    setCfgSel((s) => {
      const cur = s[g.id] ?? [];
      if (g.max_select === 1) return { ...s, [g.id]: [oid] };
      if (cur.includes(oid)) return { ...s, [g.id]: cur.filter((x) => x !== oid) };
      if (g.max_select > 0 && cur.length >= g.max_select) return s;
      return { ...s, [g.id]: [...cur, oid] };
    });

  const cfgBase = cfg ? Number(cfg.variants.find((v) => v.id === cfgVariant)?.price ?? cfg.price) : 0;
  const cfgDelta = cfg
    ? cfg.modifier_groups.reduce((sum, g) => sum + (cfgSel[g.id] ?? []).reduce((s, oid) => s + Number(g.options.find((o) => o.id === oid)?.price_delta ?? 0), 0), 0)
    : 0;
  const cfgPrice = cfgBase + cfgDelta;
  const cfgValid = cfg
    ? cfg.modifier_groups.every((g) => { const n = (cfgSel[g.id] ?? []).length; return n >= g.min_select && (g.max_select === 0 || n <= g.max_select); })
    : false;

  const addConfigured = () => {
    if (!cfg || !slug || !cfgValid) return;
    const optionIds = Object.values(cfgSel).flat();
    const chosen = cfg.modifier_groups
      .flatMap((g) => (cfgSel[g.id] ?? []).map((oid) => g.options.find((o) => o.id === oid)?.name))
      .filter(Boolean) as string[];
    const variant = cfg.variants.find((v) => v.id === cfgVariant);
    cart.add(slug, {
      product_id: cfg.id,
      variant_id: variant?.id ?? null,
      name: variant ? `${cfg.name} / ${variant.name}` : cfg.name,
      unit_price: cfgPrice,
      in_stock: true,
      modifier_option_ids: optionIds,
      modifiers_label: chosen.join(", ") || undefined,
    });
    setCfg(null);
  };

  const isFavorite = (favorites.data ?? []).some((f) => f.slug === slug);
  const rows = products.data?.data ?? [];
  const reviewRows = reviews.data?.data ?? [];

  const cartActive = cart.shopSlug === slug;
  const cartLines = cartActive ? cart.lines : [];
  const deliveryFee = fulfillment === "delivery" ? (shop.data?.delivery_fee ?? 0) : 0;
  const orderTotal = cart.subtotal() + deliveryFee;
  const acceptsOrders = shop.data?.accepts_orders ?? false;

  const placeError =
    placeOrder.error instanceof ApiError
      ? placeOrder.error.firstFieldError() ?? placeOrder.error.message
      : null;

  const checkout = () => {
    if (!slug || !isCustomer || cartLines.length === 0 || placeOrder.isPending) return;
    if (fulfillment === "delivery" && !address.trim()) return;
    placeOrder.mutate(
      {
        shop_slug: slug,
        fulfillment_type: fulfillment,
        delivery_address: fulfillment === "delivery" ? address.trim() : undefined,
        coupon_code: couponCode.trim() || undefined,
        items: cartLines.map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? undefined,
          quantity: l.quantity,
          modifier_option_ids: l.modifier_option_ids?.length ? l.modifier_option_ids : undefined,
        })),
      },
      {
        onSuccess: () => {
          cart.clear();
          navigate("/my-orders");
        },
      },
    );
  };

  const reviewError =
    submitReview.error instanceof ApiError
      ? submitReview.error.firstFieldError() ?? submitReview.error.message
      : null;

  const sendReview = () => {
    if (!slug || !myRating || submitReview.isPending) return;
    submitReview.mutate({
      shop_slug: slug,
      rating: myRating,
      comment: myComment.trim() || undefined,
    });
    // The box is deliberately not emptied any more. What is in it IS my review
    // now, and clearing it made an update look like it had been discarded.
  };

  const removeReview = async () => {
    if (mine === null || deleteReview.isPending) return;

    const ok = await confirm({
      title: "Remove your review?",
      message: `Your review of ${shop.data?.business_name ?? "this shop"} will be taken down, and the shop's rating will be worked out without it. You can write a new one any time.`,
      confirmLabel: "Remove review",
      tone: "danger",
    });
    if (!ok) return;

    deleteReview.mutate(mine.id, {
      onSuccess: () => {
        loadedReview.current = null;
        setMyRating(0);
        setMyComment("");
      },
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageMeta
        title={`${shop.data?.business_name ?? "Shop"} | CartZe Market`}
        description="Shop catalog"
      />
      <MarketHeader />

      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← All shops
        </Link>

        {/* Shop header */}
        {shop.isLoading ? (
          <div className="mt-4 h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        ) : shop.isError ? (
          <div className="mt-4 rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">
              This shop isn't available right now.
            </p>
          </div>
        ) : shop.data ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand-50 text-2xl font-bold text-brand-500 dark:bg-brand-500/10">
                {shop.data.business_name.charAt(0)}
              </div>
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-white/90">
                  {shop.data.business_name}
                  {shop.data.is_open_now !== undefined && (
                    <span className={`rounded-full px-2 py-0.5 text-theme-xs font-medium ${shop.data.is_open_now ? "bg-success-50 text-success-600 dark:bg-success-500/10" : "bg-error-50 text-error-600 dark:bg-error-500/10"}`}>
                      {shop.data.is_open_now ? "Open now" : "Closed"}
                    </span>
                  )}
                </h1>
                <p className="text-sm capitalize text-gray-500 dark:text-gray-400">
                  {shop.data.business_category ?? shop.data.business_type}
                  {shop.data.city && ` · ${shop.data.city.name}`}
                </p>
                {shop.data.rating !== null ? (
                  <p className="text-sm">
                    <Stars value={shop.data.rating} />{" "}
                    <span className="text-gray-600 dark:text-gray-300">{shop.data.rating}</span>
                    <span className="text-theme-xs text-gray-400"> ({shop.data.reviews_count} reviews)</span>
                  </p>
                ) : (
                  <p className="text-theme-xs text-gray-400">No reviews yet</p>
                )}
                {shop.data.address && (
                  <p className="text-theme-xs text-gray-400">{shop.data.address}</p>
                )}
              </div>
            </div>
            {isCustomer && (
              <button
                onClick={() => slug && toggleFavorite.mutate(slug)}
                disabled={toggleFavorite.isPending}
                className={`rounded-lg border px-4 py-2 text-sm transition ${
                  isFavorite
                    ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                    : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300"
                }`}
              >
                {isFavorite ? "♥ Favorited" : "♡ Add to favorites"}
              </button>
            )}
          </div>
        ) : null}

        {/* Service area + portfolio gallery */}
        {shop.data?.service_area && (
          <p className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
            <span className="font-medium text-gray-800 dark:text-white/90">Service area:</span> {shop.data.service_area}
          </p>
        )}
        {(shop.data?.gallery?.length ?? 0) > 0 && (
          <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
            {shop.data!.gallery!.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" className="h-28 w-28 shrink-0 rounded-xl object-cover" />
            ))}
          </div>
        )}

        {/* Catalog */}
        {shop.data && (
          <>
            <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Products & Services
              </h2>
              <div className="w-64">
                <Input
                  placeholder="Search this shop…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Category chips */}
            {(shop.data.categories?.length ?? 0) > 0 && (
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setCatId("")}
                  className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${catId === "" ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                >
                  All
                </button>
                {shop.data.categories!.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCatId(c.id)}
                    className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${catId === c.id ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {products.isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-44 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
                <p className="text-gray-500 dark:text-gray-400">
                  {debounced ? "Nothing matches your search." : "This shop hasn't listed anything yet."}
                </p>
              </div>
            ) : (
              <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"
                  >
                    <div className="mb-3 flex h-32 items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-3xl dark:bg-gray-800">
                      {p.images?.[0] ? (
                        <img src={p.images[0]} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        p.type === "service" ? "✂️" : "📦"
                      )}
                    </div>
                    <h3 className="truncate font-medium text-gray-800 dark:text-white/90">
                      {p.name}
                    </h3>
                    <p className="text-theme-xs text-gray-400">
                      {p.category?.name}
                      {p.type === "service" && p.duration_minutes ? ` · ${p.duration_minutes} min` : ""}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-semibold text-brand-600 dark:text-brand-400">
                        {money(p.price)}
                        {p.original_price != null && (
                          <span className="ml-1.5 text-theme-xs font-normal text-gray-400 line-through">{money(p.original_price)}</span>
                        )}
                      </span>
                      {p.type === "product" && (
                        <span
                          className={`text-theme-xs ${
                            p.in_stock ? "text-success-500" : "text-error-500"
                          }`}
                        >
                          {p.in_stock ? "In stock" : "Out of stock"}
                        </span>
                      )}
                    </div>
                    {p.variants.length > 0 && (
                      <p className="mt-1 text-theme-xs text-gray-400">
                        {p.variants.length} options
                      </p>
                    )}
                    {/* Add to cart — products, in-stock, ordering shops only */}
                    {acceptsOrders && p.type === "product" && (
                      !p.available_now ? (
                        <p className="mt-3 text-center text-theme-xs text-error-500">Not available right now</p>
                      ) : p.modifier_groups.length > 0 ? (
                        <button
                          disabled={!p.in_stock}
                          onClick={() => openConfig(p)}
                          className="mt-3 w-full rounded-lg bg-brand-500 py-2 text-theme-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
                        >
                          Choose options
                        </button>
                      ) : p.variants.length === 0 ? (
                        <button
                          disabled={!p.in_stock}
                          onClick={() =>
                            slug && cart.add(slug, {
                              product_id: p.id,
                              variant_id: null,
                              name: p.name,
                              unit_price: Number(p.price),
                              in_stock: p.in_stock,
                            })
                          }
                          className="mt-3 w-full rounded-lg bg-brand-500 py-2 text-theme-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
                        >
                          Add to cart
                        </button>
                      ) : (
                        <div className="mt-3 space-y-1">
                          {p.variants.map((v) => (
                            <button
                              key={v.id}
                              disabled={!v.in_stock}
                              onClick={() =>
                                slug && cart.add(slug, {
                                  product_id: p.id,
                                  variant_id: v.id,
                                  name: `${p.name} / ${v.name}`,
                                  unit_price: Number(v.price),
                                  in_stock: v.in_stock,
                                })
                              }
                              className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-2 py-1.5 text-theme-xs hover:border-brand-300 disabled:opacity-40 dark:border-gray-700"
                            >
                              <span>{v.name}</span>
                              <span>+ {money(v.price)}</span>
                            </button>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Cart + checkout */}
            {acceptsOrders && cartLines.length > 0 && (
              <div className="mb-10 rounded-2xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-500/30 dark:bg-brand-500/[0.06]">
                <h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">
                  Your cart ({cart.count()})
                </h3>
                {placeError && <div className="mb-3"><Alert variant="error" title="Couldn't place order" message={placeError} /></div>}
                <div className="space-y-2">
                  {cartLines.map((l) => {
                    const k = cartKeyOf(l);
                    return (
                      <div key={k} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex-1 text-gray-700 dark:text-gray-300">
                          {l.name}
                          {l.modifiers_label && <span className="block text-theme-xs text-gray-400">{l.modifiers_label}</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <button className="h-6 w-6 rounded border border-gray-300 dark:border-gray-700" onClick={() => cart.setQty(k, l.quantity - 1)}>−</button>
                          <span className="w-6 text-center">{l.quantity}</span>
                          <button className="h-6 w-6 rounded border border-gray-300 dark:border-gray-700" onClick={() => cart.setQty(k, l.quantity + 1)}>+</button>
                        </div>
                        <span className="w-24 text-right font-medium text-gray-800 dark:text-white/90">{money(l.unit_price * l.quantity)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
                  <div className="mb-3 flex gap-2">
                    <button
                      onClick={() => setFulfillment("pickup")}
                      className={`rounded-lg border px-4 py-2 text-sm ${fulfillment === "pickup" ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 dark:border-gray-700"}`}
                    >Pickup</button>
                    {shop.data?.features?.delivery && (
                      <button
                        onClick={() => setFulfillment("delivery")}
                        className={`rounded-lg border px-4 py-2 text-sm ${fulfillment === "delivery" ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 dark:border-gray-700"}`}
                      >Delivery {(shop.data?.delivery_fee ?? 0) > 0 ? `(+${money(shop.data!.delivery_fee!)})` : ""}</button>
                    )}
                  </div>
                  {fulfillment === "delivery" && (
                    <div className="mb-3">
                      {/* Picked, not retyped — the saved-address endpoints have
                          been on the server since the marketplace shipped and
                          nothing called them. A signed-out visitor still gets
                          the plain box. */}
                      <DeliveryAddressField
                        value={address}
                        onChange={setAddress}
                        enabled={isAuthenticated && isCustomer}
                      />
                    </div>
                  )}
                  <div className="mb-3">
                    <Input placeholder="Coupon code (optional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
                  </div>
                  <div className="mb-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                    <div className="flex justify-between"><span>Subtotal</span><span>{money(cart.subtotal())}</span></div>
                    {deliveryFee > 0 && <div className="flex justify-between"><span>Delivery</span><span>{money(deliveryFee)}</span></div>}
                    <div className="flex justify-between text-base font-bold text-gray-800 dark:text-white/90"><span>Total</span><span>{money(orderTotal)}</span></div>
                  </div>
                  {!isAuthenticated ? (
                    <Link to="/signin"><Button size="sm" className="w-full">Sign in to order (Cash on delivery)</Button></Link>
                  ) : !isCustomer ? (
                    <p className="text-center text-theme-xs text-gray-400">Log in as a customer to place orders.</p>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={checkout}
                      disabled={placeOrder.isPending || (fulfillment === "delivery" && !address.trim())}
                    >
                      {placeOrder.isPending ? "Placing…" : `Place order · ${money(orderTotal)} (COD)`}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {/* Reviews */}
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
                  Reviews
                </h2>
                {reviews.isLoading ? (
                  <div className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
                ) : reviewRows.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    No reviews yet — be the first!
                  </p>
                ) : (
                  <div className="space-y-4">
                    {reviewRows.map((r) => (
                      <div
                        key={r.id}
                        className={
                          r.id === mine?.id
                            ? "rounded-2xl border border-brand-300 bg-brand-50/40 p-4 dark:border-brand-500/40 dark:bg-brand-500/[0.06]"
                            : "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"
                        }
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white/90">
                            {r.customer_name}
                            {/* Names repeat. Without this a customer scanning
                                the list has no way to tell which row is theirs,
                                which is the whole reason Remove had nothing to
                                point at. */}
                            {r.id === mine?.id && (
                              <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-theme-xs font-medium text-brand-600 dark:text-brand-400">
                                Yours
                              </span>
                            )}
                          </span>
                          <Stars value={r.rating} />
                        </div>
                        {r.comment && (
                          <p className="text-sm text-gray-600 dark:text-gray-300">{r.comment}</p>
                        )}
                        {r.reply && (
                          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                            <span className="font-medium text-brand-600 dark:text-brand-400">
                              Shop reply:
                            </span>{" "}
                            <span className="text-gray-600 dark:text-gray-300">{r.reply}</span>
                          </div>
                        )}
                        <p className="mt-2 text-theme-xs text-gray-400">
                          {new Date(r.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Write a review (customers) */}
              <div className="h-fit rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                <h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">
                  {!isCustomer ? "Want to review?" : mine ? "Your review" : "Rate this shop"}
                </h3>
                {!isCustomer ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    <Link to="/signin" className="text-brand-500">Sign in</Link> as a customer to
                    leave a review. Posting again updates your existing review.
                  </p>
                ) : (
                  <>
                    {reviewError && (
                      <div className="mb-3">
                        <Alert variant="error" title="Couldn't post" message={reviewError} />
                      </div>
                    )}
                    <div className="mb-3 text-2xl">
                      <Stars value={myRating} onChange={setMyRating} />
                    </div>
                    <TextArea
                      value={myComment}
                      onChange={setMyComment}
                      rows={3}
                      placeholder="Share your experience (optional)"
                    />
                    <Button
                      size="sm"
                      className="mt-3 w-full"
                      onClick={sendReview}
                      disabled={submitReview.isPending || !myRating}
                    >
                      {submitReview.isPending
                        ? mine
                          ? "Saving…"
                          : "Posting…"
                        : mine
                          ? "Update review"
                          : "Post review"}
                    </Button>
                    {mine ? (
                      <>
                        {/* The endpoint for this existed from the start and no
                            screen ever called it, so the only way out of a
                            review posted by mistake was to overwrite it with
                            something milder. */}
                        <Button
                          size="sm"
                          variant="danger"
                          className="mt-2 w-full"
                          onClick={removeReview}
                          disabled={deleteReview.isPending}
                        >
                          {deleteReview.isPending ? "Removing…" : "Remove review"}
                        </Button>
                        {mine.reply && (
                          <p className="mt-2 text-theme-xs text-gray-400">
                            The shop has replied to this. Changing it clears their reply.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-theme-xs text-gray-400">
                        One review per shop — posting again updates it.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modifier configurator */}
      {cfg && (
        <div className="fixed inset-0 z-[99999] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setCfg(null)}>
          <div
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-gray-900 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{cfg.name}</h3>
                <p className="text-theme-xs text-gray-400">Customize your order</p>
              </div>
              <button onClick={() => setCfg(null)} className={MODAL_CLOSE}>✕</button>
            </div>

            {cfg.variants.length > 0 && (
              <div className="mb-4">
                <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Size</p>
                <div className="flex flex-wrap gap-2">
                  {cfg.variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setCfgVariant(v.id)}
                      className={`rounded-lg border px-3 py-1.5 text-theme-sm ${cfgVariant === v.id ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-300 dark:border-gray-700"}`}
                    >
                      {v.name} · {money(v.price)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {cfg.modifier_groups.map((g) => {
              const sel = cfgSel[g.id] ?? [];
              const rule = g.min_select > 0 ? `Choose ${g.min_select === g.max_select ? g.min_select : `${g.min_select}+`}` : g.max_select > 0 ? `Up to ${g.max_select}` : "Optional";
              return (
                <div key={g.id} className="mb-4">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{g.name}</p>
                    <span className="text-theme-xs text-gray-400">{rule}{g.min_select > 0 ? " · required" : ""}</span>
                  </div>
                  <div className="space-y-1">
                    {g.options.map((o) => {
                      const on = sel.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          onClick={() => toggleOpt(g, o.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-theme-sm ${on ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-200 dark:border-gray-700"}`}
                        >
                          <span>{g.max_select === 1 ? (on ? "◉" : "◯") : (on ? "☑" : "☐")} {o.name}</span>
                          {Number(o.price_delta) > 0 && <span className="text-gray-500">+ {money(o.price_delta)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <button
              onClick={addConfigured}
              disabled={!cfgValid}
              className="mt-2 w-full rounded-lg bg-brand-500 py-2.5 font-medium text-white hover:bg-brand-600 disabled:opacity-40"
            >
              Add to cart · {money(cfgPrice)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
