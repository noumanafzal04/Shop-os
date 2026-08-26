import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { formatQuantity } from "../../../common/format/quantity";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import TextArea from "../../../components/form/input/TextArea";
import { SearchGlyph } from "../../../components/ui/filters";
import { useToast } from "../../../components/ui/toast";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { sellingPrice } from "../../catalog/pricing";
import { useMoney } from "../../shop/hooks/useShop";
import { useTakeOrder } from "../hooks/useOrders";
import type { Product } from "../../catalog/types";

const CHANNELS = [
  { value: "phone", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "At the counter" },
];

/** How many items the picker shows before it asks. */
const PAGE_SIZE = 24;

/**
 * TAKING AN ORDER THE SHOP RECEIVED ITSELF — a phone call, a WhatsApp message,
 * somebody at the counter asking for delivery.
 *
 * ── Why this is a page and not the modal it was ────────────────────────
 *
 * It was a two-column modal holding a channel picker, four fields, a product
 * search, the whole catalogue in a 160px scroller, the basket, a total and the
 * notes. Everything a shop does while somebody is on the phone, in a box
 * smaller than the screen it was drawn on. The scroller could show four items
 * of a fifteen-item page, and the basket appeared below it, so adding the
 * fifth thing meant scrolling a list inside a box inside a dialog.
 *
 * It is the same job as ringing a sale, so it is laid out the same way: what
 * you are selling on the left, who it is for and what it comes to on the
 * right. Same shape, same habits, one screen to learn instead of two.
 *
 * ── The catalogue is browsable, not a wall ─────────────────────────────
 *
 * A first page on load, so somebody who does not know what they are looking
 * for can see the shelf; search narrows it; "Show more" adds to what is there.
 * The old list showed whatever the endpoint's default page happened to be —
 * fifteen products, with nothing saying there were more — which is the same
 * defect the combo picker had.
 *
 * ── Stock is on the tile, not in the refusal ───────────────────────────
 *
 * The server refuses an order it cannot fill. That refusal now names the item
 * (see InventoryService) — but a shop should not be finding out on submit
 * which of nine lines was short. Every tile says what is on the shelf, an item
 * with none is drawn as unavailable and cannot be added, and a basket line
 * asking for more than exists says so on the line.
 *
 * Prices are shown and never editable. The server prices the order exactly as
 * it does a web checkout: a counter that could type its own prices is a
 * counter that can discount without anyone knowing.
 */
