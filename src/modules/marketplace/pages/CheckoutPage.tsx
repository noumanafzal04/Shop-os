import { useState } from "react";
import { Link, useNavigate } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import Input from "../../../components/form/input/InputField";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useCartStore } from "../../../stores/cartStore";
import { usePlaceOrder } from "../../orders/hooks/useOrders";
import { DeliveryAddressField } from "../components/DeliveryAddressField";
import { money } from "../components/format";
import { BagIcon, CheckIcon, StoreIcon, TruckIcon } from "../components/MarketIcons";

type Fulfillment = "delivery" | "pickup";

interface ShopChoices {
  fulfillment: Fulfillment;
  address: string;
  coupon: string;
  notes: string;
}

/**
 * CHECKOUT, ACROSS SHOPS.
 *
 * An order belongs to one shop — its stock, its delivery fee, its rider, its
 * minimum. A basket that spans three shops is therefore three orders, and the
 * honest thing is to show that as three cards, each with its own delivery
 * choice and its own coupon box, rather than pretending there is one.
 *
 * ── The part that has to be got right ─────────────────────────────────
 *
 * Placing several orders can half-succeed. If the second shop refuses — an
 * item ran out while the basket sat there, a minimum not met, a coupon that
 * expired — the FIRST shop's order has already been placed and cannot be
 * un-placed by this page.
 *
 * So: they go one at a time, each with its own idempotency key; whatever
 * succeeded is taken out of the basket immediately; and what remains is
 * exactly what still needs paying for, with the shop's own refusal printed on
 * it. The failure mode this avoids is the one that loses trust outright — a
 * red error, a basket that still looks full, a customer who orders again, and
 * two deliveries.
 *
 * NO PRICES ARE SENT. The payload carries product ids and quantities; the
 * server prices it. That is not a detail of this page, it is the rule the
 * whole system is built on.
 */
