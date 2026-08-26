import { Link } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import { useConfirm } from "../../../components/ui/confirm";
import { cartKeyOf, useCartStore } from "../../../stores/cartStore";
import { money } from "../components/format";
import { CartIcon, StoreIcon, TrashIcon, TruckIcon } from "../components/MarketIcons";
import { ProductThumb } from "../components/ProductThumb";
import { QuantityStepper } from "../components/QuantityStepper";

/**
 * THE BASKET, IN FULL.
 *
 * Grouped by shop and SAID OUT LOUD, because the grouping is not cosmetic: an
 * order is placed against one shop, so three shops means three orders, three
 * delivery fees and three separate deliveries. Every screen before this one
 * that hides the split is setting up a surprise at the end.
 *
 * Line prices here are the ones the card quoted. They are a preview, not the
 * bill: the server prices the order from its own catalog when it is placed,
 * which is what makes it impossible for a browser to name its own price.
 */
export default function CartPage() {
  const cart = useCartStore();
  const confirm = useConfirm();
  const groups = cart.groups();

  const clearShop = async (slug: string, name: string) => {
    const yes = await confirm({
      title: `Empty your ${name} basket?`,
      message: "The items from this shop will be removed. Anything from other shops stays.",
      confirmLabel: "Remove them",
      tone: "danger",
    });
    if (yes) cart.clearShop(slug);
  };

  if (groups.length === 0) {
    return (
      <>
        <PageMeta title="Your basket — CartZe" description="What you have picked out." />
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/5">
            <CartIcon className="size-7" />
          </span>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Your basket is empty</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            One basket holds things from as many shops as you like — each shop delivers its own part.
          </p>
          <Link
            to="/browse"
            className="mt-6 inline-block rounded-2xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            Start browsing
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Your basket — CartZe" description="What you have picked out." />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Your basket</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          {cart.count()} {cart.count() === 1 ? "item" : "items"} from {groups.length}{" "}
          {groups.length === 1 ? "shop" : "shops"}
        </p>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            {groups.map((group) => (
              <section
                key={group.shop_slug}
                className="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900"
              >
                <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5 dark:border-white/5">
                  <Link
                    to={`/shop/${group.shop_slug}`}
                    className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                      <StoreIcon className="size-4" />
                    </span>
                    <span className="truncate">{group.shop_name}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => clearShop(group.shop_slug, group.shop_name)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-error-50 hover:text-error-600 dark:text-gray-400 dark:hover:bg-error-500/10"
                  >
                    <TrashIcon className="size-3.5" />
                    Remove all
                  </button>
                </header>

                <ul className="divide-y divide-gray-100 dark:divide-white/5">
                  {group.lines.map((line) => (
                    <li key={cartKeyOf(line)} className="flex gap-4 p-5">
                      <Link
                        to={`/p/${line.product_id}`}
                        className="group/card size-20 shrink-0 overflow-hidden rounded-2xl bg-gray-50 sm:size-24 dark:bg-white/5"
                      >
                        <ProductThumb name={line.name} image={line.image} />
                      </Link>

                      <div className="flex min-w-0 flex-1 flex-col">
                        <Link
                          to={`/p/${line.product_id}`}
                          className="truncate text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
                          title={line.name}
                        >
                          {line.name}
                        </Link>
                        {(line.variant_name || line.modifiers_label) && (
                          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                            {[line.variant_name, line.modifiers_label].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                          {money(line.unit_price)} each
                        </p>

                        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3">
                          <QuantityStepper
                            size="sm"
                            label={line.name}
                            value={line.quantity}
                            onChange={(next) => cart.setQty(cartKeyOf(line), next)}
                          />
                          <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white">
                            {money(line.unit_price * line.quantity)}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                <footer className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <TruckIcon className="size-3.5" />
                    Delivered by {group.shop_name}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {money(group.subtotal)}
                  </span>
                </footer>
              </section>
            ))}
          </div>

          {/* ── What it comes to ─────────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-bold text-gray-900 dark:text-white">Summary</h2>

              <dl className="space-y-2.5 text-sm">
                {groups.map((group) => (
                  <div key={group.shop_slug} className="flex items-center justify-between gap-3">
                    <dt className="min-w-0 truncate text-gray-600 dark:text-gray-300">{group.shop_name}</dt>
                    <dd className="shrink-0 tabular-nums text-gray-900 dark:text-white">{money(group.subtotal)}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-white/5">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Items total</span>
                <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">
                  {money(cart.subtotal())}
                </span>
              </div>

              {/* Said here rather than discovered at the end. */}
              <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Delivery, discounts and any coupon are worked out by each shop at checkout — this is the
                items only.
              </p>

              <Link
                to="/checkout"
                className="mt-5 flex h-12 items-center justify-center rounded-2xl bg-brand-500 text-sm font-semibold text-white transition hover:bg-brand-600"
              >
                Checkout {groups.length > 1 ? `· ${groups.length} orders` : ""}
              </Link>
              <Link
                to="/browse"
                className="mt-2 flex h-11 items-center justify-center rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                Keep shopping
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
