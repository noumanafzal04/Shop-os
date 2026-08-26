import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import { useToast } from "../../../components/ui/toast";
import { useCartStore } from "../../../stores/cartStore";
import { useSavedStore } from "../../../stores/savedStore";
import { discountPercent, money, tradeLabel } from "../components/format";
import {
  CartIcon,
  CheckIcon,
  ChevronRightIcon,
  HeartIcon,
  StarIcon,
  StoreIcon,
  TruckIcon,
} from "../components/MarketIcons";
import { ProductThumb } from "../components/ProductThumb";
import { QuantityStepper } from "../components/QuantityStepper";
import { useMarketProduct } from "../hooks/useMarketplace";

/**
 * ONE PRODUCT, ON A PAGE OF ITS OWN.
 *
 * There was no such page and no endpoint behind one: the only way to look at an
 * item was to open its shop and find it in the list, which cannot be linked,
 * shared, or arrived at from a search result.
 *
 * It is also the only surface that can ask for OPTIONS. A card can add
 * something it can fully specify; "mild or hot, and up to three add-ons" is a
 * form, and this is where it lives.
 */
export default function ProductPage() {
  const { id } = useParams();
  const query = useMarketProduct(id);
  const product = query.data;

  const cart = useCartStore();
  const saved = useSavedStore();
  const toast = useToast();

  const [frame, setFrame] = useState(0);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);

  const sizes = product?.variants ?? [];
  const groups = product?.modifier_groups ?? [];

  // The first size that can be bought, decided once the payload lands rather
  // than in state that would go stale when a different product is opened.
  const size = useMemo(() => {
    if (sizes.length === 0) return null;
    return sizes.find((v) => v.id === sizeId) ?? sizes.find((v) => v.in_stock) ?? sizes[0];
  }, [sizes, sizeId]);

  const optionIds = useMemo(() => Object.values(chosen).flat(), [chosen]);

  const optionsTotal = useMemo(() => {
    let sum = 0;
    for (const group of groups) {
      for (const option of group.options) {
        if (optionIds.includes(option.id)) sum += Number(option.price_delta ?? 0);
      }
    }
    return sum;
  }, [groups, optionIds]);

  const base = Number(size?.price ?? product?.price ?? 0);
  const unit = base + optionsTotal;
  const was = size ? null : (product?.original_price ?? null);
  const off = discountPercent(base, was);

  /**
   * Which required questions have not been answered.
   *
   * Named rather than counted, because "choose 1 more" tells somebody nothing
   * about WHICH group is waiting when three of them are on the page.
   */
  const missing = groups
    .filter((g) => g.min_select > 0 && (chosen[g.id]?.length ?? 0) < g.min_select)
    .map((g) => g.name);

  const soldOut = product?.sold_out === true;
  const offMenu = product?.available_now === false;
  const outOfStock = sizes.length > 0 ? !sizes.some((v) => v.in_stock) : product?.in_stock === false;
  const buyable =
    !!product && !soldOut && !offMenu && !outOfStock && (sizes.length === 0 || (size?.in_stock ?? false));

  const pick = (groupId: string, optionId: string, max: number) =>
    setChosen((was) => {
      const current = was[groupId] ?? [];
      if (current.includes(optionId)) return { ...was, [groupId]: current.filter((id) => id !== optionId) };
      // A single-choice group REPLACES; a multi-choice one fills up and then
      // refuses, rather than silently dropping the customer's first pick.
      if (max <= 1) return { ...was, [groupId]: [optionId] };
      if (current.length >= max) return was;
      return { ...was, [groupId]: [...current, optionId] };
    });

  const add = () => {
    if (!product?.shop) return;

    const label = groups
      .flatMap((g) => g.options.filter((o) => optionIds.includes(o.id)).map((o) => o.name))
      .join(", ");

    cart.add(
      {
        shop_slug: product.shop.slug,
        shop_name: product.shop.business_name,
        product_id: product.id,
        variant_id: size?.id ?? null,
        variant_name: size?.name ?? null,
        name: product.name,
        image: product.images?.[0] ?? null,
        unit_price: unit,
        in_stock: true,
        modifier_option_ids: optionIds.length > 0 ? optionIds : undefined,
        modifiers_label: label || undefined,
      },
      qty,
    );

    toast.success(`${qty} × ${product.name} added to your basket`);
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-3xl bg-gray-100 dark:bg-white/5" />
          <div className="space-y-4">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
            <div className="h-8 w-3/4 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
            <div className="h-10 w-40 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
            <div className="h-24 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">This item isn’t available</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The shop may have taken it down, or closed its online store.
        </p>
        <Link to="/browse" className="mt-5 inline-block rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
          Keep browsing
        </Link>
      </div>
    );
  }

  const images = product.images?.length ? product.images : [null];

  return (
    <>
      <PageMeta title={`${product.name} — CartZe`} description={product.description ?? product.name} />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
        {/* Where you are, and the way back out. */}
        <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Link to="/shops" className="hover:text-brand-600">Market</Link>
          <ChevronRightIcon className="size-3.5" />
          <Link to={`/shop/${product.shop.slug}`} className="hover:text-brand-600">{product.shop.business_name}</Link>
          {product.category && (
            <>
              <ChevronRightIcon className="size-3.5" />
              <Link to={`/browse?category=${encodeURIComponent(product.category.name)}`} className="hover:text-brand-600">
                {product.category.name}
              </Link>
            </>
          )}
        </nav>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
          {/* ── The pictures ──────────────────────────────────── */}
          <div>
            <div className="relative aspect-square overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900">
              <div className="group/card h-full w-full">
                <ProductThumb name={product.name} image={images[frame]} trade={product.shop.business_type} />
              </div>

              {off !== null && (
                <span className="absolute left-4 top-4 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-bold text-white">
                  −{off}%
                </span>
              )}

              <button
                type="button"
                onClick={() => saved.toggle(product.id)}
                aria-pressed={saved.ids.includes(product.id)}
                aria-label={saved.ids.includes(product.id) ? "Remove from saved" : "Save this item"}
                className={`absolute right-4 top-4 grid size-11 place-items-center rounded-full backdrop-blur transition ${
                  saved.ids.includes(product.id)
                    ? "bg-white text-rose-500 shadow dark:bg-gray-900"
                    : "bg-white/85 text-gray-500 hover:text-rose-500 dark:bg-gray-900/70 dark:text-gray-300"
                }`}
              >
                <HeartIcon className="size-5" filled={saved.ids.includes(product.id)} />
              </button>
            </div>

            {images.length > 1 && (
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {images.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setFrame(i)}
                    aria-label={`Picture ${i + 1}`}
                    aria-current={frame === i}
                    className={`size-20 shrink-0 overflow-hidden rounded-2xl border-2 transition ${
                      frame === i ? "border-brand-500" : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <ProductThumb name={product.name} image={src} trade={product.shop.business_type} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── The decision ──────────────────────────────────── */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Link
              to={`/shop/${product.shop.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 py-1.5 pl-2 pr-3.5 text-xs font-medium text-gray-600 transition hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-300"
            >
              <span className="grid size-6 place-items-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                <StoreIcon className="size-3.5" />
              </span>
              {product.shop.business_name}
              {product.shop.rating !== null && (
                <span className="flex items-center gap-0.5 text-amber-500">
                  <StarIcon className="size-3" />
                  <span className="tabular-nums">{product.shop.rating}</span>
                </span>
              )}
            </Link>

            <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
              {product.name}
            </h1>

            {(product.brand || product.strength) && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {[product.brand, product.strength, product.dosage_form].filter(Boolean).join(" · ")}
              </p>
            )}

            <div className="mt-4 flex items-end gap-3">
              <span className="text-3xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
                {money(unit)}
              </span>
              {was !== null && (
                <span className="pb-1 text-lg tabular-nums text-gray-400 line-through">{money(was)}</span>
              )}
              {product.unit && <span className="pb-1.5 text-sm text-gray-500">per {product.unit}</span>}
            </div>

            {!buyable && (
              <p className="mt-3 rounded-2xl bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 dark:bg-white/5 dark:text-gray-200">
                {soldOut
                  ? "The shop has marked this sold out for today. It usually comes back with the next delivery."
                  : offMenu
                    ? `Served ${String(product.available_from).slice(0, 5)}–${String(product.available_until).slice(0, 5)}. You can’t order it right now.`
                    : "Out of stock at the moment."}
              </p>
            )}

            {product.requires_prescription && (
              <p className="mt-3 flex items-start gap-2 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
                <span aria-hidden="true">℞</span>
                <span>The pharmacy will ask for a prescription before handing this over.</span>
              </p>
            )}

            {/* Sizes */}
            {sizes.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  Size
                </h2>
                <div className="flex flex-wrap gap-2">
                  {sizes.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSizeId(v.id)}
                      disabled={!v.in_stock}
                      aria-pressed={size?.id === v.id}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                        size?.id === v.id
                          ? "border-brand-500 bg-brand-500 text-white"
                          : v.in_stock
                            ? "border-gray-200 text-gray-700 hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-200"
                            : "cursor-not-allowed border-dashed border-gray-200 text-gray-400 line-through dark:border-white/10 dark:text-gray-600"
                      }`}
                    >
                      {v.name}
                      <span className="ml-2 text-xs opacity-70">{money(v.price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Options */}
            {groups.map((group) => (
              <div key={group.id} className="mt-6">
                <h2 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  {group.name}
                  <span className="font-medium normal-case tracking-normal text-gray-400">
                    {group.min_select > 0
                      ? `Choose ${group.max_select > 1 ? `${group.min_select}–${group.max_select}` : "one"}`
                      : `Optional${group.max_select > 1 ? `, up to ${group.max_select}` : ""}`}
                  </span>
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.options.map((option) => {
                    const on = (chosen[group.id] ?? []).includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => pick(group.id, option.id, group.max_select)}
                        aria-pressed={on}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                          on
                            ? "border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                            : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-white/10 dark:text-gray-200"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 dark:border-white/20"}`}>
                            {on && <CheckIcon className="size-3" />}
                          </span>
                          <span className="truncate">{option.name}</span>
                        </span>
                        {Number(option.price_delta) > 0 && (
                          <span className="shrink-0 text-xs tabular-nums text-gray-500">
                            +{money(option.price_delta)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Add */}
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <QuantityStepper label={product.name} value={qty} onChange={(next) => setQty(Math.max(1, next))} />

              <button
                type="button"
                onClick={add}
                disabled={!buyable || missing.length > 0}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-500 px-6 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/10 dark:disabled:text-gray-500"
              >
                <CartIcon className="size-5" />
                {missing.length > 0 ? `Choose ${missing[0]}` : `Add ${qty > 1 ? `${qty} ` : ""}to basket · ${money(unit * qty)}`}
              </button>
            </div>

            {cart.qtyOf({ product_id: product.id, variant_id: size?.id ?? null, modifier_option_ids: optionIds }) > 0 && (
              <Link
                to="/cart"
                className="mt-3 flex h-11 items-center justify-center gap-2 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                <CheckIcon className="size-4 text-brand-500" />
                Already in your basket — view it
              </Link>
            )}

            {/* What the shop will do with it */}
            <dl className="mt-6 space-y-2 rounded-2xl bg-gray-50 p-4 text-sm dark:bg-white/5">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <TruckIcon className="size-4 shrink-0 text-brand-500" />
                <dt className="sr-only">Delivery</dt>
                <dd>
                  {product.shop.delivery_fee !== undefined && product.shop.delivery_fee > 0
                    ? `Delivery from ${money(product.shop.delivery_fee)}`
                    : "Delivery or pickup — chosen at checkout"}
                </dd>
              </div>
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <StoreIcon className="size-4 shrink-0 text-brand-500" />
                <dt className="sr-only">Shop</dt>
                <dd>
                  {tradeLabel(product.shop.business_type)}
                  {product.shop.city && ` · ${product.shop.city.name}`}
                </dd>
              </div>
            </dl>

            {product.description && (
              <div className="mt-6">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  About this item
                </h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  {product.description}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Somewhere to go next ──────────────────────────────── */}
        {product.also_from_this_shop.length > 0 && (
          <section className="mt-14">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                More from {product.shop.business_name}
              </h2>
              <Link
                to={`/browse?shop_slug=${product.shop.slug}`}
                className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300"
              >
                View all
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {product.also_from_this_shop.map((item) => (
                <Link
                  key={item.id}
                  to={`/p/${item.id}`}
                  className="group/card overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg dark:border-white/10 dark:bg-gray-900"
                >
                  <div className="aspect-square overflow-hidden bg-gray-50 dark:bg-white/5">
                    <ProductThumb name={item.name} image={item.images?.[0]} trade={product.shop.business_type} />
                  </div>
                  <div className="p-3">
                    <p className="truncate text-xs font-medium text-gray-900 dark:text-white" title={item.name}>
                      {item.name}
                    </p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                      {money(item.price)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