export default function CheckoutPage() {
  const cart = useCartStore();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const placeOrder = usePlaceOrder();
  const toast = useToast();
  const navigate = useNavigate();

  const groups = cart.groups();

  const [choices, setChoices] = useState<Record<string, ShopChoices>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);

  const choicesFor = (slug: string): ShopChoices =>
    choices[slug] ?? { fulfillment: "delivery", address: "", coupon: "", notes: "" };

  const setFor = (slug: string, patch: Partial<ShopChoices>) =>
    setChoices((was) => ({ ...was, [slug]: { ...choicesFor(slug), ...patch } }));

  const needsAddress = groups.some(
    (g) => choicesFor(g.shop_slug).fulfillment === "delivery" && choicesFor(g.shop_slug).address.trim() === "",
  );

  const place = async () => {
    setPlacing(true);
    setFailed({});

    const problems: Record<string, string> = {};
    let placed = 0;

    for (const group of groups) {
      const mine = choicesFor(group.shop_slug);

      try {
        await placeOrder.mutateAsync({
          shop_slug: group.shop_slug,
          fulfillment_type: mine.fulfillment,
          delivery_address: mine.fulfillment === "delivery" ? mine.address.trim() : undefined,
          coupon_code: mine.coupon.trim() || undefined,
          notes: mine.notes.trim() || undefined,
          items: group.lines.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            modifier_option_ids: l.modifier_option_ids,
          })),
        });

        // Out of the basket the moment it is real. Leaving it there is how a
        // customer ends up placing the same order twice.
        cart.clearShop(group.shop_slug);
        placed++;
      } catch (error) {
        problems[group.shop_slug] =
          error instanceof ApiError ? error.message : "That shop could not take this order just now.";
      }
    }

    setPlacing(false);
    setFailed(problems);

    if (placed > 0 && Object.keys(problems).length === 0) {
      toast.success(placed === 1 ? "Order placed" : `${placed} orders placed`);
      navigate("/my-orders");

      return;
    }

    if (placed > 0) {
      toast.info(`${placed} of ${groups.length} orders went through — the rest are still in your basket.`);

      return;
    }

    toast.error("None of the orders went through. Nothing has been charged.");
  };

  if (!isAuthenticated || user?.role !== "customer") {
    return (
      <>
        <PageMeta title="Checkout — CartZe" description="Place your order." />
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/15">
            <BagIcon className="size-7" />
          </span>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Sign in to order</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            Your basket is safe — it is kept in this browser and will still be here.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/signin" className="rounded-2xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
              Sign in
            </Link>
            <Link to="/signup" className="rounded-2xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200">
              Create an account
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Nothing to check out</h1>
        <Link to="/browse" className="mt-5 inline-block rounded-2xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
          Start browsing
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageMeta title="Checkout — CartZe" description="Place your order." />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Checkout</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          {groups.length === 1
            ? "One shop, one order."
            : `${groups.length} shops — one order each, delivered separately.`}
        </p>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            {groups.map((group) => {
              const mine = choicesFor(group.shop_slug);
              const problem = failed[group.shop_slug];

              return (
                <section
                  key={group.shop_slug}
                  className={`overflow-hidden rounded-3xl border bg-white dark:bg-gray-900 ${
                    problem ? "border-error-300 dark:border-error-500/40" : "border-gray-200 dark:border-white/10"
                  }`}
                >
                  <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5 dark:border-white/5">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                        <StoreIcon className="size-4" />
                      </span>
                      <span className="truncate">{group.shop_name}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                      {money(group.subtotal)}
                    </span>
                  </header>

                  {problem && (
                    <p className="border-b border-error-100 bg-error-50 px-5 py-3 text-sm text-error-700 dark:border-error-500/20 dark:bg-error-500/10 dark:text-error-400">
                      {problem}
                    </p>
                  )}

                  <div className="space-y-4 px-5 py-4">
                    <ul className="space-y-1.5 text-sm">
                      {group.lines.map((line, i) => (
                        <li key={i} className="flex items-start justify-between gap-3">
                          <span className="min-w-0 text-gray-600 dark:text-gray-300">
                            <span className="tabular-nums">{line.quantity}×</span>{" "}
                            <span className="font-medium text-gray-900 dark:text-white">{line.name}</span>
                            {(line.variant_name || line.modifiers_label) && (
                              <span className="text-gray-500 dark:text-gray-400">
                                {" "}
                                ({[line.variant_name, line.modifiers_label].filter(Boolean).join(", ")})
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-300">
                            {money(line.unit_price * line.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {(["delivery", "pickup"] as const).map((how) => (
                        <button
                          key={how}
                          type="button"
                          onClick={() => setFor(group.shop_slug, { fulfillment: how })}
                          aria-pressed={mine.fulfillment === how}
                          className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                            mine.fulfillment === how
                              ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                              : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-white/10 dark:text-gray-200"
                          }`}
                        >
                          {how === "delivery" ? <TruckIcon className="size-4" /> : <StoreIcon className="size-4" />}
                          {how === "delivery" ? "Deliver to me" : "I'll collect it"}
                        </button>
                      ))}
                    </div>

                    {mine.fulfillment === "delivery" && (
                      <DeliveryAddressField
                        value={mine.address}
                        onChange={(address) => setFor(group.shop_slug, { address })}
                        enabled
                      />
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                          Coupon code
                        </label>
                        <Input
                          placeholder="Optional"
                          value={mine.coupon}
                          onChange={(e) => setFor(group.shop_slug, { coupon: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                          Note for the shop
                        </label>
                        <Input
                          placeholder="Optional"
                          value={mine.notes}
                          onChange={(e) => setFor(group.shop_slug, { notes: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-bold text-gray-900 dark:text-white">
                {groups.length === 1 ? "Your order" : `Your ${groups.length} orders`}
              </h2>

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

              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
                Each shop adds its own delivery charge and applies any coupon. You pay on delivery.
              </p>

              <button
                type="button"
                onClick={place}
                disabled={placing || needsAddress}
                className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-brand-500 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/10 dark:disabled:text-gray-500"
              >
                {placing
                  ? "Placing…"
                  : needsAddress
                    ? "Add a delivery address"
                    : `Place ${groups.length === 1 ? "order" : `${groups.length} orders`}`}
              </button>

              <Link
                to="/cart"
                className="mt-2 flex h-11 items-center justify-center rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                Back to basket
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
