/**
 * A weighing scale's label, read by the till itself.
 *
 * A mart weighs loose sugar on a scale that prints a barcode carrying the
 * item's PLU and the weight. With a connection the till sends those thirteen
 * digits to the server and is told "sugar, 1.5 kg". Without one it looked
 * them up as an ordinary barcode, found nothing, and said "Nothing here
 * matches" — so the moment the line dropped, a shop could not sell anything
 * it weighs.
 *
 * Everything needed was already on the device: the three `scale_barcode_*`
 * settings are in the till's copy of the shop's settings (shipped on every
 * pull, and read by nobody), and every item carries its `plu_code`.
 *
 * ── The rule is the server's, digit for digit ────────────────────────
 *
 * `App\Support\ScaleBarcode::parse`. Thirteen digits:
 *
 *     [ prefix ][ item / PLU ][ value (5) ][ check (1) ]
 *
 * and the same refusals: off unless the shop switched it on; exactly thirteen
 * digits; must start with the shop's prefix; the check digit is ignored
 * (the scanner already verified it). Held to the server by
 * `fixtures/scale-labels.json`, which is the real lookup endpoint's answers.
 */

/** Digits reserved for the weight or the price. */
const VALUE_LEN = 5;

export interface ScaleLabel {
  /** As printed: zero-padded to the scale's own width. */
  itemCode: string;
  mode: "weight" | "price";
  /** Kilograms (the label carries grams). Null on a price label. */
  weight: number | null;
  /** Rupees (the label carries hundredths). Null on a weight label. */
  price: number | null;
}

type Settings = Record<string, unknown> | null | undefined;

export function parseScaleLabel(code: string, settings: Settings): ScaleLabel | null {
  if (!settings || settings.scale_barcode_enabled !== true) return null;

  const digits = code.trim();
  const prefix = String(settings.scale_barcode_prefix ?? "2");
  const mode = settings.scale_barcode_mode === "price" ? "price" : "weight";

  const itemLen = 13 - prefix.length - VALUE_LEN - 1;
  if (prefix === "" || itemLen < 1 || digits.length !== 13 || !/^\d{13}$/.test(digits) || !digits.startsWith(prefix)) {
    return null;
  }

  const itemCode = digits.slice(prefix.length, prefix.length + itemLen);
  const raw = Number(digits.slice(prefix.length + itemLen, prefix.length + itemLen + VALUE_LEN));

  return {
    itemCode,
    mode,
    weight: mode === "weight" ? Math.round(raw) / 1000 : null,
    price: mode === "price" ? Math.round(raw) / 100 : null,
  };
}

/**
 * The PLU a shop may have typed for this label's item.
 *
 * A scale pads the field to its fixed width, and a person types "21". Both
 * are the same item, so both are looked for — as the server does.
 */
export function pluCandidates(label: ScaleLabel): string[] {
  const stripped = label.itemCode.replace(/^0+/, "");

  return [...new Set([label.itemCode, stripped === "" ? "0" : stripped])];
}

/** What is being charged per unit: the sale price when there is a real one. */
const sellingPrice = (item: { price: number | string; discount_price?: number | string | null }): number => {
  const price = Number(item.price);
  const sale = item.discount_price == null ? NaN : Number(item.discount_price);

  return Number.isFinite(sale) && sale > 0 && sale < price ? sale : price;
};

/**
 * How much of the item this label is.
 *
 * A weight label says so. A price label says what the scale charged, and the
 * weight is worked back from the price THIS shop is charging — to the gram,
 * as the server rounds it.
 */
export function labelQuantity(label: ScaleLabel, item: { price: number | string; discount_price?: number | string | null }): number {
  if (label.mode === "weight") return label.weight ?? 0;

  const unit = sellingPrice(item);

  return unit > 0 ? Math.round(((label.price ?? 0) / unit) * 1000) / 1000 : 0;
}
