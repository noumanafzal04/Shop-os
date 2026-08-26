import { Link } from "react-router";

import { cartKeyOf, useCartStore } from "../../../stores/cartStore";
import { money } from "./format";
import { CartIcon, CloseIcon, StoreIcon } from "./MarketIcons";
import { ProductThumb } from "./ProductThumb";
import { QuantityStepper } from "./QuantityStepper";

/**
 * THE BASKET, WITHOUT LEAVING THE PAGE.
 *
 * A shopper adding a fourth thing wants to know what the first three came to,
 * and sending them to a cart page to find out costs them their place in the
 * grid. So the sheet slides over and closes again.
 *
 * It shows the SHOP SPLIT rather than one flat list, because that split is
 * real: three shops means three orders, three delivery fees and three
 * deliveries, and a customer who only discovers that on the checkout page has
 * been misled by every screen before it.
 */
export function CartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCartStore();
  const groups = cart.groups();
  const subtotal = cart.subtotal();
  const count = cart.count();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Your basket">
      <button
        type="button"
        aria-label="Close basket"
        onClick={onClose}
        className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm"
      />

      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-950">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
            <CartIcon className="size-5 text-brand-500" />
            Your basket
            {count > 0 && <span className="text-sm font-normal text-gray-500">({count})</span>}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close basket"
            className="rounded-xl p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>

        {groups.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/5">
              <CartIcon className="size-7" />
            </span>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Nothing in here yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Everything from every shop lives in one basket — start filling it.
            </p>
            <Link
              to="/browse"
              onClick={onClose}
              className="mt-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {groups.map((group) => (
                <section key={group.shop_slug}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Link
                      to={`/shop/${group.shop_slug}`}
                      onClick={onClose}
                      className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-gray-700 transition hover:text-brand-600 dark:text-gray-200"
                    >
                      <StoreIcon className="size-3.5 shrink-0 text-brand-500" />
                      <span className="truncate">{group.shop_name}</span>
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{money(group.subtotal)}</span>
                  </div>

                  <ul className="space-y-2">
                    {group.lines.map((line) => (
                      <li
                        key={cartKeyOf(line)}
                        className="flex gap-3 rounded-2xl border border-gray-200 p-2.5 dark:border-white/10"
                      >
                        <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-gray-50 dark:bg-white/5">
                          <ProductThumb name={line.name} image={line.image} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white" title={line.name}>
                            {line.name}
                          </p>
                          {(line.variant_name || line.modifiers_label) && (
                            <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                              {[line.variant_name, line.modifiers_label].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <QuantityStepper
                              size="sm"
                              label={line.name}
                              value={line.quantity}
                              onChange={(next) => cart.setQty(cartKeyOf(line), next)}
                            />
                            <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                              {money(line.unit_price * line.quantity)}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <footer className="border-t border-gray-200 px-5 py-4 dark:border-white/10">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-300">Subtotal</span>
                <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(subtotal)}</span>
              </div>
              <p className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
                {groups.length === 1
                  ? "Delivery is worked out at checkout."
                  : `${groups.length} shops — each delivers separately, with its own fee.`}
              </p>
              <Link
                to="/checkout"
                onClick={onClose}
                className="flex h-12 items-center justify-center rounded-2xl bg-brand-500 text-sm font-semibold text-white transition hover:bg-brand-600"
              >
                Checkout
              </Link>
              <Link
                to="/cart"
                onClick={onClose}
                className="mt-2 flex h-11 items-center justify-center rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                View full basket
              </Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
