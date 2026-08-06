import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { useMoney } from "../../shop/hooks/useShop";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { useTakeOrder } from "../hooks/useOrders";
import type { Product } from "../../catalog/types";

const CHANNELS = [
  { value: "phone", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "At the counter" },
] as const;

/**
 * Taking an order the shop received itself.
 *
 * The screen is laid out in the order the conversation happens: who is calling,
 * what they want, where it's going. Prices are shown but never editable — the
 * server decides what the basket costs, exactly as it does for a web checkout,
 * and a counter that could type its own prices is a counter that can discount
 * without anyone knowing.
 */
export default function TakeOrderModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const money = useMoney();
  const take = useTakeOrder();

  const [channel, setChannel] = useState<string>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const products = useProducts({ search: query || undefined });

  // Product id → { product, qty }. Held rather than looked up from the visible
  // page, so a basket built across two searches survives.
  const [cart, setCart] = useState<Record<string, { product: Product; qty: number }>>({});

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const lines = useMemo(() => Object.values(cart), [cart]);
  // An indication only — the server prices the order and may apply a delivery
  // fee, a coupon or a price level this screen has no business guessing at.
  const estimate = lines.reduce((sum, l) => sum + Number(l.product.price) * l.qty, 0);

  const setQty = (product: Product, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[product.id];
      else next[product.id] = { product, qty };
      return next;
    });

  const reset = () => {
    setChannel("phone"); setName(""); setPhone("");
    setFulfillment("delivery"); setAddress(""); setNotes("");
    setCart({}); setSearch(""); setError(null);
  };

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
        onSuccess: () => { reset(); onClose(); },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not take the order"),
      },
    );
  };

  const ready = name.trim() !== "" && lines.length > 0 && (fulfillment === "pickup" || address.trim() !== "");

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-2xl p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Take an order</h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        It joins the same queue as an online order — confirm it, prepare it, give it to a rider.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-600 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Who ─────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div>
            <Label>Came in by</Label>
            <Select
              value={channel}
              options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
              onChange={setChannel}
            />
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
                  onClick={() => setFulfillment(f)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-theme-xs capitalize transition ${
                    fulfillment === f
                      ? "border-brand-500 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
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
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, street, area" />
            </div>
          )}
        </div>

        {/* What ────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div>
            <Label>Items <span className="text-error-500">*</span></Label>
            <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700">
            {(products.data?.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-theme-xs text-gray-400">No products match.</p>
            ) : (
              products.data?.data.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setQty(p, (cart[p.id]?.qty ?? 0) + 1)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate text-theme-sm text-gray-700 dark:text-gray-200">{p.name}</span>
                  <span className="text-theme-xs tabular-nums text-gray-400">{money(p.price)}</span>
                </button>
              ))
            )}
          </div>

          {lines.length > 0 && (
            <div className="space-y-1.5 rounded-lg bg-gray-50 p-2.5 dark:bg-white/[0.04]">
              {lines.map((l) => (
                <div key={l.product.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-theme-sm text-gray-700 dark:text-gray-200">
                    {l.product.name}
                  </span>
                  <button
                    className="h-6 w-6 rounded border border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
                    onClick={() => setQty(l.product, l.qty - 1)}
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-theme-sm tabular-nums text-gray-800 dark:text-white/90">{l.qty}</span>
                  <button
                    className="h-6 w-6 rounded bg-brand-500 text-white"
                    onClick={() => setQty(l.product, l.qty + 1)}
                  >
                    +
                  </button>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-t border-gray-200 pt-1.5 dark:border-gray-700">
                <span className="text-theme-xs text-gray-400">Approx.</span>
                <span className="text-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(estimate)}</span>
              </div>
              <p className="text-[10px] text-gray-400">
                The shop's own pricing applies — delivery fee and any offer are added when it's saved.
              </p>
            </div>
          )}

          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no chilli, ring the bell" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={!ready || take.isPending}>
          {take.isPending ? "Saving…" : "Take order"}
        </Button>
      </div>
    </Modal>
  );
}