export default function TakeOrderPage() {
  const money = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const take = useTakeOrder();

  const [channel, setChannel] = useState("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);

  /**
   * The shelf, accumulated across pages.
   *
   * Held here rather than read off the last response, because "Show more" has
   * to ADD to what is on screen. Reset whenever the search changes — pages of
   * one query stacked under another query's first page is a list that means
   * nothing.
   */
  const [shelf, setShelf] = useState<Product[]>([]);
  const results = useProducts({ search: debounced || undefined, page, per_page: PAGE_SIZE });
  const pagination = results.data?.meta.pagination;

  useEffect(() => {
    setPage(1);
    setShelf([]);
  }, [debounced]);

  useEffect(() => {
    const batch = results.data?.data;
    if (batch === undefined) return;

    setShelf((current) => {
      // Page one REPLACES; later pages append. Without the first half, a
      // refetch of page one after a mutation would double every tile.
      const base = (results.data?.meta.pagination?.current_page ?? 1) === 1 ? [] : current;
      const seen = new Set(base.map((p) => p.id));

      return [...base, ...batch.filter((p) => !seen.has(p.id))];
    });
  }, [results.data]);

  const more = pagination !== undefined && pagination.current_page < pagination.last_page;

  // Product id → { product, qty }. Held rather than looked up from the visible
  // page, so a basket built across two searches survives.
  const [cart, setCart] = useState<Record<string, { product: Product; qty: number }>>({});
  const lines = useMemo(() => Object.values(cart), [cart]);

  // An indication only — the server prices the order and may apply a delivery
  // fee, a coupon or a price level this screen has no business guessing at.
  const estimate = lines.reduce((sum, l) => sum + sellingPrice(l.product) * l.qty, 0);

  /**
   * What is on the shelf for one product.
   *
   * A service has no stock and is never short; a product with variants keeps
   * its count on the sizes, and this form cannot pick a size — so those are
   * left alone rather than judged against a parent row that is always zero.
   * That mistake is exactly what made a deal with sizes unsellable once.
   */
  const stockOf = (p: Product): number | null =>
    p.type !== "product" || p.variants.length > 0 ? null : Number(p.stock_quantity);

  const setQty = (product: Product, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[product.id];
      else next[product.id] = { product, qty };

      return next;
    });

  const short = lines.filter((l) => {
    const stock = stockOf(l.product);

    return stock !== null && l.qty > stock;
  });

  const ready =
    name.trim() !== ""
    && lines.length > 0
    && (fulfillment === "pickup" || address.trim() !== "");

  const submit = () => {
    setError(null);
    take.mutate(
      {
        channel: channel as "phone" | "whatsapp" | "walk_in",
        customer_name: name.trim(),
        customer_phone: phone.trim() || undefined,
        fulfillment_type: fulfillment,
        delivery_address: fulfillment === "delivery" ? address.trim() : undefined,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          toast.success(`Order ${res.data?.order_number ?? ""} is in the queue.`.trim());
          navigate("/tenant/orders");
        },
        // Shown on the page rather than as a toast: a refusal names the item
        // that is short, and that is something to read while fixing the
        // basket, not something to watch slide away.
        onError: (e) => setError(e instanceof Error ? e.message : "Could not take the order."),
      },
    );
  };

  return (
    <>
      <PageMeta title="Take an order | CartZe" description="An order taken by phone, WhatsApp or at the counter" />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Take an order</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            It joins the same queue as an online order — confirm it, prepare it, give it to a rider.
          </p>
        </div>
        <Link
          to="/tenant/orders"
          className="text-theme-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
        >
          ← Back to orders
        </Link>
      </div>

      {error && (
        <div className="mb-5">
          <Alert variant="error" title="Couldn't take the order" message={error} />
        </div>
      )}

      {/* Two thirds and one third at `lg`, matching the new-sale screen — a
          tablet in landscape fits both, and this is the same job. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <SearchGlyph className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              aria-label="Search the catalogue"
              placeholder="Search the catalogue…"
              className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-11 pr-4 text-theme-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-brand-400 focus:bg-white dark:border-gray-800 dark:bg-white/[0.03] dark:text-white dark:focus:bg-white/[0.06]"
            />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {results.isLoading && shelf.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                ))
              : shelf.map((p) => {
                  const stock = stockOf(p);
                  const out = stock !== null && stock <= 0;
                  const inCart = cart[p.id]?.qty ?? 0;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={out}
                      onClick={() => setQty(p, inCart + 1)}
                      className={`flex min-h-24 flex-col justify-between rounded-xl border p-3 text-left transition ${
                        out
                          ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-white/[0.02]"
                          : inCart > 0
                            ? "border-brand-400 bg-brand-50 dark:border-brand-500/50 dark:bg-brand-500/10"
                            : "border-gray-200 bg-white hover:border-brand-300 dark:border-gray-800 dark:bg-white/[0.03]"
                      }`}
                    >
                      <span className="line-clamp-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                        {p.name}
                      </span>
                      <span className="mt-2 flex items-end justify-between gap-2">
                        <span className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                          {money(sellingPrice(p))}
                        </span>
                        {/* WHAT IS ON THE SHELF, before the order is sent
                            rather than in the refusal that comes back. */}
                        {stock !== null && (
                          <span
                            className={`text-theme-xs tabular-nums ${
                              out
                                ? "font-semibold text-error-600 dark:text-error-400"
                                : stock <= 5
                                  ? "text-warning-600 dark:text-warning-400"
                                  : "text-gray-400"
                            }`}
                          >
                            {out ? "none left" : `${formatQuantity(stock)} left`}
                          </span>
                        )}
                      </span>
                      {inCart > 0 && (
                        <span className="mt-1 text-theme-xs font-semibold text-brand-600 dark:text-brand-300">
                          {inCart} in the order
                        </span>
                      )}
                    </button>
                  );
                })}
          </div>

          {!results.isLoading && shelf.length === 0 && (
            <p className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {debounced ? `Nothing in the catalogue matches “${debounced}”.` : "This shop has no products yet."}
            </p>
          )}

          {/* SAYS HOW MANY MORE THERE ARE. The old list showed one page with
              nothing to say the rest of the catalogue existed. */}
          {more && (
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={results.isFetching}
              className="mb-4 w-full rounded-xl border border-gray-200 py-2.5 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {results.isFetching
                ? "Loading…"
                : `Show more — ${(pagination!.total - shelf.length).toLocaleString()} to go`}
            </button>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-800 dark:border-gray-800 dark:text-white/90">
              The order
              {lines.length > 0 && (
                <span className="ml-2 text-theme-xs font-normal text-gray-400">
                  {lines.length} {lines.length === 1 ? "line" : "lines"}
                </span>
              )}
            </h3>

            {lines.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                Nothing added yet — tap an item above.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {lines.map((l) => {
                  const stock = stockOf(l.product);
                  const over = stock !== null && l.qty > stock;

                  return (
                    <li key={l.product.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                          {l.product.name}
                        </span>
                        {over && (
                          // Named on the line, so nobody has to work out which
                          // of nine items the server is going to object to.
                          <span className="block text-theme-xs font-medium text-error-600 dark:text-error-400">
                            Only {formatQuantity(stock)} in stock
                          </span>
                        )}
                      </span>

                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`One fewer ${l.product.name}`}
                          onClick={() => setQty(l.product, l.qty - 1)}
                          className="grid size-9 place-items-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                        >
                          −
                        </button>
                        <span className="w-9 text-center text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                          {l.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${l.product.name}`}
                          onClick={() => setQty(l.product, l.qty + 1)}
                          className="grid size-9 place-items-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-600"
                        >
                          +
                        </button>
                      </span>

                      <span className="w-24 shrink-0 text-right text-theme-sm font-medium tabular-nums text-gray-800 dark:text-white/90">
                        {money(sellingPrice(l.product) * l.qty)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Who it is for, and what it comes to. */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
            <div>
              <Label>Came in by</Label>
              <Select value={channel} options={CHANNELS} onChange={setChannel} />
            </div>

            <div>
              <Label>Customer name <span className="text-error-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who is calling" />
            </div>

            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
              <p className="mt-1 text-theme-xs text-gray-400">
                How the rider reaches them — and how you'll recognise them next time.
              </p>
            </div>

            <div>
              <Label>Fulfilment</Label>
              <div className="flex gap-1.5">
                {(["delivery", "pickup"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFulfillment(f)}
                    className={`min-h-11 flex-1 rounded-xl border px-3 text-theme-sm capitalize transition ${
                      fulfillment === f
                        ? "border-brand-500 bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                        : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {fulfillment === "delivery" && (
              <div>
                <Label>Address <span className="text-error-500">*</span></Label>
                <TextArea value={address} onChange={setAddress} rows={2} placeholder="House, street, area" />
              </div>
            )}

            <div>
              <Label>Notes</Label>
              <TextArea value={notes} onChange={setNotes} rows={2} placeholder="e.g. no chilli, ring the bell" />
            </div>

            <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
              <div className="flex items-baseline justify-between">
                <span className="text-theme-sm text-gray-500 dark:text-gray-400">Approximately</span>
                <span className="text-title-sm font-bold tabular-nums text-gray-800 dark:text-white/90">
                  {money(estimate)}
                </span>
              </div>
              <p className="mt-1 text-theme-xs text-gray-400">
                The shop's own pricing applies — a delivery fee and any offer are added when it is saved.
              </p>
            </div>

            {short.length > 0 && (
              // Said before the button rather than after the refusal, and it
              // does NOT block: a shop that knows it has more coming should be
              // able to take the order anyway. The server has the last word.
              <p className="rounded-xl border border-warning-300 bg-warning-25 px-3 py-2 text-theme-xs text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300">
                {short.length === 1
                  ? `There is not enough ${short[0].product.name} on the shelf.`
                  : `${short.length} items are short on the shelf.`}
              </p>
            )}

            <div className="flex gap-2.5">
              <Link to="/tenant/orders" className="flex-1">
                <Button size="sm" variant="outline" className="w-full">Cancel</Button>
              </Link>
              <Button
                size="sm"
                className="flex-1"
                onClick={submit}
                disabled={!ready || take.isPending}
              >
                {take.isPending ? "Saving…" : "Take order"}
              </Button>
            </div>

            {!ready && lines.length > 0 && (
              // Says what is missing rather than only refusing.
              <p className="text-theme-xs text-gray-400">
                {name.trim() === ""
                  ? "Add the customer's name to save this."
                  : "Add the delivery address to save this."}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
