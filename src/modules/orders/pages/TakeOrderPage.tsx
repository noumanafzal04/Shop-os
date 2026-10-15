import { useAuthStore } from "../../../stores/authStore";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useOnceKey } from "../../../common/onceKey";
import { counted } from "../../../common/format/counted";
import { formatQuantity } from "../../../common/format/quantity";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { SearchGlyph } from "../../../components/ui/filters";
import { useToast } from "../../../components/ui/toast";
import { useCategories, useProducts } from "../../catalog/hooks/useCatalog";
import { leftOf, whyNotOrderable } from "../whatIsLeft";
import { sellingPrice, sizePrice } from "../../catalog/pricing";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import { printTheSlip, slipSays } from "../kitchenSlip";
import { useOrderWorth, useTakeOrder } from "../hooks/useOrders";
import { ChooseHow } from "../components/ChooseHow";
import { asksFirst, itemsOf, lineAnswers, lineName, lineOf, unitPriceOf, type OrderLine } from "../takeOrder";
import { sizesOf } from "../../pos/availability";
import type { Product } from "../../catalog/types";
import { ListEmpty } from "../../../common/ui/ListEmpty";

const CHANNELS = [
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Counter" },
] as const;

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
  // One order, one key, until it is taken: a key minted per press was a
  // second order for a double-click.
  const once = useOnceKey();

  const [channel, setChannel] = useState("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Delivery is a module. A shop without it was started on Delivery and
  // refused at save — "this shop does not offer delivery".
  const delivers = !!useAuthStore((st) => st.user?.tenant?.features?.delivery);
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">(delivers ? "delivery" : "pickup");
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
  /** Which section of the menu is open — "" is all of it. */
  const [section, setSection] = useState("");
  const sections = (useCategories().data ?? []).filter((c) => c.is_active !== false);
  const results = useProducts({ search: debounced || undefined, category_id: section || undefined, for_sale: true, page, per_page: PAGE_SIZE });
  const pagination = results.data?.meta.pagination;

  useEffect(() => {
    setPage(1);
    setShelf([]);
  }, [debounced, section]);

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
  // ONE LINE PER DISH, SIZE AND ANSWERS — see `takeOrder.ts`. It was one line
  // per product, which could not hold a Half and a Full of the same karahi.
  const [cart, setCart] = useState<Record<string, OrderLine>>({});
  const lines = useMemo(() => Object.values(cart), [cart]);
  /** The dish whose size and extras are being asked about, while its sheet is open. */
  const [asking, setAsking] = useState<Product | null>(null);
  const [coupon, setCoupon] = useState("");
  const takesCoupons = !!useAuthStore((st) => st.user?.tenant?.features?.promotions);
  /**
   * THE KITCHEN STARTS NOW — unless somebody says not yet.
   *
   * An order the shop took itself went into the queue as "new, waiting to be
   * accepted" and needed Confirm and then Start preparing before a cook heard
   * of it: three presses for what a restaurant does in one breath. On by
   * default where there is a kitchen; off is for the order wanted this evening.
   */
  const hasKitchen = !!useAuthStore((st) => st.user?.tenant?.features?.kitchen);
  const [sendNow, setSendNow] = useState(true);
  const settings = useShopSettings();

  // What is on the shelf for one product, and whether it can be ordered at
  // all: one rule, in `whatIsLeft`, the same three questions the server asks.
  const stockOf = leftOf;

  const add = (line: OrderLine) =>
    setCart((c) => ({ ...c, [line.key]: { ...line, qty: (c[line.key]?.qty ?? 0) + line.qty } }));
  const setQty = (key: string, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[key];
      else next[key] = { ...next[key], qty };

      return next;
    });
  /** How many of this DISH are on the order, across its sizes. */
  const onOrder = (productId: string) => lines.filter((l) => l.product.id === productId).reduce((n, l) => n + l.qty, 0);
  /** A tap on a tile: asked about first where there is something to ask. */
  const tap = (p: Product) => (asksFirst(p) ? setAsking(p) : add(lineOf(p, { variantId: null, byGroup: {} })));

  const short = lines.filter((l) => {
    const stock = stockOf(l.product);

    return stock !== null && onOrder(l.product.id) > stock;
  });

  // ── WHAT IT COMES TO — the server's figure, never one added up here ────
  //
  // This page printed "Approximately" over its own sum. It could not have
  // known better: the delivery fee, the order above which delivery is free, a
  // coupon and what an extra costs were all the server's to say. So it is
  // asked — each time the order changes, a moment after the last tap — and
  // while the answer is on its way there is NO figure, rather than the last
  // one or a guess.
  const asked = useMemo(
    () => JSON.stringify({
      channel,
      fulfillment_type: fulfillment,
      items: itemsOf(lines),
      coupon_code: coupon.trim() || undefined,
    }),
    [channel, fulfillment, lines, coupon],
  );
  const askedSettled = useDebouncedValue(asked, 250);
  const worthQ = useOrderWorth(askedSettled, lines.length > 0);
  const worth = lines.length > 0 && askedSettled === asked && !worthQ.isFetching ? worthQ.data ?? null : null;
  const refused = lines.length > 0 && askedSettled === asked && !worthQ.isFetching && worthQ.error instanceof Error ? worthQ.error.message : null;

  const ready =
    name.trim() !== ""
    && lines.length > 0
    // …and the figure it will be taken at is on the screen.
    && worth !== null
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
        items: itemsOf(lines),
        coupon_code: coupon.trim() || undefined,
        notes: notes.trim() || undefined,
        send_to_kitchen: hasKitchen && sendNow ? true : undefined,
        idempotency_key: once.key,
      },
      {
        onSuccess: (res) => {
          once.renew();
          const order = res.data;
          // Its slip, where the kitchen works off paper — printed by this
          // screen, which is the one that sent it. Said either way.
          void printTheSlip(order?.kitchen_ticket, settings.data?.kot_auto_print !== false).then((outcome) => {
            const says = slipSays(outcome, order?.order_number ?? "The order");
            if (says === null) toast.success(`Order ${order?.order_number ?? ""} is in the queue.`.trim());
            else if (outcome === "did not print") toast.error(says);
            else toast.success(says);
          });
          navigate("/tenant/orders");
        },
        // Shown on the page rather than as a toast: a refusal names the item
        // that is short, and that is something to read while fixing the
        // basket, not something to watch slide away.
        onError: (e) => setError(e instanceof Error ? e.message : "Could not take the order."),
      },
    );
  };

  /** How many things are on the order, counting two of a dish as two. */
  const units = lines.reduce((n, l) => n + l.qty, 0);
  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-theme-sm transition ${
      on
        ? "border-white bg-white font-semibold text-brand-700"
        : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
    }`;
  const whyNotYet =
    lines.length === 0
      ? null
      : name.trim() === ""
        ? "Add the customer's name to take it."
        : fulfillment === "delivery" && address.trim() === ""
          ? "Add the delivery address to take it."
          : refused !== null
            ? "Put right what is said beside the total to take it."
            : worth === null
              ? "One moment — the total is being worked out."
              : null;

  return (
    <>
      <PageMeta title="Take an order" description="An order taken by phone, WhatsApp or at the counter" />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Take an order</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            It joins the same queue as an online order.
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
        <div className="mb-3">
          <Alert variant="error" title="Couldn't take the order" message={error} />
        </div>
      )}

      {/* ARRANGED LIKE THE TILL: the menu on one side, the order on the other,
          and what it comes to — with the one button — in a strip along the
          bottom. On a wide screen the page itself does not scroll: the menu
          scrolls in its pane and the order's lines in theirs, so nothing is
          ever pushed out of sight by loading more of the menu.

          It was first the order UNDER the menu (every "Show more" pushed it
          further down), then a tall panel whose middle scrolled with the
          customer's details inside it. Who it is for is two rows now, always
          in sight above the lines. */}
      <div className="flex flex-col gap-3 lg:h-[calc(100dvh-10.5rem)] lg:min-h-[31rem]">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* ── the menu ─────────────────────────────────────────── */}
          <section aria-label="Menu" className="flex min-h-0 min-w-0 flex-col rounded-2xl bg-brand-950 p-3 text-white sm:p-3.5">
            <div className="relative shrink-0">
              <SearchGlyph className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                type="search"
                aria-label="Search products"
                placeholder="Search products…"
                className="h-11 w-full rounded-xl border border-transparent bg-white pl-11 pr-4 text-theme-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-brand-300 focus:ring-4 focus:ring-brand-300/30"
              />
            </div>

            {/* The sections of the menu: a row that slides, never one that
                wraps a line of dishes off the screen. */}
            {sections.length > 0 && (
              <div role="group" aria-label="Section" className="no-scrollbar -mx-1 mt-2.5 flex shrink-0 gap-2 overflow-x-auto px-1 pb-0.5">
                <button type="button" aria-pressed={section === ""} onClick={() => setSection("")} className={chip(section === "")}>All</button>
                {sections.map((c) => (
                  <button key={c.id} type="button" aria-pressed={section === c.id} onClick={() => setSection(c.id)} className={chip(section === c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 min-h-0 flex-1 lg:-mr-1.5 lg:overflow-y-auto lg:pr-1.5 lg:pt-2">
              {/* `data-rows`: this is a list of records, to whatever counts what a screen shows. */}
              <div data-rows={shelf.length > 0 ? "" : undefined} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {results.isLoading && shelf.length === 0
                  ? Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="h-[5.5rem] animate-pulse rounded-xl bg-white/10" />
                    ))
                  : shelf.map((p) => {
                      const stock = stockOf(p);
                      const why = whyNotOrderable(p);
                      const out = why !== null;
                      const inCart = onOrder(p.id);
                      const sizes = sizesOf(p);

                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={out}
                          onClick={() => tap(p)}
                          className={`relative flex min-h-[5.5rem] flex-col justify-between rounded-xl border-2 p-3 text-left transition active:scale-[0.98] disabled:active:scale-100 ${
                            out
                              ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-55"
                              : inCart > 0
                                ? "border-brand-300 bg-brand-500/35"
                                : "border-white/10 bg-white/[0.07] hover:border-brand-300 hover:bg-white/[0.12]"
                          }`}
                        >
                          <span className="line-clamp-2 pr-3 text-theme-sm font-semibold leading-snug text-white">
                            {p.name}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
                            <span className="whitespace-nowrap text-theme-sm font-bold tabular-nums text-brand-200">
                              {/* A dish in sizes has no one price: it starts from its smallest. */}
                              {sizes.length > 0 ? `from ${money(Math.min(...sizes.map((v) => sizePrice(p, v))))}` : money(sellingPrice(p))}
                            </span>
                            {/* WHAT IS ON THE SHELF, before the order is sent
                                rather than in the refusal that comes back. */}
                            {(why !== null || stock !== null) && (
                              <span
                                className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-theme-xs tabular-nums ${
                                  out
                                    ? "bg-error-500/30 font-bold uppercase text-error-100"
                                    : stock !== null && stock <= 5
                                      ? "bg-warning-500/25 font-medium text-warning-100"
                                      : "text-white/55"
                                }`}
                              >
                                {/* "off" is the kitchen's word for a dish taken off today. */}
                                {why ?? `${formatQuantity(stock ?? 0)} left`}
                              </span>
                            )}
                          </span>
                          {/* How many of it are on the order — on the tile the
                              finger is on. LAST in the button, though it is
                              drawn in the corner: a tile is called by its dish
                              first. */}
                          {inCart > 0 && (
                            <span
                              data-testid="tile-count"
                              aria-label={`${inCart} on the order`}
                              className="absolute -right-1.5 -top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-1.5 text-theme-sm font-bold tabular-nums text-brand-700 ring-2 ring-brand-950"
                            >
                              {inCart}
                            </span>
                          )}
                        </button>
                      );
                    })}
              </div>

              {!results.isLoading && shelf.length === 0 && (
                <ListEmpty from={results} what="the products">
                  <p className="rounded-xl border border-dashed border-white/25 py-10 text-center text-sm text-white/70">
                    {debounced ? `No product matches “${debounced}”.` : section ? "Nothing in this section." : "This shop has no products yet."}
                  </p>
                </ListEmpty>
              )}

              {/* SAYS HOW MANY MORE THERE ARE. The old list showed one page with
                  nothing to say the rest of the catalogue existed. */}
              {more && (
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={results.isFetching}
                  className="mt-3 w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-theme-sm font-medium text-white/85 transition hover:bg-white/10 disabled:opacity-50"
                >
                  {results.isFetching
                    ? "Loading…"
                    : `Show more — ${(pagination!.total - shelf.length).toLocaleString()} to go`}
                </button>
              )}
            </div>

            {/* ON A NARROW SCREEN the order is below the menu, so it is kept one
                press away: what is on it and what it comes to, at the foot of
                the menu wherever the menu is scrolled to. */}
            {lines.length > 0 && (
              <button
                type="button"
                data-testid="see-the-order"
                onClick={() => document.getElementById("the-order")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="sticky bottom-[calc(0.75rem+var(--pinned-bottom,0px))] z-10 mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left text-brand-800 shadow-theme-lg transition hover:bg-brand-50 lg:hidden"
              >
                <span className="text-theme-sm font-semibold">{counted(units, "item")} on the order</span>
                <span className="flex items-center gap-2 text-theme-sm font-bold tabular-nums">
                  {worth !== null ? money(worth.total) : ""}
                  <span aria-hidden="true">See the order ↓</span>
                </span>
              </button>
            )}
          </section>

          {/* ── the order ────────────────────────────────────────── */}
          <aside
            id="the-order"
            aria-label="The order"
            className="@container flex min-h-0 min-w-0 scroll-mt-24 flex-col overflow-hidden rounded-2xl lg:overflow-y-auto border border-gray-200 bg-white shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-brand-100 bg-brand-50 px-4 py-2.5 dark:border-brand-500/30 dark:bg-brand-500/10">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                The order
                <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand-500 px-1.5 text-theme-xs font-bold tabular-nums text-white">
                  {units}
                </span>
              </h2>
              <div className="flex w-full items-center gap-2.5 @md:w-auto">
                <span aria-hidden="true" className="hidden shrink-0 text-theme-xs font-medium text-gray-500 dark:text-gray-400 @lg:block">Came in by</span>
                <div className="w-full @md:w-64">
                  <Segments label="Came in by" value={channel} options={CHANNELS} onChange={setChannel} />
                </div>
              </div>
            </header>

            {/* ── who it is for: two rows, always in sight ─────────── */}
            <div className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-2.5 border-b border-gray-100 bg-gray-50/70 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02] @md:grid-cols-12">
              <div className="@md:col-span-4">
                <Label htmlFor="order-name">Customer name <span className="text-error-500">*</span></Label>
                <Input id="order-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Who is calling" />
              </div>
              <div className="@md:col-span-4">
                <Label htmlFor="order-phone">Phone</Label>
                <Input id="order-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
              </div>
              <div className="col-span-2 @md:col-span-4">
                <Label>How it reaches them</Label>
                <Segments
                  label="How it reaches them"
                  value={fulfillment}
                  options={[...(delivers ? [{ value: "delivery" as const, label: "Delivery" }] : []), { value: "pickup" as const, label: "Pickup" }]}
                  onChange={setFulfillment}
                />
              </div>
              {fulfillment === "delivery" && (
                <div className={`col-span-2 ${takesCoupons ? "@md:col-span-5" : "@md:col-span-6"}`}>
                  <Label htmlFor="order-address">Address <span className="text-error-500">*</span></Label>
                  <Input id="order-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, street, area" />
                </div>
              )}
              <div
                className={`${takesCoupons ? "" : "col-span-2"} ${
                  fulfillment === "delivery" ? (takesCoupons ? "@md:col-span-4" : "@md:col-span-6") : takesCoupons ? "@md:col-span-9" : "@md:col-span-12"
                }`}
              >
                <Label htmlFor="order-notes">Notes</Label>
                <Input id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no chilli" />
              </div>
              {takesCoupons && (
                <div className="@md:col-span-3">
                  <Label htmlFor="order-coupon">Coupon</Label>
                  <Input id="order-coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Optional" />
                </div>
              )}
            </div>

            {/* ── its lines ────────────────────────────────────────── */}
            <div className="flex-1 lg:min-h-[8.5rem] lg:overflow-y-auto">
              {lines.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  Nothing on it yet — tap a dish on the menu.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {lines.map((l, at) => {
                    const stock = stockOf(l.product);
                    const over = stock !== null && onOrder(l.product.id) > stock;
                    const said = worth?.lines[at];
                    const answers = lineAnswers(l);

                    return (
                      <li key={l.key} data-order-line={lineName(l)} className="flex items-center gap-2.5 px-4 py-2 @md:gap-3">
                        <span className="hidden w-5 shrink-0 text-theme-xs tabular-nums text-gray-400 @md:block">{at + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-theme-sm font-semibold leading-snug text-gray-800 dark:text-white/90">
                            {lineName(l)}
                          </span>
                          {answers !== "" && (
                            <span className="block text-theme-xs text-gray-500 dark:text-gray-400">{answers}</span>
                          )}
                          {over && (
                            <span className="block text-theme-xs font-medium text-error-600 dark:text-error-400">
                              Only {formatQuantity(stock)} in stock
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            aria-label={`One fewer ${lineName(l)}`}
                            onClick={() => setQty(l.key, l.qty - 1)}
                            className="grid size-9 place-items-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                          >
                            {l.qty === 1 ? "×" : "−"}
                          </button>
                          <span className="w-8 text-center text-theme-sm font-bold tabular-nums text-gray-800 dark:text-white/90">
                            {l.qty}
                          </span>
                          <button
                            type="button"
                            aria-label={`One more ${lineName(l)}`}
                            onClick={() => setQty(l.key, l.qty + 1)}
                            className="grid size-9 place-items-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-600"
                          >
                            +
                          </button>
                        </span>
                        {/* The server's own figure for the line once it has
                            said; this page's sum of it until then. */}
                        <span className="w-[4.5rem] shrink-0 text-right text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90 @md:w-24">
                          {money(said ? said.line_total : unitPriceOf(l.product, l.variant, l.options) * l.qty)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>

        {/* ── along the bottom: what it comes to, and the one button ── */}
        <div className="grid shrink-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          {/* WHAT IT COMES TO. The server's figures, and only once it has given
              them: nothing while it is being worked out, and its own words
              when it will not take the order as it stands. */}
          <div
            data-testid="order-worth"
            aria-live="polite"
            className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-gray-200 bg-white px-5 py-2.5 xl:min-h-[4.5rem] dark:border-gray-800 dark:bg-gray-900"
          >
            {lines.length === 0 ? (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">Add something to see what it comes to.</p>
            ) : refused !== null ? (
              <p className="flex-1 text-theme-sm font-medium text-warning-700 dark:text-warning-400">
                <span className="font-semibold">It cannot be taken like this.</span> {refused}
              </p>
            ) : worth === null ? (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">Working it out…</p>
            ) : (
              <>
                <Figure label="Items" value={String(units)} />
                <Figure label="The order" value={money(worth.subtotal)} />
                {worth.discount > 0 && <Figure label={`Coupon ${worth.coupon_code ?? ""}`.trim()} value={`−${money(worth.discount)}`} tone="good" />}
                {fulfillment === "delivery" && <Figure label="Delivery" value={worth.delivery_fee > 0 ? money(worth.delivery_fee) : "Free"} />}
              </>
            )}
            {short.length > 0 && (
              <p className="text-theme-xs font-medium text-warning-700 dark:text-warning-400">
                {short.length === 1
                  ? `There is not enough ${short[0].product.name} on the shelf.`
                  : `${short.length} items are short on the shelf.`}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-100 to-brand-50 px-5 py-2.5 xl:py-3 dark:border-brand-500/40 dark:from-brand-500/20 dark:to-brand-500/10">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-brand-700 dark:text-brand-300">
                {fulfillment === "delivery" ? "To collect at the door" : "To pay when collecting"}
              </div>
              <div className="text-title-sm font-bold tabular-nums leading-tight text-gray-900 dark:text-white">
                {worth !== null ? <span data-testid="order-total">{money(worth.total)}</span> : <span className="text-gray-400">—</span>}
              </div>
            </div>
            {hasKitchen && (
              <label className="flex cursor-pointer items-center gap-2 text-theme-sm font-medium text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={sendNow}
                  onChange={(e) => setSendNow(e.target.checked)}
                  className="size-4 rounded border-gray-300 text-brand-500 focus:ring-brand-400"
                />
                Send to the kitchen now
              </label>
            )}
            <div className="ml-auto flex items-center gap-2.5">
              <Link to="/tenant/orders">
                <Button size="sm" variant="outline">Cancel</Button>
              </Link>
              <Button className="min-h-12 px-7" onClick={submit} disabled={!ready || take.isPending}>
                {take.isPending ? "Saving…" : "Take order"}
              </Button>
            </div>
          </div>
        </div>

        {whyNotYet !== null && (
          <p className="-mt-1 text-right text-theme-xs text-gray-500 dark:text-gray-400">{whyNotYet}</p>
        )}
      </div>

      <ChooseHow product={asking} onClose={() => setAsking(null)} onAdd={add} />
    </>
  );
}

/** One figure of the strip along the bottom — its name small above it, as on the till. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight ${tone === "good" ? "text-success-600 dark:text-success-400" : "text-gray-900 dark:text-white"}`}>{value}</div>
    </div>
  );
}

/**
 * A choice of two or three, all in sight — where a drop-down hid them. Each is
 * a radio by its own name, so a screen reader hears "Delivery, 1 of 2".
 */
function Segments<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-gray-200/70 p-1 dark:bg-white/5">
      {options.map((o) => {
        const on = value === o.value;

        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`min-h-10 rounded-lg px-2 text-theme-sm transition ${
              on
                ? "bg-white font-semibold text-brand-600 shadow-theme-xs dark:bg-gray-800 dark:text-brand-300"
                : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
