import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Select from "../../../components/form/Select";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError, type ApiMeta } from "../../../common/types/api";
import { SERIAL_TRADES, usePrimaryBusinessType } from "../../../common/tenant/businessType";
import { useAuthStore } from "../../../stores/authStore";
import {
  useCategories,
  useCollections,
  useItemTypes,
  useProduct,
  usePickableProducts,
  useProductImages,
  useProductMutations,
  useSyncModifiers,
} from "../hooks/useCatalog";
import { useBusinessTypes, useShopSettings } from "../../shop/hooks/useShop";
import { useTaxGroups } from "../hooks/useTaxGroups";
import { catalogService } from "../services/catalogService";
import type { ItemTypeCode, ModifierGroup, VariantInput } from "../types";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

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

/** A titled card used to group a section of the form. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-3">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
        {hint && <p className="mt-0.5 text-theme-xs text-gray-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Create/edit a catalog item. The form adapts on two axes so a shop only sees
 * fields that apply to it:
 *   1. Item type   — food / medicine / service / product / deal (capabilities).
 *   2. Plan + modules — POS vs online-only (features.pos), inventory tracking
 *      (features.inventory), online storefront (features.marketplace/images).
 * Counter/scanner fields (barcode, packs, scale PLU, wholesale price) only
 * appear for POS shops, tucked inside a collapsed "Advanced" panel. An
 * online-only shop sees a short, storefront-focused form.
 */
/**
 * Product create/edit — a slide-over drawer hosted over the item list, with
 * the form split into tabs so it reads cleanly instead of one long scroll.
 * `id` present ⇒ edit; absent ⇒ create. `onClose` returns to the list.
 */
