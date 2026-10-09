import type { ShopSettings } from "../../shop/services/shopService";
import { isStockKey, type StockKey } from "./sheet";

/**
 * WHAT A LABEL CARRIES, and what it is printed on.
 *
 * Two of these sat under Settings → Barcodes, two screens from the sticker
 * they changed; the other six were under a collapsed "Options" on the labels
 * screen and forgotten on every visit. Nobody printing a label could say which
 * were in force. They are one set now, on the screen that draws the label,
 * and the shop's.
 */
export interface LabelPrefs {
  name: boolean;
  price: boolean;
  digits: boolean;
  shop: boolean;
  pack: boolean;
  cut: boolean;
  stock: StockKey;
  paper: "sheet" | "roll";
}

export const LABEL_FIELDS = [
  { key: "name", label: "Product name" },
  { key: "price", label: "Price" },
  { key: "digits", label: "Barcode number" },
  { key: "shop", label: "Shop name" },
  { key: "pack", label: "Pack size" },
  { key: "cut", label: "Cut lines" },
] as const satisfies ReadonlyArray<{ key: keyof LabelPrefs; label: string }>;

/** Each choice, and the shop setting that holds it. */
const HELD_AS: Record<keyof LabelPrefs, keyof ShopSettings> = {
  name: "barcode_show_name",
  price: "barcode_show_price",
  digits: "label_show_digits",
  shop: "label_show_shop",
  pack: "label_show_pack",
  cut: "label_cut_lines",
  stock: "label_stock",
  paper: "label_paper",
};

/** The shop's saved choices. Anything unset is how a label has always printed. */
export function labelPrefs(s: Partial<ShopSettings> | undefined): LabelPrefs {
  return {
    name: s?.barcode_show_name !== false,
    price: s?.barcode_show_price !== false,
    digits: s?.label_show_digits !== false,
    shop: s?.label_show_shop === true,
    pack: s?.label_show_pack === true,
    cut: s?.label_cut_lines !== false,
    stock: isStockKey(s?.label_stock) ? s.label_stock : "50x25",
    paper: s?.label_paper === "roll" ? "roll" : "sheet",
  };
}

/** A change, as the settings endpoint takes it — only what changed. */
export function toSettings(patch: Partial<LabelPrefs>): Partial<ShopSettings> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    out[HELD_AS[key as keyof LabelPrefs]] = value;
  }

  return out as Partial<ShopSettings>;
}
