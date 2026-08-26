import { useMemo, useState } from "react";
import { Link } from "react-router";

import { useCartStore, cartKeyOf } from "../../../stores/cartStore";
import { useSavedStore } from "../../../stores/savedStore";
import type { AisleProduct } from "../services/marketplaceService";
import { discountPercent, money } from "./format";
import { CartIcon, HeartIcon, StarIcon, StoreIcon } from "./MarketIcons";
import { ProductThumb } from "./ProductThumb";
import { QuantityStepper } from "./QuantityStepper";

/**
 * THE CARD THE WHOLE MARKETPLACE IS MADE OF.
 *
 * Four things have to happen from here without leaving the grid — see it, save
 * it, choose a size, and put it in the basket — because a shopper comparing
 * twelve things will not open twelve pages to do it.
 *
 * ── What a card is allowed to add ─────────────────────────────────────
 *
 * A card may add an item it can FULLY SPECIFY. Sizes are shown on it, so a
 * sized item is fully specifiable here. Modifier groups are not: "choose your
 * spice level, pick up to three add-ons" is a form, and a card that pretends to
 * add a burger without asking would send a kitchen ticket the customer never
 * agreed to. Those items say "Choose options" and go to their page — which is
 * the honest version of the same button, not a lesser one.
 *
 * ── Why the size lives on the card ────────────────────────────────────
 *
 * Because "out of stock" is almost never true of a product. It is true of the
 * Large. A grid that hides sizes has to decide whether a shirt with no XL left
 * is in stock or not, and both answers are wrong.
 */
