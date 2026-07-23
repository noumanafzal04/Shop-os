import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Select from "../../../components/form/Select";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError, type ApiMeta } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import {
  useCategories,
  useCollections,
  useItemTypes,
  useProduct,
  useProducts,
  useProductImages,
  useProductMutations,
  useSyncModifiers,
} from "../hooks/useCatalog";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import { catalogService } from "../services/catalogService";
import type { ItemTypeCode, ModifierGroup, VariantInput } from "../types";

interface FormVariant extends VariantInput {
  _key: string;
}

let keyCounter = 0;
const nextKey = () => `v${++keyCounter}`;

/** A compact labelled on/off switch used for stock + marketplace flags. */
function Toggle({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-xl border border-gray-200 p-4 text-left dark:border-gray-800"
    >
      <span>
        <span className="block text-sm font-medium text-gray-800 dark:text-white/90">{title}</span>
        {hint && <span className="mt-0.5 block text-theme-xs text-gray-400">{hint}</span>}
      </span>
      <span
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
          checked ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition ${checked ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}

/**
 * Create/edit an item. Type (product/service) is chosen once at creation —
 * services hide stock/variants, per the common Item model. On edit, stock is
 * read-only (inventory module owns stock movements).
 */
export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Select STABLE references — never build a new object in the selector
  // (a fresh `?? {}` each render triggers an infinite re-render loop).
  const features = useAuthStore(
    (s) => (s.user?.tenant as unknown as { features?: Record<string, boolean> })?.features,
  );
  const businessType = useAuthStore(
    (s) => (s.user?.tenant as unknown as { business_type?: string })?.business_type,
  );
  const marketplaceEnabled = features?.marketplace ?? false;
  // Images on when the module is on OR the shop sells online (online listings
  // must show photos). Mirrors Tenant::imagesEnabled() on the server.
  const imagesEnabled = (features?.images ?? false) || marketplaceEnabled;

  const categories = useCategories();
  const itemTypesQ = useItemTypes();
  const businessTypesQ = useBusinessTypes();
  const collectionsQ = useCollections();
  const existing = useProduct(id);
  const { create, update } = useProductMutations();
  const images = useProductImages(id);
  const mutation = isEdit ? update : create;

  // Which item types this business may create (physical/food/medicine/service).
  const allowedTypes: ItemTypeCode[] =
    ((businessTypesQ.data ?? []).find((b) => b.code === businessType)?.item_types as ItemTypeCode[]) ??
    ["physical_product"];

  const [itemType, setItemType] = useState<ItemTypeCode>("physical_product");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [pluCode, setPluCode] = useState("");
  const [extraBarcodes, setExtraBarcodes] = useState<string[]>([]);
  const [units, setUnits] = useState<Array<{ name: string; factor: string; price: string; barcode: string }>>([]);
  const [comboRows, setComboRows] = useState<Array<{ component_product_id: string; quantity: string }>>([]);
  const [brand, setBrand] = useState("");
  const [genericName, setGenericName] = useState("");
  const [requiresRx, setRequiresRx] = useState(false);
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [soldBy, setSoldBy] = useState<"unit" | "weight">("unit");
  const [tiers, setTiers] = useState<Array<{ min_qty: string; price: string }>>([]);
  const [minOrderQty, setMinOrderQty] = useState("");
  const [stock, setStock] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [duration, setDuration] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [trackStock, setTrackStock] = useState(true);
  const [visibleOnline, setVisibleOnline] = useState(true);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [variants, setVariants] = useState<FormVariant[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const syncModifiers = useSyncModifiers(id);

  // Capability profile of the currently-selected item type.
  const typeInfo = (itemTypesQ.data ?? []).find((t) => t.code === itemType);
  const isService = itemType === "service";
  const isCombo = itemType === "deal";
  const canTrackStock = typeInfo ? typeInfo.inventory !== "never" : !isService;
  const showVariants = typeInfo ? typeInfo.variants !== false : !isService;
  const supportsModifiers = !!typeInfo?.modifiers; // food items
  const isFood = itemType === "food_item";

  // Products this deal can bundle — everything sellable except other deals and
  // the deal itself. Fetched only while editing a combo.
  const comboPickerQ = useProducts({ search: undefined, page: 1 });
  const pickable = (comboPickerQ.data?.data ?? []).filter((p) => p.item_type !== "deal" && p.id !== id);
  // When switching type on create, reset the stock-tracking default sensibly.
  useEffect(() => {
    if (!isEdit && typeInfo) setTrackStock(typeInfo.inventory === "required");
  }, [itemType, typeInfo, isEdit]);
  // Default the item type to the first the business supports (create only).
  useEffect(() => {
    if (!isEdit && allowedTypes.length && !allowedTypes.includes(itemType)) {
      setItemType(allowedTypes[0]);
    }
  }, [allowedTypes, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  // On create there's no product id yet, so photos are staged in-memory and
  // uploaded right after the item is created.
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [uploadingNew, setUploadingNew] = useState(false);

  // Hydrate the form when editing.
  useEffect(() => {
    if (existing.data) {
      const p = existing.data;
      setItemType(p.item_type);
      setName(p.name);
      setDescription(p.description ?? "");
      setCategoryId(p.category_id ?? "");
      setSku(p.sku ?? "");
      setBarcode(p.barcode ?? "");
      setPluCode(p.plu_code ?? "");
      setBrand(p.brand ?? "");
      setGenericName(p.generic_name ?? "");
      setRequiresRx(p.requires_prescription ?? false);
      setExtraBarcodes((p.barcodes ?? []).map((b) => b.barcode));
      setUnits((p.units ?? []).map((u) => ({ name: u.name, factor: String(u.factor), price: u.price != null ? String(u.price) : "", barcode: u.barcode ?? "" })));
      setComboRows((p.combo_items ?? []).map((c) => ({ component_product_id: c.component_product_id, quantity: String(c.quantity) })));
      setUnit(p.unit ?? "");
      setPrice(String(p.price));
      setCost(p.cost != null ? String(p.cost) : "");
      setSalePrice(p.discount_price != null ? String(p.discount_price) : "");
      setWholesalePrice(p.wholesale_price != null ? String(p.wholesale_price) : "");
      setSoldBy(p.sold_by ?? "unit");
      setTiers((p.price_tiers ?? []).map((t) => ({ min_qty: String(t.min_qty), price: String(t.price) })));
      setMinOrderQty(p.min_order_qty != null ? String(p.min_order_qty) : "");
      setStock(String(p.stock_quantity));
      setLowStockThreshold(p.low_stock_threshold != null ? String(p.low_stock_threshold) : "");
      setDuration(p.duration_minutes != null ? String(p.duration_minutes) : "");
      setAvailableFrom(p.available_from ? p.available_from.slice(0, 5) : "");
      setAvailableUntil(p.available_until ? p.available_until.slice(0, 5) : "");
      setTrackStock(p.track_inventory);
      setVisibleOnline(p.visible_in_marketplace);
      setCollectionIds((p.collections ?? []).map((c) => c.id));
      setModifierGroups(
        (p.modifier_groups ?? []).map((g) => ({
          name: g.name, type: g.type, min_select: g.min_select, max_select: g.max_select,
          options: g.options.map((o) => ({ name: o.name, price_delta: o.price_delta })),
        })),
      );
    }
  }, [existing.data]);

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.errors : {};
  const generalError =
    mutation.error instanceof ApiError && Object.keys(fieldErrors).length === 0
      ? mutation.error.message
      : null;

  const err = (key: string) => fieldErrors[key]?.[0];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;

    const base = {
      name: name.trim(),
      description: description.trim() || undefined,
      category_id: categoryId || null,
      sku: sku.trim() || undefined,
      barcode: barcode.trim() || undefined,
      plu_code: isService || soldBy !== "weight" ? null : pluCode.trim() || null,
      brand: brand.trim() || undefined,
      generic_name: genericName.trim() || undefined,
      requires_prescription: itemType === "medicine" ? requiresRx : undefined,
      barcodes: isService ? undefined : extraBarcodes.map((b) => b.trim()).filter(Boolean),
      units: isService || isCombo ? undefined : units
        .filter((u) => u.name.trim() && Number(u.factor) > 0)
        .map((u) => ({ name: u.name.trim(), factor: Number(u.factor), price: u.price ? Number(u.price) : null, barcode: u.barcode.trim() || null })),
      combo_items: isCombo
        ? comboRows.filter((r) => r.component_product_id && Number(r.quantity) > 0)
            .map((r) => ({ component_product_id: r.component_product_id, quantity: Number(r.quantity) }))
        : undefined,
      unit: unit.trim() || undefined,
      price: price,
      cost: cost || undefined,
      discount_price: salePrice || null,
      wholesale_price: isService ? null : wholesalePrice || null,
      sold_by: isService ? undefined : soldBy,
      price_tiers: isService ? undefined : tiers.filter((t) => Number(t.min_qty) > 0 && Number(t.price) > 0),
      min_order_qty: isService ? undefined : minOrderQty ? Number(minOrderQty) : null,
      low_stock_threshold: canTrackStock && trackStock && lowStockThreshold ? Number(lowStockThreshold) : undefined,
      visible_in_marketplace: visibleOnline,
      collection_ids: collectionIds,
      ...(isFood ? { available_from: availableFrom || null, available_until: availableUntil || null } : {}),
    };

    const finish = (w: string[]) => {
      if (w.length > 0) {
        // Below-cost etc: show the warning, stay on page briefly via list.
        setWarnings(w);
        setTimeout(() => navigate("/tenant/products"), 1600);
      } else {
        navigate("/tenant/products");
      }
    };

    const warningsOf = (res: { meta: ApiMeta }) =>
      (res.meta?.warnings as string[] | undefined) ?? [];

    if (isEdit) {
      update.mutate(
        { id: id!, ...base, duration_minutes: duration ? Number(duration) : undefined },
        { onSuccess: (res) => finish(warningsOf(res)) },
      );
    } else {
      create.mutate(
        {
          ...base,
          item_type: itemType,
          ...(canTrackStock
            ? {
                track_inventory: trackStock,
                stock_quantity: trackStock ? Number(stock) || 0 : 0,
              }
            : {}),
          ...(isService ? { duration_minutes: duration ? Number(duration) : undefined } : {}),
          ...(showVariants && variants.length
            ? {
                variants: variants.map(({ _key, ...v }) => ({
                  ...v,
                  sku: v.sku || undefined,
                  cost: v.cost || undefined,
                })),
              }
            : {}),
        },
        {
          onSuccess: async (res) => {
            const newId = res.data?.id;
            // Upload the staged photos to the freshly-created item, then leave.
            if (newId && pendingImages.length > 0) {
              setUploadingNew(true);
              try {
                await catalogService.uploadImages(newId, pendingImages);
              } catch {
                // The item was created; photos just didn't attach — say so.
                finish([...warningsOf(res), "Item created, but photos failed to upload. Add them from Edit."]);
                return;
              } finally {
                setUploadingNew(false);
              }
            }
            finish(warningsOf(res));
          },
        },
      );
    }
  };

  if (!hasPermission("products.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage items." />;
  }

  return (
    <>
      <PageMeta title={isEdit ? "Edit Item | ShopOS" : "New Item | ShopOS"} description="Catalog item" />

      <div className="mb-6">
        <Link to="/tenant/products" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← Back to items
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">
          {isEdit ? `Edit ${existing.data?.name ?? "item"}` : "Add Item"}
        </h2>
      </div>

      {generalError && (
        <div className="mb-5 max-w-2xl">
          <Alert variant="error" title="Couldn't save" message={generalError} />
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="mb-5 max-w-2xl">
          <Alert variant="warning" title="Saved with warning" message={w} />
        </div>
      ))}

      <form onSubmit={submit} className="max-w-2xl space-y-5">
        {/* Item type — chosen once at creation; immutable after */}
        {!isEdit ? (
          allowedTypes.length > 1 && (
            <div>
              <Label>Item type</Label>
              <div className="flex flex-wrap gap-3">
                {allowedTypes.map((code) => {
                  const info = (itemTypesQ.data ?? []).find((t) => t.code === code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setItemType(code)}
                      className={`rounded-lg border px-5 py-2.5 text-sm transition ${
                        itemType === code
                          ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                          : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
                      }`}
                    >
                      {info?.label ?? code}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          <div className="inline-block rounded-lg bg-gray-100 px-3 py-1 text-theme-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {typeInfo?.label ?? existing.data?.item_type}
          </div>
        )}

        <div>
          <Label>
            Name <span className="text-error-500">*</span>
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T-Shirt / Haircut" />
          {err("name") && <p className="mt-1 text-theme-xs text-error-500">{err("name")}</p>}
        </div>

        <div>
          <Label>Category</Label>
          <Select
            key={categories.data ? "loaded" : "loading"}
            defaultValue={categoryId}
            options={[
              { value: "", label: "No category" },
              ...(categories.data ?? []).flatMap((c) => [
                { value: c.id, label: c.name },
                ...(c.children ?? []).map((ch) => ({ value: ch.id, label: `— ${ch.name}` })),
              ]),
            ]}
            placeholder="No category"
            onChange={setCategoryId}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>
              Price <span className="text-error-500">*</span>
            </Label>
            <Input type="number" min="0" step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} />
            {err("price") && <p className="mt-1 text-theme-xs text-error-500">{err("price")}</p>}
          </div>
          {!isService && !isCombo && (
            <div>
              <Label>Cost</Label>
              <Input type="number" min="0" step={0.01} value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Sale price (optional)</Label>
            <Input type="number" min="0" step={0.01} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="Discounted price" />
            {salePrice && Number(salePrice) >= Number(price || 0) && (
              <p className="mt-1 text-theme-xs text-warning-500">Sale price should be below the regular price.</p>
            )}
          </div>
        </div>

        {/* Wholesale price — the "Wholesale" price level the cashier can pick
            per line at the POS. Leave blank for retail-only items. */}
        {!isService && !isCombo && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Wholesale price (optional)</Label>
              <Input type="number" min="0" step={0.01} value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} placeholder="Bulk / trade price" />
              {wholesalePrice && Number(wholesalePrice) >= Number(price || 0) && (
                <p className="mt-1 text-theme-xs text-warning-500">Wholesale should be below the retail price.</p>
              )}
              <p className="mt-1 text-theme-xs text-gray-400">Cashiers can switch a POS line to this rate via the price-level dropdown.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>SKU</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Unique code" />
            {err("sku") && <p className="mt-1 text-theme-xs text-error-500">{err("sku")}</p>}
          </div>
          {!isService && !isCombo && (
            <div>
              <Label>Sold by</Label>
              <Select
                key={soldBy}
                defaultValue={soldBy}
                options={[
                  { value: "unit", label: "Unit (whole numbers)" },
                  { value: "weight", label: "Weight / measure (allows 0.5, 1.25…)" },
                ]}
                placeholder="Sold by"
                onChange={(v) => setSoldBy(v as "unit" | "weight")}
              />
              <p className="mt-1 text-theme-xs text-gray-400">Weight lets you sell fractions — e.g. 1.5 kg sugar, 2.5 m cable.</p>
            </div>
          )}
          {!isService && !isCombo && soldBy === "weight" && (
            <div>
              <Label>Scale PLU code</Label>
              <Input value={pluCode} onChange={(e) => setPluCode(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 21" />
              {err("plu_code") && <p className="mt-1 text-theme-xs text-error-500">{err("plu_code")}</p>}
              <p className="mt-1 text-theme-xs text-gray-400">The number programmed into your weighing scale for this item. Scanning the scale's printed label rings it up at the weighed amount. (Enable scale barcodes in Settings.)</p>
            </div>
          )}
        </div>

        {/* Barcode / brand / unit — physical goods & food */}
        {!isService && !isCombo && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Barcode</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" />
              {err("barcode") && <p className="mt-1 text-theme-xs text-error-500">{err("barcode")}</p>}
            </div>
            <div>
              <Label>Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Nestlé" />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, kg, box…" />
            </div>
          </div>
        )}

        {/* Salt / generic name + prescription flag — pharmacy specifics. */}
        {itemType === "medicine" && (
          <div className="space-y-3">
            <div>
              <Label>Salt / generic name</Label>
              <Input
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="e.g. Paracetamol 500mg"
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                Buyers can find this medicine by its salt as well as its brand name.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={requiresRx}
                onChange={(e) => setRequiresRx(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              Requires a doctor's prescription (℞) — staff are warned at the counter
            </label>
          </div>
        )}

        {/* Extra barcodes — a product can carry several (supplier packs, old
            + new labels). All of them resolve at the POS. */}
        {!isService && !isCombo && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Additional barcodes</p>
              <button
                type="button"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600"
                onClick={() => setExtraBarcodes((b) => [...b, ""])}
              >
                + Add barcode
              </button>
            </div>
            <p className="mb-3 text-theme-xs text-gray-400">Beyond the primary barcode above — e.g. a different supplier's pack of the same item.</p>
            {extraBarcodes.length === 0 ? (
              <p className="text-theme-xs text-gray-400">None yet.</p>
            ) : (
              extraBarcodes.map((code, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <Input
                    value={code}
                    onChange={(e) => setExtraBarcodes((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder="Scan or type"
                  />
                  <button
                    type="button"
                    className="text-error-500 hover:text-error-600"
                    onClick={() => setExtraBarcodes((arr) => arr.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pack sizes (pack-breaking) — sell the same stock as loose units,
            strips, or boxes. Stock is counted in the base unit above. */}
        {!isService && !isCombo && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Pack sizes</p>
              <button
                type="button"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600"
                onClick={() => setUnits((u) => [...u, { name: "", factor: "", price: "", barcode: "" }])}
              >
                + Add pack
              </button>
            </div>
            <p className="mb-3 text-theme-xs text-gray-400">
              Sell this item in bigger packs while stock stays counted in <span className="font-medium">{unit.trim() || "the base unit"}</span> (set “Unit” above, e.g. tablet). A pharmacy can sell a Strip (=10 tablets) or Box (=100). Leave price blank to use base price × pack size.
            </p>
            {units.length === 0 ? (
              <p className="text-theme-xs text-gray-400">None — sold only in the base unit.</p>
            ) : (
              units.map((u, i) => (
                <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                  <Input value={u.name} onChange={(e) => setUnits((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Pack name (Strip)" className="max-w-40" />
                  <span className="text-theme-xs text-gray-400">=</span>
                  <Input type="number" min="0" step={0.001} value={u.factor} onChange={(e) => setUnits((arr) => arr.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} placeholder="10" className="max-w-24" />
                  <span className="text-theme-xs text-gray-400">{unit.trim() || "base"}(s)</span>
                  <Input type="number" min="0" step={0.01} value={u.price} onChange={(e) => setUnits((arr) => arr.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder="price (optional)" className="max-w-32" />
                  <Input value={u.barcode} onChange={(e) => setUnits((arr) => arr.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} placeholder="pack barcode (optional)" className="max-w-40" />
                  <button type="button" className="text-error-500 hover:text-error-600" onClick={() => setUnits((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))
            )}
            {err("units") && <p className="mt-1 text-theme-xs text-error-500">{err("units")}</p>}
          </div>
        )}

        {/* Bundle contents (combo/deal) — the products this deal is made of.
            Selling the deal draws each component's stock down. */}
        {isCombo && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Bundle contents <span className="text-error-500">*</span></p>
              <button
                type="button"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600"
                onClick={() => setComboRows((r) => [...r, { component_product_id: "", quantity: "1" }])}
              >
                + Add item
              </button>
            </div>
            <p className="mb-3 text-theme-xs text-gray-400">
              The deal sells at the <span className="font-medium">Price</span> above; picking it at the POS deducts stock for each item below. E.g. Burger ×1, Fries ×1, Drink ×1.
            </p>
            {comboRows.length === 0 ? (
              <p className="text-theme-xs text-gray-400">No items yet — add at least one.</p>
            ) : (
              comboRows.map((row, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <select
                    value={row.component_product_id}
                    onChange={(e) => setComboRows((arr) => arr.map((x, j) => (j === i ? { ...x, component_product_id: e.target.value } : x)))}
                    className="h-11 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                  >
                    <option value="">Select a product…</option>
                    {pickable.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <span className="text-theme-xs text-gray-400">×</span>
                  <Input type="number" min="0" step={0.001} value={row.quantity} onChange={(e) => setComboRows((arr) => arr.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="max-w-24" />
                  <button type="button" className="text-error-500 hover:text-error-600" onClick={() => setComboRows((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))
            )}
            {comboPickerQ.data && pickable.length === 0 && (
              <p className="mt-1 text-theme-xs text-warning-500">Create some products first — a deal bundles existing items.</p>
            )}
            {err("combo_items") && <p className="mt-1 text-theme-xs text-error-500">{err("combo_items")}</p>}
          </div>
        )}

        {/* Wholesale / bulk pricing — quantity breaks + minimum order */}
        {!isService && !isCombo && (businessType === "wholesale" || tiers.length > 0) && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Bulk pricing (quantity breaks)</p>
              <button
                type="button"
                className="text-theme-xs font-medium text-brand-500 hover:text-brand-600"
                onClick={() => setTiers((t) => [...t, { min_qty: "", price: "" }])}
              >
                + Add tier
              </button>
            </div>
            <p className="mb-3 text-theme-xs text-gray-400">Buy more, pay less — e.g. 10+ at Rs 90, 50+ at Rs 80. The deepest tier the quantity reaches wins.</p>
            {tiers.map((t, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <span className="text-theme-xs text-gray-400">From qty</span>
                <Input type="number" min="0" step={0.001} value={t.min_qty} onChange={(e) => setTiers((arr) => arr.map((x, j) => (j === i ? { ...x, min_qty: e.target.value } : x)))} className="max-w-28" />
                <span className="text-theme-xs text-gray-400">price each</span>
                <Input type="number" min="0" step={0.01} value={t.price} onChange={(e) => setTiers((arr) => arr.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} className="max-w-28" />
                <button type="button" className="text-error-500 hover:text-error-600" onClick={() => setTiers((arr) => arr.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="mt-3 max-w-xs">
              <Label>Minimum order quantity (online)</Label>
              <Input type="number" min="0" step={0.001} value={minOrderQty} onChange={(e) => setMinOrderQty(e.target.value)} placeholder="e.g. 12" />
              <p className="mt-1 text-theme-xs text-gray-400">Online orders below this quantity are rejected. POS is not restricted.</p>
            </div>
          </div>
        )}

        {canTrackStock ? (
          <>
            <Toggle
              checked={trackStock}
              onChange={setTrackStock}
              title="Track stock for this item"
              hint="Turn off for made-to-order items like food — they're always available and never run out."
            />
            {trackStock && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Opening stock {isEdit && "(via inventory)"}</Label>
                  <Input
                    type="number"
                    min="0"
                    step={soldBy === "weight" ? 0.001 : 1}
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    disabled={isEdit}
                  />
                  {isEdit && (
                    <p className="mt-1 text-theme-xs text-gray-400">
                      Stock changes go through inventory adjustments.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Low-stock alert at</Label>
                  <Input
                    type="number"
                    min="0"
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                    placeholder="e.g. 5"
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="max-w-xs">
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 30"
            />
          </div>
        )}

        <div>
          <Label>Description</Label>
          <TextArea value={description} onChange={setDescription} rows={3} placeholder="Optional details" />
        </div>

        {/* Online visibility — only when this tenant sells online */}
        {marketplaceEnabled && (
          <Toggle
            checked={visibleOnline}
            onChange={setVisibleOnline}
            title="Sell this item online"
            hint="When on, customers can see and order this item in your online shop. Turn off to keep it in-store only."
          />
        )}

        {/* Collections — attach to display sections (Popular, Deals…) */}
        {(collectionsQ.data ?? []).length > 0 && (
          <div>
            <Label>Collections</Label>
            <div className="flex flex-wrap gap-2">
              {(collectionsQ.data ?? []).map((c) => {
                const on = collectionIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setCollectionIds((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                    }
                    className={`rounded-full border px-3 py-1.5 text-theme-xs transition ${
                      on
                        ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                        : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {on ? "✓ " : ""}{c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Photos — only when the shop uses product images (module on, or it
            sells online). Keeps the form neat for walk-in-only shops. */}
        {imagesEnabled && (
        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <Label>Photos</Label>
            <label className="cursor-pointer rounded-lg border border-brand-500 px-3 py-1.5 text-theme-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
              {images.upload.isPending ? "Uploading…" : "+ Add photos"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                disabled={images.upload.isPending}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) {
                    if (isEdit) {
                      images.upload.mutate(files);
                    } else {
                      // Stage locally; cap at 8 to match the backend.
                      setPendingImages((prev) => [...prev, ...files].slice(0, 8));
                    }
                  }
                  e.target.value = ""; // allow re-selecting the same file
                }}
              />
            </label>
          </div>

          {isEdit && images.upload.error instanceof ApiError && (
            <p className="mb-2 text-theme-xs text-error-500">
              {images.upload.error.errors["images.0"]?.[0] ?? images.upload.error.message}
            </p>
          )}

          {isEdit ? (
            existing.data?.images.length ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {existing.data.images.map((img) => (
                  <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                    <img src={img.url ?? ""} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => images.remove.mutate(img.id)}
                      disabled={images.remove.isPending}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
                      aria-label="Remove photo"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-theme-xs text-gray-400">
                No photos yet. Add up to 8 — the first one is used as the cover in your shop.
              </p>
            )
          ) : pendingImages.length ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {pendingImages.map((file, i) => (
                <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                  <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-theme-xs text-gray-400">
              Add up to 8 photos — they'll be attached when you create the item. The first one is the cover.
            </p>
          )}
        </div>
        )}

        {/* Available hours — food menu items */}
        {isFood && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <Label>Available hours (optional)</Label>
            <div className="flex items-center gap-3">
              <Input type="time" value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} />
              <span className="text-sm text-gray-400">to</span>
              <Input type="time" value={availableUntil} onChange={(e) => setAvailableUntil(e.target.value)} />
            </div>
            <p className="mt-1 text-theme-xs text-gray-400">Leave empty to sell all day. Set a window for breakfast/lunch menus.</p>
          </div>
        )}

        {/* Modifiers & add-ons — food items, edit only (needs a saved item) */}
        {supportsModifiers && isEdit && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <Label>Modifiers & add-ons</Label>
                <p className="text-theme-xs text-gray-400">Choices (crust, size) and paid extras (toppings, drinks).</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setModifierGroups((g) => [...g, { name: "", type: "modifier", min_select: 0, max_select: 1, options: [{ name: "", price_delta: 0 }] }])
                }
              >
                + Group
              </Button>
            </div>

            {modifierGroups.length === 0 && <p className="text-theme-xs text-gray-400">No modifier groups yet.</p>}

            <div className="space-y-4">
              {modifierGroups.map((g, gi) => {
                const patch = (p: Partial<ModifierGroup>) => setModifierGroups((list) => list.map((x, i) => (i === gi ? { ...x, ...p } : x)));
                const patchOpt = (oi: number, p: Partial<{ name: string; price_delta: number | string }>) =>
                  patch({ options: g.options.map((o, i) => (i === oi ? { ...o, ...p } : o)) });
                return (
                  <div key={gi} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                    <div className="mb-2 grid grid-cols-12 items-center gap-2">
                      <div className="col-span-5"><Input placeholder="Group name e.g. Crust" value={g.name} onChange={(e) => patch({ name: e.target.value })} /></div>
                      <select
                        className="col-span-3 h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        value={g.type}
                        onChange={(e) => patch({ type: e.target.value as ModifierGroup["type"] })}
                      >
                        <option value="modifier">Choice</option>
                        <option value="addon">Add-on</option>
                      </select>
                      <div className="col-span-2"><Input type="number" min="0" value={String(g.min_select)} onChange={(e) => patch({ min_select: Number(e.target.value) })} /></div>
                      <div className="col-span-1"><Input type="number" min="0" value={String(g.max_select)} onChange={(e) => patch({ max_select: Number(e.target.value) })} /></div>
                      <button type="button" className="col-span-1 text-error-500" onClick={() => setModifierGroups((list) => list.filter((_, i) => i !== gi))}>✕</button>
                      <p className="col-span-12 text-theme-xs text-gray-400">min / max selectable ({g.min_select > 0 ? "required" : "optional"})</p>
                    </div>
                    {g.options.map((o, oi) => (
                      <div key={oi} className="mb-1 grid grid-cols-12 items-center gap-2 pl-3">
                        <div className="col-span-7"><Input placeholder="Option e.g. Stuffed" value={o.name} onChange={(e) => patchOpt(oi, { name: e.target.value })} /></div>
                        <div className="col-span-4"><Input type="number" min="0" placeholder="+ price" value={String(o.price_delta)} onChange={(e) => patchOpt(oi, { price_delta: e.target.value })} /></div>
                        <button type="button" className="col-span-1 text-error-500" onClick={() => patch({ options: g.options.filter((_, i) => i !== oi) })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="ml-3 mt-1 text-theme-xs text-brand-500" onClick={() => patch({ options: [...g.options, { name: "", price_delta: 0 }] })}>+ Option</button>
                  </div>
                );
              })}
            </div>

            {syncModifiers.error instanceof ApiError && (
              <p className="mt-2 text-theme-xs text-error-500">{syncModifiers.error.firstFieldError() ?? syncModifiers.error.message}</p>
            )}
            <div className="mt-3">
              <Button
                size="sm"
                onClick={() =>
                  syncModifiers.mutate(
                    modifierGroups
                      .filter((g) => g.name.trim() && g.options.some((o) => o.name.trim()))
                      .map((g) => ({ ...g, options: g.options.filter((o) => o.name.trim()).map((o) => ({ ...o, price_delta: Number(o.price_delta) || 0 })) })),
                  )
                }
                disabled={syncModifiers.isPending}
              >
                {syncModifiers.isPending ? "Saving…" : syncModifiers.isSuccess ? "Saved ✓" : "Save modifiers"}
              </Button>
            </div>
          </div>
        )}

        {/* Variants — products, creation only (variant editing lands with inventory UI) */}
        {showVariants && !isEdit && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <Label>Variants (optional)</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setVariants((v) => [...v, { _key: nextKey(), name: "", price: "", stock_quantity: 0 }])
                }
              >
                + Add variant
              </Button>
            </div>
            {variants.length === 0 && (
              <p className="text-theme-xs text-gray-400">
                e.g. sizes or colors — each with its own SKU, price and stock.
              </p>
            )}
            {variants.map((v, i) => (
              <div key={v._key} className="mb-2 grid grid-cols-12 items-center gap-2">
                <div className="col-span-4">
                  <Input
                    placeholder="Name e.g. Red / L"
                    value={v.name}
                    onChange={(e) =>
                      setVariants((list) => list.map((x) => (x._key === v._key ? { ...x, name: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    placeholder="SKU"
                    value={v.sku ?? ""}
                    onChange={(e) =>
                      setVariants((list) => list.map((x) => (x._key === v._key ? { ...x, sku: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    placeholder="Price"
                    value={String(v.price)}
                    onChange={(e) =>
                      setVariants((list) => list.map((x) => (x._key === v._key ? { ...x, price: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    placeholder="Stock"
                    value={String(v.stock_quantity ?? 0)}
                    onChange={(e) =>
                      setVariants((list) =>
                        list.map((x) => (x._key === v._key ? { ...x, stock_quantity: Number(e.target.value) } : x)),
                      )
                    }
                  />
                </div>
                <button
                  type="button"
                  className="col-span-1 text-error-500"
                  onClick={() => setVariants((list) => list.filter((x) => x._key !== v._key))}
                >
                  ✕
                </button>
                {err(`variants.${i}.name`) && (
                  <p className="col-span-12 text-theme-xs text-error-500">{err(`variants.${i}.name`)}</p>
                )}
                {err(`variants.${i}.sku`) && (
                  <p className="col-span-12 text-theme-xs text-error-500">{err(`variants.${i}.sku`)}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Button size="sm" disabled={mutation.isPending || uploadingNew || !name.trim() || !price}>
            {uploadingNew
              ? "Uploading photos…"
              : mutation.isPending
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Create item"}
          </Button>
          <Link to="/tenant/products">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </>
  );
}
