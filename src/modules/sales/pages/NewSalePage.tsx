import { useEffect, useMemo, useRef, useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import { uuid } from "../../../common/uuid";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { sellingPrice } from "../../catalog/pricing";
import type { Product, ProductVariant } from "../../catalog/types";
import { useSaleMutations } from "../hooks/useSales";
import type { PaymentMethod, SaleChannel } from "../types";
import { ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

interface CartLine {
  key: string;
  product: Product;
  variant: ProductVariant | null;
  quantity: number;
  // Display estimate only — the SERVER prices every line authoritatively
  // (sale price / qty tiers / current price). Nothing here is sent.
  unitPrice: number;
  priceTiers: Array<{ min_qty: number | string; price: number | string }> | null;
}



/** Effective per-unit display price: deepest qty tier reached, else base. */
const lineUnit = (l: CartLine): number => {
  let best: number | null = null;
  let bestMin = 0;
  for (const t of l.priceTiers ?? []) {
    const min = Number(t.min_qty);
    const price = Number(t.price);
    if (min > 0 && price > 0 && l.quantity >= min && min > bestMin) {
      best = price;
      bestMin = min;
    }
  }
  return best ?? l.unitPrice;
};

/**
 * Quick-sale screen: search → add lines → totals → payment → complete.
 * Prices are read-only — the backend prices each line (sale price, tiers,
 * current price), so staff cannot override what an item sells for. One
 * idempotency key per cart state makes retries and double-clicks safe.
 */
export default function NewSalePage() {
  const money = useMoney();
  const navigate = useNavigate();
  const { create } = useSaleMutations();

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const results = useProducts({ search: debounced, page: 1 });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [channel, setChannel] = useState<SaleChannel>("walk_in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");

  // Same key while THIS cart state is being submitted → server replays
  // instead of duplicating; new key as soon as the cart changes.
  const idemRef = useRef<string>(uuid());
  useEffect(() => { idemRef.current = uuid(); }, [cart]);

  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + lineUnit(line) * line.quantity, 0),
    [cart],
  );
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const changeDue = Math.max(0, (Number(amountPaid) || 0) - total);

  const addLine = (product: Product, variant: ProductVariant | null = null) => {
    const key = `${product.id}:${variant?.id ?? "base"}`;
    setCart((lines) => {
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...lines,
        {
          key,
          product,
          variant,
          quantity: 1,
          unitPrice: variant ? Number(variant.price) : sellingPrice(product),
          priceTiers: variant ? null : product.price_tiers,
        },
      ];
    });
    setSearch("");
  };

  const setQuantity = (key: string, quantity: number) => {
    setCart((lines) => lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
  };

  const removeLine = (key: string) => setCart((lines) => lines.filter((l) => l.key !== key));

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorMessage = apiError ? apiError.firstFieldError() ?? apiError.message : null;

  const complete = () => {
    if (cart.length === 0 || create.isPending) return;
    create.mutate(
      {
        channel,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        items: cart.map((l) => ({
          product_id: l.product.id,
          variant_id: l.variant?.id ?? undefined,
          quantity: l.quantity,
        })),
        discount: Number(discount) || undefined,
        payment_method: paymentMethod,
        amount_paid: Number(amountPaid) || 0,
        idempotency_key: idemRef.current,
      },
      {
        onSuccess: () => {
          idemRef.current = uuid();
          navigate("/tenant/sales");
        },
      },
    );
  };

  const searchResults = (results.data?.data ?? []).filter((p) => p.is_active);

  return (
    <>
      <PageMeta title="New Sale | CartZe" description="Point of sale" />

      <div className="mb-6">
        <Link to="/tenant/sales" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← Back to sales
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">New Sale</h2>
      </div>

      {errorMessage && (
        <div className="mb-5">
          <Alert variant="error" title="Couldn't complete sale" message={errorMessage} />
        </div>
      )}

      {/* 2/1 from `lg` up, not `xl`.
          A tablet in landscape is 1024-1194 and was getting the phone stack:
          the cart full width, then the totals a scroll below it. On a screen
          that fits both, "what am I selling" and "what does it come to" belong
          in one glance. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: item search + cart */}
        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <Input
              placeholder="Search items to add…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {debounced && searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {searchResults.slice(0, 8).map((p) => (
                  <div key={p.id}>
                    {(p.variants ?? []).length === 0 ? (
                      <button
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5"
                        onClick={() => addLine(p)}
                      >
                        <span className="text-gray-800 dark:text-white/90">
                          {p.name}
                          {p.type === "product" && (
                            <span className="ml-2 text-theme-xs text-gray-400">stock {p.stock_quantity}</span>
                          )}
                        </span>
                        <span className="text-gray-500">{money(sellingPrice(p))}</span>
                      </button>
                    ) : (
                      (p.variants ?? []).map((v) => (
                        <button
                          key={v.id}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5"
                          onClick={() => addLine(p, v)}
                        >
                          <span className="text-gray-800 dark:text-white/90">
                            {p.name} <span className="text-gray-400">/ {v.name}</span>
                            <span className="ml-2 text-theme-xs text-gray-400">stock {v.stock_quantity}</span>
                          </span>
                          <span className="text-gray-500">{money(Number(v.price))}</span>
                        </button>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
            {cart.length === 0 ? (
              <p className="px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
                Cart is empty — search above to add items.
              </p>
            ) : (
              /* `min-w` + a scroller rather than `overflow-hidden`.
                 Five columns, one of them a number box you have to hit with a
                 finger, do not fit in 320px — and the old wrapper CLIPPED the
                 overflow rather than letting it scroll, so on a narrow pane
                 the Total column simply was not there and nothing said so. */
              <table className="w-full min-w-[34rem] text-left text-theme-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Price</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-2 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {cart.map((line) => (
                    <tr key={line.key} className="text-gray-700 dark:text-gray-300">
                      <td className="px-4 py-3">
                        {line.product.name}
                        {line.variant && <span className="text-gray-400"> / {line.variant.name}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={1}
                          className="w-16 rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
                          value={line.quantity}
                          onChange={(e) => setQuantity(line.key, Math.max(1, Number(e.target.value)))}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {money(lineUnit(line))}
                        {lineUnit(line) < Number(line.variant?.price ?? line.product.price) && (
                          <span className="ml-1.5 text-theme-xs text-gray-400 line-through">
                            {money(Number(line.variant?.price ?? line.product.price))}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {money(lineUnit(line) * line.quantity)}
                      </td>
                      <td className="px-2 py-3">
                        <button className={ROW_ACTION_DANGER} onClick={() => removeLine(line.key)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: totals + payment */}
        <div className="h-fit space-y-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Channel</Label>
              <Select
                options={[
                  { value: "walk_in", label: "Walk-in" },
                  { value: "phone", label: "Phone" },
                  { value: "whatsapp", label: "WhatsApp" },
                ]}
                placeholder="Walk-in"
                onChange={(v) => setChannel(v as SaleChannel)}
              />
            </div>
            <div>
              <Label>Payment</Label>
              <Select
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "card", label: "Card" },
                  { value: "bank_transfer", label: "Bank transfer" },
                  { value: "other", label: "Other" },
                ]}
                placeholder="Cash"
                onChange={(v) => setPaymentMethod(v as PaymentMethod)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Customer (optional)</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Name" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+92…" />
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-200 pt-4 text-sm dark:border-gray-800">
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-600 dark:text-gray-400">Discount</span>
              {/* Named, because the word beside it is a <span> and not a
                  <label>: visible and unannounced. Two money boxes that both
                  read "edit text, blank" is not cosmetic — a discount typed
                  into amount paid is a bill that balances and is wrong. */}
              <input
                type="number"
                aria-label="Discount"
                min={0}
                className="w-28 rounded border border-gray-300 px-2 py-1 text-right dark:border-gray-700 dark:bg-gray-900"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex justify-between text-lg font-bold text-gray-800 dark:text-white/90">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-600 dark:text-gray-400">Amount paid</span>
              <input
                type="number"
                aria-label="Amount paid"
                min={0}
                className="w-28 rounded border border-gray-300 px-2 py-1 text-right dark:border-gray-700 dark:bg-gray-900"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="0"
              />
            </div>
            {changeDue > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Change</span>
                <span>{money(changeDue)}</span>
              </div>
            )}
          </div>

          <Button
            className="w-full"
            disabled={create.isPending || cart.length === 0 || (Number(amountPaid) || 0) < total}
            onClick={complete}
          >
            {create.isPending ? "Completing…" : `Complete Sale ${total > 0 ? "· " + money(total) : ""}`}
          </Button>
          {cart.length > 0 && (Number(amountPaid) || 0) < total && (
            <p className="text-center text-theme-xs text-gray-400">
              Amount paid must cover the total.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