export function ProductCard({ product }: { product: AisleProduct }) {
  const cart = useCartStore();
  const saved = useSavedStore();

  const sizes = product.variants ?? [];
  const hasSizes = sizes.length > 0;
  const needsOptions = (product.modifier_groups ?? []).length > 0;

  // Pre-select the first size that can actually be bought, so a customer who
  // just wants "one of those" is one press away. Falling back to the first
  // means a fully sold-out product still SHOWS its sizes rather than nothing.
  const [sizeId, setSizeId] = useState<string | null>(
    () => (sizes.find((v) => v.in_stock) ?? sizes[0])?.id ?? null,
  );

  const size = useMemo(() => sizes.find((v) => v.id === sizeId) ?? null, [sizes, sizeId]);

  const price = Number(size?.price ?? product.price);
  const was = size ? null : product.original_price;
  const off = discountPercent(price, was);

  // Three separate ways a thing can be un-buyable, and they read differently to
  // a customer: nothing left, turned off by the counter tonight, or outside its
  // serving window. Only the first is "sold out".
  const soldOut = product.sold_out === true;
  const outOfStock = hasSizes ? !sizes.some((v) => v.in_stock) : !product.in_stock;
  const offMenu = product.available_now === false;
  const buyable = !soldOut && !outOfStock && !offMenu && (!hasSizes || (size?.in_stock ?? false));

  const shopSlug = product.shop?.slug ?? "";
  const productHref = `/p/${product.id}`;

  const line = {
    shop_slug: shopSlug,
    shop_name: product.shop?.business_name ?? "",
    product_id: product.id,
    variant_id: size?.id ?? null,
    variant_name: size?.name ?? null,
    name: product.name,
    image: product.images?.[0] ?? null,
    unit_price: price,
    in_stock: buyable,
  };

  const inBasket = cart.qtyOf({
    product_id: product.id,
    variant_id: size?.id ?? null,
  });

  const unavailableLabel = soldOut
    ? "Sold out"
    : offMenu
      ? "Not right now"
      : outOfStock
        ? "Out of stock"
        : null;

  return (
    <article className="group/card relative flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl hover:shadow-brand-500/5 dark:border-white/10 dark:bg-gray-900 dark:hover:border-brand-500/40">
      {/* ── The picture ─────────────────────────────────────────── */}
      <div className="relative aspect-square overflow-hidden bg-gray-50 dark:bg-white/5">
        <Link to={productHref} className="block h-full w-full" aria-label={product.name}>
          <ProductThumb
            name={product.name}
            image={product.images?.[0]}
            trade={product.shop?.business_type}
            className={unavailableLabel ? "opacity-45 saturate-50" : ""}
          />
        </Link>

        {/* Badges, top-left, at most two — a card wearing four says nothing. */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {off !== null && (
            <span className="rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
              −{off}%
            </span>
          )}
          {unavailableLabel !== null && (
            <span className="rounded-full bg-gray-900/85 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
              {unavailableLabel}
            </span>
          )}
          {product.requires_prescription && (
            <span className="rounded-full bg-warning-500 px-2.5 py-1 text-[11px] font-semibold text-white">
              Rx
            </span>
          )}
        </div>

        {/* Save. Always reachable on touch, where there is no hover to reveal
            it — a control that only appears on hover simply does not exist on
            a phone, and this grid is mostly read on one. */}
        <button
          type="button"
          onClick={() => saved.toggle(product.id)}
          aria-pressed={saved.ids.includes(product.id)}
          aria-label={saved.ids.includes(product.id) ? `Remove ${product.name} from saved` : `Save ${product.name}`}
          className={`absolute right-3 top-3 grid size-9 place-items-center rounded-full backdrop-blur transition ${
            saved.ids.includes(product.id)
              ? "bg-white text-rose-500 shadow-sm dark:bg-gray-900"
              : "bg-white/80 text-gray-500 hover:text-rose-500 dark:bg-gray-900/70 dark:text-gray-300"
          }`}
        >
          <HeartIcon className="size-[18px]" filled={saved.ids.includes(product.id)} />
        </button>

        {/* The hover view: a quiet strip rather than a full-cover overlay, so
            the photograph the shop uploaded is still the thing being looked at. */}
        <Link
          to={productHref}
          className="pointer-events-none absolute inset-x-3 bottom-3 translate-y-2 rounded-xl bg-gray-900/85 px-3 py-2 text-center text-xs font-semibold text-white opacity-0 backdrop-blur transition duration-300 group-hover/card:pointer-events-auto group-hover/card:translate-y-0 group-hover/card:opacity-100"
        >
          View details
        </Link>
      </div>

      {/* ── The words ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {product.shop && (
          <Link
            to={`/shop/${shopSlug}`}
            className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 transition hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-300"
          >
            <StoreIcon className="size-3.5 shrink-0" />
            <span className="truncate">{product.shop.business_name}</span>
            {product.shop.rating !== null && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 text-amber-500">
                <StarIcon className="size-3" />
                <span className="tabular-nums">{product.shop.rating}</span>
              </span>
            )}
          </Link>
        )}

        <Link to={productHref} className="min-w-0">
          <h3
            className="text-sm font-semibold leading-snug text-gray-900 transition group-hover/card:text-brand-600 dark:text-white dark:group-hover/card:text-brand-300"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            title={product.name}
          >
            {product.name}
          </h3>
        </Link>

        {/* Sizes. Four at most on a card — the rest are one tap away on the
            page, and a card that wraps to three rows of chips stops being a
            grid. */}
        {hasSizes && (
          <div className="flex flex-wrap gap-1">
            {sizes.slice(0, 4).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSizeId(v.id)}
                aria-pressed={sizeId === v.id}
                title={v.in_stock ? v.name : `${v.name} — out of stock`}
                className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium transition ${
                  sizeId === v.id
                    ? "border-brand-500 bg-brand-500 text-white"
                    : v.in_stock
                      ? "border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-300"
                      : "border-dashed border-gray-200 text-gray-400 line-through dark:border-white/10 dark:text-gray-600"
                }`}
              >
                {v.name}
              </button>
            ))}
            {sizes.length > 4 && (
              <Link
                to={productHref}
                className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
              >
                +{sizes.length - 4}
              </Link>
            )}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="text-base font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
              {money(price)}
            </p>
            {was !== null && (
              <p className="text-xs tabular-nums text-gray-400 line-through dark:text-gray-500">
                {money(was)}
              </p>
            )}
          </div>

          {/* ── The button, in its three states ──────────────────── */}
          {needsOptions ? (
            <Link
              to={productHref}
              className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-200"
            >
              Choose options
            </Link>
          ) : inBasket > 0 ? (
            <QuantityStepper
              size="sm"
              label={product.name}
              value={inBasket}
              max={null}
              onChange={(next) => cart.setQty(cartKeyOf(line), next)}
            />
          ) : (
            <button
              type="button"
              disabled={!buyable}
              onClick={() => cart.add(line)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/10 dark:disabled:text-gray-500"
            >
              <CartIcon className="size-4" />
              Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** The card's own shape while it loads, so the grid does not jump. */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900">
      <div className="aspect-square animate-pulse bg-gray-100 dark:bg-white/5" />
      <div className="space-y-2 p-4">
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
        <div className="flex items-center justify-between pt-2">
          <div className="h-5 w-20 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
          <div className="h-8 w-16 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />
        </div>
      </div>
    </div>
  );
}