export default function ProductEditor({ id, onClose }: { id?: string; onClose: () => void }) {
  const isEdit = !!id;

  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Select STABLE references — never build a new object in the selector
  // (a fresh `?? {}` each render triggers an infinite re-render loop).
  const features = useAuthStore(
    (s) => (s.user?.tenant as unknown as { features?: Record<string, boolean> })?.features,
  );
  // Select the array itself, not a derived object — a fresh `?? []` in the
  // selector re-renders forever.
  const tenantItemTypes = useAuthStore((s) => s.user?.tenant?.item_types);
  // Resolved, so an older `clinic` still gets the medicine fields its current
  // type (pharmacy) is entitled to.
  const businessType = usePrimaryBusinessType();
  const marketplaceEnabled = features?.marketplace ?? false;
  // The in-shop till: an online-only plan has POS off, so it never needs the
  // counter/scanner fields (barcode, packs, scale PLU, wholesale price level).
  const posEnabled = features?.pos ?? false;
  // Stock tracking is a module (business-type driven): restaurants/salons run
  // without it; retail/grocery/pharmacy with it.
  const inventoryEnabled = features?.inventory ?? false;
  // Images on when the module is on OR the shop sells online (online listings
  // must show photos). Mirrors Tenant::imagesEnabled() on the server.
  const imagesEnabled = (features?.images ?? false) || marketplaceEnabled;

  const categories = useCategories();
  const taxGroups = useTaxGroups();
  const itemTypesQ = useItemTypes();
  const businessTypesQ = useBusinessTypes();
  const collectionsQ = useCollections();
  const existing = useProduct(id);
  const { create, update } = useProductMutations();
  const images = useProductImages(id);
  const mutation = isEdit ? update : create;

  // Which item types THIS shop may create (physical/food/medicine/service).
  //
  // Read off the tenant, not the /business-types catalogue. That catalogue
  // describes each type as shipped and knows nothing about a per-tenant module
  // grant — so a salon given the products module was shown "Service" only,
  // while a books-only tenant given the catalog was shown nothing at all and
  // could not save whatever it picked. The server computes this from the same
  // trade + module map it validates against, so the two can't drift.
  const allowedTypes: ItemTypeCode[] =
    (tenantItemTypes as ItemTypeCode[] | undefined) ?? ["physical_product"];

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
  const [recipeRows, setRecipeRows] = useState<Array<{ ingredient_product_id: string; quantity: string }>>([]);
  /** What one portion costs to make, as the server computed it on load. */
  const [recipeCost, setRecipeCost] = useState<number | null>(null);
  const [recipeMissing, setRecipeMissing] = useState<string[]>([]);
  const [brand, setBrand] = useState("");
  const [genericName, setGenericName] = useState("");
  const [strength, setStrength] = useState("");
  const [dosageForm, setDosageForm] = useState("");
  const [requiresRx, setRequiresRx] = useState(false);
  // The regulator's schedule. Setting it makes the till demand the
  // prescription details before this drug can be dispensed at all.
  const [drugSchedule, setDrugSchedule] = useState("");
  const [kitchenStation, setKitchenStation] = useState("");
  const shopSettings = useShopSettings();
  // Serialized retail (phones/electronics): capture a serial/IMEI per unit at
  // the till, with a default warranty length.
  const [trackSerial, setTrackSerial] = useState(false);
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [taxGroupId, setTaxGroupId] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [soldBy, setSoldBy] = useState<"unit" | "weight">("unit");
  const [tiers, setTiers] = useState<Array<{ min_qty: string; price: string }>>([]);
  const [minOrderQty, setMinOrderQty] = useState("");
  const [stock, setStock] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  // Opening-lot expiry + batch number — for a medicine created with opening stock.
  const [expiryDate, setExpiryDate] = useState("");
  const [openingBatch, setOpeningBatch] = useState("");
  const [duration, setDuration] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [trackStock, setTrackStock] = useState(true);
  // Whether the shop still sells this at all. Distinct from `visibleOnline`,
  // which only hides it from the storefront — an inactive item is off the till
  // too. Without this the only way to stop selling something was to DELETE it,
  // which takes its sales history's link with it.
  const [isActive, setIsActive] = useState(true);
  const [visibleOnline, setVisibleOnline] = useState(true);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [variants, setVariants] = useState<FormVariant[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<"details" | "media" | "options" | "advanced">("details");
  const syncModifiers = useSyncModifiers(id);

  // Capability profile of the currently-selected item type.
  const typeInfo = (itemTypesQ.data ?? []).find((t) => t.code === itemType);
  const isService = itemType === "service";
  const isCombo = itemType === "deal";
  const isMedicine = itemType === "medicine";
  const isFood = itemType === "food_item";
  // Offered from the shop's OWN station list rather than typed free-hand: a
  // station that does not exist routes the ticket nowhere, and the failure only
  // shows up at dinner service.
  const stations = (shopSettings.data?.kitchen_stations ?? []) as string[];
  const isPhysical = itemType === "physical_product";
  const canTrackStock = typeInfo ? typeInfo.inventory !== "never" : !isService;
  const showVariants = typeInfo ? typeInfo.variants !== false : !isService;
  const supportsModifiers = !!typeInfo?.modifiers; // food items
  // Stock is only managed when the item type allows it AND the shop runs the
  // inventory module. Otherwise no stock UI (and none sent on save).
  const stockManaged = canTrackStock && inventoryEnabled;
  // A plain sellable good (has SKU/brand/packs/barcodes); not a service or deal.
  const isGood = !isService && !isCombo;

  // A new medicine with opening stock (product- or variant-level) must carry an
  // opening-lot expiry — mirror the server rule so we block save with a hint
  // instead of surfacing a raw 422.
  const needsExpiry =
    isMedicine && !isEdit && !expiryDate &&
    (Number(stock) > 0 || variants.some((v) => Number(v.stock_quantity ?? 0) > 0));

  // Business Type Engine: the shop's type suggests its selling units and
  // variant attributes (pharmacy → Strip/Strength, diner → Plate/Size…).
  const typeCfg = (businessTypesQ.data ?? []).find((b) => b.code === businessType);
  const typeUnits = typeCfg?.units ?? [];
  const variantAttrs = typeCfg?.variant_attributes ?? [];
  // Online-required: a marketplace-visible item on an online shop must carry
  // a description + photo before it reads well to customers.
  const onlineRequired = visibleOnline && marketplaceEnabled;

  // Products this deal can bundle, or this dish consumes — everything sellable
  // except other deals and the item itself.
  //
  // This used to be `useProducts({ page: 1 })`, which is the endpoint's default
  // page of FIFTEEN. The picker is a plain <select> with no search and no pager,
  // so fifteen was the entire choice: a recipe could name fifteen possible
  // ingredients and a deal could bundle fifteen products, with nothing on screen
  // saying a catalogue of four hundred existed. See usePickableProducts.
  //
  // And the comment above it used to claim it was "fetched only while editing a
  // combo" while the call ran on every product form. Now that is true.
  const needsPicker = isCombo || (isFood && inventoryEnabled);
  const comboPickerQ = usePickableProducts(needsPicker);
  const pickable = (comboPickerQ.data?.rows ?? []).filter((p) => p.item_type !== "deal" && p.id !== id);
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
      setStrength(p.strength ?? "");
      setDosageForm(p.dosage_form ?? "");
      setRequiresRx(p.requires_prescription ?? false);
      setDrugSchedule(p.drug_schedule ?? "");
      setKitchenStation(p.kitchen_station ?? "");
      setTrackSerial(p.tracks_serial ?? false);
      setWarrantyMonths(p.warranty_months != null ? String(p.warranty_months) : "");
      setExtraBarcodes((p.barcodes ?? []).map((b) => b.barcode));
      setUnits((p.units ?? []).map((u) => ({ name: u.name, factor: String(u.factor), price: u.price != null ? String(u.price) : "", barcode: u.barcode ?? "" })));
      setComboRows((p.combo_items ?? []).map((c) => ({ component_product_id: c.component_product_id, quantity: String(c.quantity) })));
      setRecipeRows((p.recipe_items ?? []).map((r) => ({ ingredient_product_id: r.ingredient_product_id, quantity: String(r.quantity) })));
      // Computed server-side from the ingredients' own costs — never here. The
      // browser holds no cost prices (see HidesCostPrice), and a figure the
      // panel worked out itself would be a second answer to a question the
      // server already answers for every report.
      setRecipeCost(p.recipe_cost ?? null);
      setRecipeMissing(p.recipe_cost_missing ?? []);
      setUnit(p.unit ?? "");
      setPrice(String(p.price));
      setCost(p.cost != null ? String(p.cost) : "");
      setSalePrice(p.discount_price != null ? String(p.discount_price) : "");
      setWholesalePrice(p.wholesale_price != null ? String(p.wholesale_price) : "");
      setTaxGroupId(p.tax_group_id ?? "");
      setTaxRate(p.tax_rate != null ? String(p.tax_rate) : "");
      setSoldBy(p.sold_by ?? "unit");
      setTiers((p.price_tiers ?? []).map((t) => ({ min_qty: String(t.min_qty), price: String(t.price) })));
      setMinOrderQty(p.min_order_qty != null ? String(p.min_order_qty) : "");
      setStock(String(p.stock_quantity));
      setLowStockThreshold(p.low_stock_threshold != null ? String(p.low_stock_threshold) : "");
      setDuration(p.duration_minutes != null ? String(p.duration_minutes) : "");
      setAvailableFrom(p.available_from ? p.available_from.slice(0, 5) : "");
      setAvailableUntil(p.available_until ? p.available_until.slice(0, 5) : "");
      setTrackStock(p.track_inventory);
      setIsActive(p.is_active);
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

    // Online-required: an item shown to online customers needs a description.
    if (onlineRequired && !description.trim()) {
      setWarnings(["Add a description before saving an item that's shown online."]);
      return;
    }

    const base = {
      name: name.trim(),
      description: description.trim() || undefined,
      category_id: categoryId || null,
      sku: sku.trim() || undefined,
      // Counter/scanner data only when the shop runs a POS till.
      barcode: posEnabled ? barcode.trim() || undefined : undefined,
      plu_code: !posEnabled || isService || soldBy !== "weight" ? null : pluCode.trim() || null,
      brand: brand.trim() || undefined,
      generic_name: genericName.trim() || undefined,
      strength: isMedicine ? (strength.trim() || null) : undefined,
      dosage_form: isMedicine ? (dosageForm || null) : undefined,
      requires_prescription: isMedicine ? requiresRx : undefined,
      drug_schedule: isMedicine ? (drugSchedule.trim() || null) : undefined,
      kitchen_station: isFood ? (kitchenStation.trim() || null) : undefined,
      // Serialized retail — only physical goods carry a serial/IMEI + warranty.
      tracks_serial: isPhysical ? trackSerial : undefined,
      warranty_months: isPhysical && trackSerial && warrantyMonths ? Number(warrantyMonths) : isPhysical ? null : undefined,
      barcodes: posEnabled && isGood ? extraBarcodes.map((b) => b.trim()).filter(Boolean) : undefined,
      units: posEnabled && isGood ? units
        .filter((u) => u.name.trim() && Number(u.factor) > 0)
        .map((u) => ({ name: u.name.trim(), factor: Number(u.factor), price: u.price ? Number(u.price) : null, barcode: u.barcode.trim() || null })) : undefined,
      combo_items: isCombo
        ? comboRows.filter((r) => r.component_product_id && Number(r.quantity) > 0)
            .map((r) => ({ component_product_id: r.component_product_id, quantity: Number(r.quantity) }))
        : undefined,
      // Only when the recipe editor was on screen. Sending an empty list from
      // a form that never showed the section would silently wipe a recipe the
      // merchant still has — e.g. editing a dish's price after the Inventory
      // module was switched off.
      recipe_items: isFood && inventoryEnabled
        ? recipeRows.filter((r) => r.ingredient_product_id && Number(r.quantity) > 0)
            .map((r) => ({ ingredient_product_id: r.ingredient_product_id, quantity: Number(r.quantity) }))
        : undefined,
      unit: unit.trim() || undefined,
      price: price,
      cost: cost || undefined,
      discount_price: salePrice || null,
      wholesale_price: posEnabled && isGood ? wholesalePrice || null : null,
      // Tax: a group wins; else the product's own rate; else the shop default.
      tax_group_id: taxGroupId || null,
      tax_rate: taxGroupId ? null : (taxRate !== "" ? Number(taxRate) : null),
      sold_by: isGood ? soldBy : undefined,
      price_tiers: isGood ? tiers.filter((t) => Number(t.min_qty) > 0 && Number(t.price) > 0) : undefined,
      min_order_qty: isGood ? (minOrderQty ? Number(minOrderQty) : null) : undefined,
      low_stock_threshold: stockManaged && trackStock && lowStockThreshold ? Number(lowStockThreshold) : undefined,
      is_active: isActive,
      visible_in_marketplace: visibleOnline,
      collection_ids: collectionIds,
      ...(isFood ? { available_from: availableFrom || null, available_until: availableUntil || null } : {}),
    };

    const finish = (w: string[]) => {
      if (w.length > 0) {
        // Below-cost etc: surface the warning briefly, then close the drawer.
        setWarnings(w);
        setTimeout(onClose, 1600);
      } else {
        onClose();
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
          ...(stockManaged
            ? {
                track_inventory: trackStock,
                stock_quantity: trackStock ? Number(stock) || 0 : 0,
              }
            : {}),
          // Opening-lot expiry + batch number for a medicine (backend requires
          // the expiry when there's opening stock; both harmless otherwise).
          ...(isMedicine && expiryDate ? { expiry_date: expiryDate } : {}),
          ...(isMedicine && openingBatch.trim() ? { opening_batch_number: openingBatch.trim() } : {}),
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

  // Tabs shown depend on the item type + shop capabilities — hide empty ones.
  const tabs = [
    { key: "details", label: "Details" },
    ...(imagesEnabled || marketplaceEnabled || (collectionsQ.data ?? []).length
      ? [{ key: "media", label: "Media & online" }] : []),
    ...((showVariants && !isEdit) || (supportsModifiers && isEdit)
      ? [{ key: "options", label: "Variants & options" }] : []),
    ...(isGood || !isService ? [{ key: "advanced", label: "Codes & packs" }] : []),
  ] as const;
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "details";

  return (
    <div className="fixed inset-0 z-[100000] flex justify-end">
      <div className="absolute inset-0 bg-gray-900/30 dark:bg-black/50" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full max-w-3xl flex-col bg-white shadow-theme-lg dark:bg-gray-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <h2 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">
            {isEdit ? `Edit ${existing.data?.name ?? "item"}` : "Add item"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-4 dark:border-gray-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as typeof tab)}
              className={`relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {t.label}
              {activeTab === t.key && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />
              )}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {generalError && <Alert variant="error" title="Couldn't save" message={generalError} />}
            {warnings.map((w) => (
              <Alert key={w} variant="warning" title="Saved with warning" message={w} />
            ))}

            {/* ═══════════════ TAB: Details ═══════════════ */}
            <div className={activeTab === "details" ? "space-y-5" : "hidden"}>
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

        {/* ── Essentials ─────────────────────────────────────────────── */}
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
          <div>
            <Label>Sale price (optional)</Label>
            <Input type="number" min="0" step={0.01} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="Discounted price" />
            {salePrice && Number(salePrice) >= Number(price || 0) && (
              <p className="mt-1 text-theme-xs text-warning-500">Sale price should be below the regular price.</p>
            )}
          </div>
          {isGood && (
            <div>
              <Label>Cost (optional)</Label>
              <Input type="number" min="0" step={0.01} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="For profit reports" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Tax group (optional)</Label>
            <Select
              value={taxGroupId}
              options={[
                { value: "", label: "— Use own rate / shop default —" },
                ...((taxGroups.data ?? []).map((g) => ({ value: g.id, label: `${g.name} (${Number(g.rate)}%)` }))),
              ]}
              onChange={(v) => setTaxGroupId(v)}
            />
            <p className="mt-1 text-theme-xs text-gray-400">A reusable rate (managed in Settings → Tax). Overrides the rate below.</p>
          </div>
          {!taxGroupId && (
            <div>
              <Label>Tax rate % (optional)</Label>
              <Input type="number" min="0" max="100" step={0.01} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="Blank = shop default" />
            </div>
          )}
        </div>

        {/* Pharmacy specifics — salt/generic name + prescription flag. */}
        {isMedicine && (
          <Section title="Medicine details">
            <div className="space-y-3">
              <div>
                <Label>Salt / generic name</Label>
                <Input
                  value={genericName}
                  onChange={(e) => setGenericName(e.target.value)}
                  placeholder="e.g. Paracetamol 500mg"
                />
                <p className="mt-1 text-theme-xs text-gray-400">
                  Buyers can find this medicine by its salt as well as its brand name — and the till uses it to
                  offer an equivalent when this brand runs out.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Strength</Label>
                  <Input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 500mg" />
                </div>
                <div>
                  <Label>Dosage form</Label>
                  <Select
                    options={[
                      { value: "", label: "—" },
                      ...["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream / Ointment", "Inhaler", "Sachet", "Spray", "Gel", "Other"].map((f) => ({ value: f, label: f })),
                    ]}
                    value={dosageForm}
                    onChange={setDosageForm}
                  />
                </div>
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
              <div>
                <Label>Controlled schedule <span className="font-normal text-gray-400">(optional)</span></Label>
                <Input
                  className="max-w-[10rem]"
                  value={drugSchedule}
                  onChange={(e) => setDrugSchedule(e.target.value)}
                  placeholder="e.g. G"
                />
                <p className="mt-1 text-theme-xs text-gray-400">
                  Set this and the till will <strong>refuse to sell</strong> the drug until the prescription number
                  and prescriber are recorded — and every sale appears in the dispensing register.
                </p>
              </div>
            </div>
          </Section>
        )}

        {/* Serialized goods — capture a serial/IMEI per unit + warranty.
            The trades that sell a unit somebody later brings back under
            warranty: retail (phones, electronics) and the auto aftermarket
            (batteries above all — the most-claimed warranty item on a
            Pakistani forecourt, and one this section used to lock out
            entirely). A grocery or pharmacy never tracks a unit by serial. */}
        {isPhysical && SERIAL_TRADES.includes(businessType ?? "") && (
          <Section title="Serial & warranty">
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={trackSerial}
                  onChange={(e) => setTrackSerial(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Capture a serial / IMEI for each unit sold (phones, electronics, batteries)
              </label>
              {trackSerial && (
                <div>
                  <Label>Default warranty (months)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={warrantyMonths}
                    onChange={(e) => setWarrantyMonths(e.target.value)}
                    placeholder="e.g. 12"
                  />
                  <p className="mt-1 text-theme-xs text-gray-400">
                    Applied to each unit at the till (the cashier can override per sale). Leave blank for no warranty.
                  </p>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Bundle contents (combo/deal) — the products this deal is made of. */}
        {isCombo && (
          <Section
            title="Bundle contents *"
            hint="The deal sells at the Price above; picking it at the POS deducts stock for each item below. E.g. Burger ×1, Fries ×1, Drink ×1."
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className={ROW_ACTION}
                onClick={() => setComboRows((r) => [...r, { component_product_id: "", quantity: "1" }])}
              >
                + Add item
              </button>
            </div>
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
                  <button type="button" className={ROW_ACTION_DANGER} onClick={() => setComboRows((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))
            )}
            {comboPickerQ.data && pickable.length === 0 && (
              <p className="mt-1 text-theme-xs text-warning-500">Create some products first — a deal bundles existing items.</p>
            )}
            {/* No silent caps: the picker drains the catalogue, and if it ever
                could not, it says so rather than quietly offering a subset —
                which is the exact shape of the bug this replaced. */}
            {(comboPickerQ.data?.missing ?? 0) > 0 && (
              <p className="mt-1 text-theme-xs text-warning-500">
                Showing the first 1,000 items — about {comboPickerQ.data?.missing} more are not in this list.
              </p>
            )}
            {err("combo_items") && <p className="mt-1 text-theme-xs text-error-500">{err("combo_items")}</p>}
          </Section>
        )}

        {/* Recipe / ingredients (food dish) — raw items consumed per portion.
            A recipe does one thing: it deducts ingredients from stock. Without
            the Inventory module there is nothing to deduct from, so the shop
            is not offered a form that would save and then do nothing. */}
        {isFood && inventoryEnabled && (
          <Section
            title="Recipe / ingredients"
            hint="Optional. List the raw ingredients one portion uses — selling the dish deducts each from stock. The dish itself needn't track stock. E.g. Bun ×2, Patty ×1. An ingredient that isn't stock-tracked yet is switched on when you save."
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className={ROW_ACTION}
                onClick={() => setRecipeRows((r) => [...r, { ingredient_product_id: "", quantity: "1" }])}
              >
                + Add ingredient
              </button>
            </div>
            {recipeRows.length === 0 ? (
              <p className="text-theme-xs text-gray-400">No ingredients — the dish sells without depleting stock.</p>
            ) : (
              recipeRows.map((row, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <select
                    value={row.ingredient_product_id}
                    onChange={(e) => setRecipeRows((arr) => arr.map((x, j) => (j === i ? { ...x, ingredient_product_id: e.target.value } : x)))}
                    className="h-11 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                  >
                    <option value="">Select an ingredient…</option>
                    {pickable.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <span className="text-theme-xs text-gray-400">×</span>
                  <Input type="number" min="0" step={0.001} value={row.quantity} onChange={(e) => setRecipeRows((arr) => arr.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="max-w-24" />
                  <button type="button" className={ROW_ACTION_DANGER} onClick={() => setRecipeRows((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))
            )}
            {err("recipe_items") && <p className="mt-1 text-theme-xs text-error-500">{err("recipe_items")}</p>}

            {/* What it costs to make, beside what it sells for.
                
                This is the number a kitchen is actually run on, and every
                margin report on the platform used to take a dish's cost from a
                figure typed onto its record once — while the recipe below and
                the ingredients' own costs were sitting in the database. It is
                shown HERE because this is the screen where somebody decides
                what to charge. */}
            {recipeRows.length > 0 && <FoodCost cost={recipeCost} missing={recipeMissing} price={Number(price) || 0} />}
          </Section>
        )}

        {/* Food menu hours */}
        {isFood && (
          <Section
            title="Made at"
            hint="Which station cooks this. A fired order splits into one ticket per station, so the bar never gets the biryani. Leave empty for the single kitchen printer."
          >
            <Select
              className="max-w-xs"
              value={kitchenStation}
              options={[
                { value: "", label: "Default kitchen" },
                ...stations.map((st) => ({ value: st, label: st })),
              ]}
              placeholder="Default kitchen"
              onChange={setKitchenStation}
            />
            {stations.length === 0 && (
              <p className="mt-1 text-theme-xs text-gray-400">
                No stations set up yet — add them under Settings → Point of Sale → Kitchen.
              </p>
            )}
          </Section>
        )}

        {isFood && (
          <Section title="Available hours (optional)" hint="Leave empty to sell all day. Set a window for breakfast/lunch menus.">
            <div className="flex items-center gap-3">
              <Input type="time" value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} />
              <span className="text-sm text-gray-400">to</span>
              <Input type="time" value={availableUntil} onChange={(e) => setAvailableUntil(e.target.value)} />
            </div>
          </Section>
        )}

        {/* Stock (inventory module + trackable type) — else duration for services */}
        {isService ? (
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
        ) : stockManaged ? (
          <>
            <Toggle
              checked={trackStock}
              onChange={setTrackStock}
              title="Track stock for this item"
              hint="Turn off for made-to-order items — they're always available and never run out."
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
                {isMedicine && !isEdit && (
                  <>
                    <div>
                      <Label>Opening batch number</Label>
                      <Input value={openingBatch} onChange={(e) => setOpeningBatch(e.target.value)} placeholder="e.g. LOT-2026-01 (defaults to OPENING)" />
                    </div>
                    <div>
                      <Label>
                        Opening batch expiry{Number(stock) > 0 && <span className="text-error-500"> *</span>}
                      </Label>
                      <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                      <p className="mt-1 text-theme-xs text-gray-400">
                        Medicines need an expiry on their opening lot (refine per-lot later on the Batches screen).
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : null}

        <div>
          <Label>
            Description {onlineRequired && <span className="text-error-500">*</span>}
          </Label>
          <TextArea value={description} onChange={setDescription} rows={3} placeholder={onlineRequired ? "Shown to online customers — describe the item" : "Optional details"} />
          {onlineRequired && !description.trim() && (
            <p className="mt-1 text-theme-xs text-warning-500">
              A description is required for items shown online.
            </p>
          )}
          {err("description") && <p className="mt-1 text-theme-xs text-error-500">{err("description")}</p>}
        </div>
            </div>

            {/* ═══════════════ TAB: Media & online ═══════════════ */}
            <div className={activeTab === "media" ? "space-y-5" : "hidden"}>
        {/* Photos — when the shop uses product images (module on, or sells online) */}
        {imagesEnabled && (
        <Section title="Photos">
          <div className="mb-3 flex items-center justify-end">
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

          {onlineRequired && (!isEdit || !existing.data?.images.length) && (
            <p className="mb-2 text-theme-xs text-warning-500">
              Add at least one photo — items shown online need a picture{!isEdit ? " (you can add it right after saving)" : ""}.
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
        </Section>
        )}

        {/* Online storefront — visibility + collections (online shops only) */}
        {marketplaceEnabled && (
          <Toggle
            checked={visibleOnline}
            onChange={setVisibleOnline}
            title="Sell this item online"
            hint="When on, customers can see and order this item in your online shop. Turn off to keep it in-store only."
          />
        )}

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

            </div>

            {/* ═══════════════ TAB: Variants & options ═══════════════ */}
            <div className={activeTab === "options" ? "space-y-5" : "hidden"}>
        {/* Variants — products, creation only */}
        {showVariants && !isEdit && (
          <Section title="Variants (optional)" hint="e.g. sizes or colors — each with its own SKU, price and stock.">
            {variantAttrs.length > 0 && (
              <p className="mb-2 text-theme-xs text-gray-400">
                Common for your business: {variantAttrs.join(" · ")}
              </p>
            )}
            <div className="mb-2 flex justify-end">
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
                  className={`col-span-1 ${ROW_ACTION_DANGER}`}
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
          </Section>
        )}

        {/* Modifiers & add-ons — food items, edit only (needs a saved item) */}
        {supportsModifiers && isEdit && (
          <Section title="Modifiers & add-ons" hint="Choices (crust, size) and paid extras (toppings, drinks).">
            <div className="mb-3 flex justify-end">
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
                      <button type="button" className={`col-span-1 ${ROW_ACTION_DANGER}`} onClick={() => setModifierGroups((list) => list.filter((_, i) => i !== gi))}>✕</button>
                      <p className="col-span-12 text-theme-xs text-gray-400">min / max selectable ({g.min_select > 0 ? "required" : "optional"})</p>
                    </div>
                    {g.options.map((o, oi) => (
                      <div key={oi} className="mb-1 grid grid-cols-12 items-center gap-2 pl-3">
                        <div className="col-span-7"><Input placeholder="Option e.g. Stuffed" value={o.name} onChange={(e) => patchOpt(oi, { name: e.target.value })} /></div>
                        <div className="col-span-4"><Input type="number" min="0" placeholder="+ price" value={String(o.price_delta)} onChange={(e) => patchOpt(oi, { price_delta: e.target.value })} /></div>
                        <button type="button" className={`col-span-1 ${ROW_ACTION_DANGER}`} onClick={() => patch({ options: g.options.filter((_, i) => i !== oi) })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className={`ml-3 mt-1 ${ROW_ACTION}`} onClick={() => patch({ options: [...g.options, { name: "", price_delta: 0 }] })}>+ Option</button>
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
          </Section>
        )}

            </div>

            {/* ═══════════════ TAB: Codes & packs ═══════════════ */}
            <div className={activeTab === "advanced" ? "space-y-5" : "hidden"}>
        {/* Codes, packs & pricing extras */}
        {(isGood || !isService) && (
              <div className="space-y-4">
                {/* SKU + brand + base unit */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <Label>SKU</Label>
                    <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Unique code" />
                    {err("sku") && <p className="mt-1 text-theme-xs text-error-500">{err("sku")}</p>}
                  </div>
                  {isGood && (
                    <>
                      <div>
                        <Label>Brand</Label>
                        <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Nestlé" />
                      </div>
                      <div>
                        <Label>Base unit</Label>
                        <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, kg, box…" />
                        {typeUnits.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {typeUnits.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => setUnit(u)}
                                className={`rounded-full px-2 py-0.5 text-theme-xs transition-colors ${
                                  unit === u
                                    ? "bg-brand-500 text-white"
                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                                }`}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Sold by (+ scale PLU for POS weight items) */}
                {isGood && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <Label>Sold by</Label>
                      <Select
                        key={soldBy}
                        defaultValue={soldBy}
                        options={[
                          { value: "unit", label: "Unit (whole numbers)" },
                          { value: "weight", label: "Weight / measure (0.5, 1.25…)" },
                        ]}
                        placeholder="Sold by"
                        onChange={(v) => setSoldBy(v as "unit" | "weight")}
                      />
                      <p className="mt-1 text-theme-xs text-gray-400">Weight lets you sell fractions — e.g. 1.5 kg sugar.</p>
                    </div>
                    {posEnabled && soldBy === "weight" && (
                      <div>
                        <Label>Scale PLU code</Label>
                        <Input value={pluCode} onChange={(e) => setPluCode(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 21" />
                        {err("plu_code") && <p className="mt-1 text-theme-xs text-error-500">{err("plu_code")}</p>}
                        <p className="mt-1 text-theme-xs text-gray-400">The number programmed into your weighing scale. (Enable scale barcodes in Settings.)</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Barcodes — POS/scanner only */}
                {posEnabled && isGood && (
                  <>
                    <div>
                      <Label>Barcode</Label>
                      <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" />
                      {err("barcode") && <p className="mt-1 text-theme-xs text-error-500">{err("barcode")}</p>}
                    </div>

                    <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Additional barcodes</p>
                        <button
                          type="button"
                          className={ROW_ACTION}
                          onClick={() => setExtraBarcodes((b) => [...b, ""])}
                        >
                          + Add barcode
                        </button>
                      </div>
                      <p className="mb-3 text-theme-xs text-gray-400">Beyond the primary barcode — e.g. a different supplier's pack of the same item.</p>
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
                              className={ROW_ACTION_DANGER}
                              onClick={() => setExtraBarcodes((arr) => arr.filter((_, j) => j !== i))}
                            >
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Pack sizes (pack-breaking) */}
                    <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Pack sizes</p>
                        <button
                          type="button"
                          className={ROW_ACTION}
                          onClick={() => setUnits((u) => [...u, { name: "", factor: "", price: "", barcode: "" }])}
                        >
                          + Add pack
                        </button>
                      </div>
                      <p className="mb-3 text-theme-xs text-gray-400">
                        Sell in bigger packs while stock stays counted in <span className="font-medium">{unit.trim() || "the base unit"}</span>. A pharmacy can sell a Strip (=10 tablets) or Box (=100). Leave price blank to use base price × pack size.
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
                            <button type="button" className={ROW_ACTION_DANGER} onClick={() => setUnits((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                          </div>
                        ))
                      )}
                      {err("units") && <p className="mt-1 text-theme-xs text-error-500">{err("units")}</p>}
                    </div>

                    {/* Wholesale price level */}
                    <div className="max-w-xs">
                      <Label>Wholesale price (optional)</Label>
                      <Input type="number" min="0" step={0.01} value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} placeholder="Bulk / trade price" />
                      {wholesalePrice && Number(wholesalePrice) >= Number(price || 0) && (
                        <p className="mt-1 text-theme-xs text-warning-500">Wholesale should be below the retail price.</p>
                      )}
                      <p className="mt-1 text-theme-xs text-gray-400">Cashiers can switch a POS line to this rate via the price-level dropdown.</p>
                    </div>
                  </>
                )}

                {/* Bulk pricing (quantity breaks) + minimum online order */}
                {isGood && (
                  <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Bulk pricing (quantity breaks)</p>
                      <button
                        type="button"
                        className={ROW_ACTION}
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
                        <button type="button" className={ROW_ACTION_DANGER} onClick={() => setTiers((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    ))}
                    {marketplaceEnabled && (
                      <div className="mt-3 max-w-xs">
                        <Label>Minimum order quantity (online)</Label>
                        <Input type="number" min="0" step={0.001} value={minOrderQty} onChange={(e) => setMinOrderQty(e.target.value)} placeholder="e.g. 12" />
                        <p className="mt-1 text-theme-xs text-gray-400">Online orders below this quantity are rejected. POS is not restricted.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
        )}

            {/* Selling status — outside the goods-only block above, because a
                service gets discontinued the same as a tin of paint does. */}
            <Toggle
              checked={isActive}
              onChange={setIsActive}
              title="Still selling this"
              hint="Turn off to retire the item — it leaves the till and your online shop but keeps its sales history, unlike deleting it. Turn it back on any time."
            />
            </div>{/* end Codes & packs tab */}
          </div>{/* end scroll area */}

          {/* Footer — always visible; submits the form from any tab */}
          <div className="flex items-center gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
            <Button size="sm" disabled={mutation.isPending || uploadingNew || !name.trim() || !price || needsExpiry}>
              {uploadingNew
                ? "Uploading photos…"
                : mutation.isPending
                  ? "Saving…"
                  : isEdit
                    ? "Save changes"
                    : "Create item"}
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            {needsExpiry && (
              <span className="text-theme-xs text-error-500">
                Set the opening batch expiry (Details tab) — required for medicine stock.
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * What a portion costs, beside what it sells for.
 *
 * ── Food cost %, and why it is the headline ─────────────────────────────
 *
 * A restaurant is run on this one ratio. Thirty per cent is healthy in this
 * market, fifty is a dish losing money that looks busy. It is the sentence the
 * whole recipe section exists to produce, so it is the biggest thing on it.
 *
 * ── Stale by design, and honest about it ────────────────────────────────
 *
 * The figure is whatever the server computed when this screen loaded. Editing a
 * row below does NOT move it — recalculating in the browser would need every
 * ingredient's cost price on the page, which this platform deliberately never
 * sends (see HidesCostPrice), and a figure the panel derived itself would be a
 * second answer to a question the server already answers for every report.
 *
 * ── When it cannot say ──────────────────────────────────────────────────
 *
 * It names the ingredients with no cost rather than showing a smaller number.
 * A partial food cost is not a cheaper dish; it is a wrong one, and wrong in
 * the direction that makes a kitchen underprice.
 */
function FoodCost({ cost, missing, price }: { cost: number | null; missing: string[]; price: number }) {
  if (cost === null) {
    return (
      <div className="mt-4 rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 dark:border-warning-500/40 dark:bg-warning-500/10">
        <p className="text-theme-sm font-medium text-warning-700 dark:text-warning-400">
          This dish cannot be costed yet
        </p>
        <p className="mt-0.5 text-theme-xs text-warning-700/80 dark:text-warning-400/80">
          {missing.length > 0
            ? `No cost price on ${missing.join(", ")}. Add it there and this dish costs itself.`
            : "Add a cost price to the ingredients and this dish costs itself."}
        </p>
      </div>
    );
  }

  const pct = price > 0 ? (cost / price) * 100 : null;
  // 30% is healthy here, 50% is a dish that looks busy and loses money.
  const tone =
    pct === null ? "text-gray-800 dark:text-white/90"
      : pct > 50 ? "text-error-600 dark:text-error-400"
        : pct > 40 ? "text-warning-600 dark:text-warning-400"
          : "text-success-600 dark:text-success-500";

  return (
    <div className="mt-4 rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-theme-xs uppercase tracking-wide text-gray-400">Costs to make</p>
          <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-white/90">
            Rs {cost.toLocaleString()}
          </p>
        </div>
        {pct !== null && (
          <div className="text-right">
            <p className="text-theme-xs uppercase tracking-wide text-gray-400">Food cost</p>
            <p className={`text-lg font-semibold tabular-nums ${tone}`}>{pct.toFixed(0)}%</p>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-theme-xs text-gray-400">
        From the ingredients&rsquo; own cost prices. Save and reopen to refresh it after changing the
        recipe.
      </p>
    </div>
  );
}
