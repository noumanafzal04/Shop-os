import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { KeyboardScreen } from "@cartze/core/ui/KeyboardScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { money } from "@cartze/core/format";
import { ApiError } from "@cartze/core/types/api";
import { PlusIcon, TrashIcon, UploadIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAuthStore } from "../../../stores/authStore";
import { useCategories, useCollections, useCreateProduct } from "../hooks/useCatalog";
import {
  ITEM_TYPE_LABEL,
  NO_SIZES,
  NOT_ON_A_PHONE,
  type NewVariant,
} from "../services/catalogService";

/**
 * ADD AN ITEM, FROM BEHIND THE COUNTER.
 *
 * ── What this carries, and what stays on the panel ───────────────────
 *
 * The panel's form is 1,700 lines across five tabs. This one carries what a
 * shopkeeper standing in the shop actually needs to put something on sale:
 *
 *   what it is        name, kind, category, description
 *   what it costs     price, sale price, cost
 *   how it is sold    sizes
 *   how many          track stock, opening count, low-stock alert
 *   how it scans      SKU, barcode
 *   where it shows    collections, photo
 *
 * What is NOT here is on the panel on purpose: tax groups, scale PLU codes,
 * pack sizes, recipe items, modifier groups, warranty terms, medicine strength
 * and schedule. Every one of those is set once, at a desk, with a keyboard.
 * A phone form long enough to hold them is a phone form nobody finishes — and
 * the footer says where they are rather than pretending they do not exist.
 *
 * ── "Sale price" IS `discount_price` ─────────────────────────────────
 *
 * The panel labels the field "Sale price (optional)" and the column is
 * `discount_price`. Same thing, and this app uses the shopkeeper's word.
 *
 * ── One product, one picture ─────────────────────────────────────────
 *
 * The server REPLACES rather than appends and refuses a second file in the
 * same request, so there is one picker and it says Replace once something is
 * chosen. The panel said "Add photos" while the server appended, and somebody
 * correcting a bad photo got a second one with the bad one still first. The
 * Remove control is a real, visible button: on the panel it was `opacity-0`
 * until hover, so on a tablet the picture could not be deleted at all.
 */
export function ProductFormScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const tenant = useAuthStore((st) => st.user?.tenant);
  const { data: categories } = useCategories();
  const { data: collections } = useCollections();
  const create = useCreateProduct();

  /**
   * WHAT THIS SHOP MAY ADD — the server's list.
   *
   * `tenant.item_types` comes from the same function that validates the save,
   * so the form can never offer a kind the save will reject. `deal` is dropped
   * because it needs components picked one by one, which is not a phone job —
   * and offering it here would mean refusing it after the person had typed.
   */
  const kinds = useMemo(
    () => (tenant?.item_types ?? []).filter((t) => !NOT_ON_A_PHONE.includes(t)),
    [tenant?.item_types],
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [cost, setCost] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [kind, setKind] = useState<string | null>(kinds[0] ?? null);
  const [category, setCategory] = useState<string | null>(null);
  const [shelves, setShelves] = useState<string[]>([]);
  const [tracksStock, setTracksStock] = useState(false);
  const [openingStock, setOpeningStock] = useState("");
  const [lowStock, setLowStock] = useState("");
  const [photo, setPhoto] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [sizes, setSizes] = useState<NewVariant[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * SIZES AND STOCK ARE OFFERED ONLY WHERE THE SERVER ALLOWS THEM.
   *
   * `variants` is `prohibited` on a service and on a deal; `track_inventory`
   * and `stock_quantity` are `prohibited` on a service. Drawing the box and
   * refusing the save afterwards is how this product has repeatedly wasted
   * somebody's typing.
   */
  const sizesAllowed = !!kind && !NO_SIZES.includes(kind);
  const stockAllowed = kind !== "service";
  const liveSizes = sizesAllowed ? sizes.filter((v) => v.name.trim() && v.price.trim()) : [];

  /**
   * A HALF-TYPED SIZE BLOCKS THE SAVE, rather than being dropped.
   *
   * Filtering incomplete rows out silently would post a product missing the
   * size somebody was in the middle of adding, and they would find out when a
   * customer could not order a Large. A row with NEITHER field filled is not
   * half-typed — it is a row somebody added and changed their mind about, and
   * it is dropped.
   */
  const halfTyped =
    sizesAllowed && sizes.some((v) => (v.name.trim() ? 0 : 1) + (v.price.trim() ? 0 : 1) === 1);

  /**
   * A STRIKE-THROUGH MUST BE TRUE.
   *
   * The server takes any `discount_price` it is given — there is no rule tying
   * it to `price`. So a sale price at or above the normal price would ship a
   * crossed-out number that was never higher, which is the shape of a lie this
   * product has already had to fix once on a customer-facing card. Caught
   * here, named here, and it blocks the save rather than warning beside it.
   */
  const saleAbovePrice =
    salePrice.trim().length > 0 &&
    price.trim().length > 0 &&
    Number(salePrice) >= Number(price) &&
    Number.isFinite(Number(salePrice)) &&
    Number.isFinite(Number(price));

  const margin =
    cost.trim() && price.trim() && Number.isFinite(Number(cost)) && Number.isFinite(Number(price))
      ? Number(price) - Number(cost)
      : null;

  const ready =
    name.trim().length > 0 &&
    price.trim().length > 0 &&
    !!kind &&
    !halfTyped &&
    !saleAbovePrice;

  async function pick() {
    const res = await launchImageLibrary({ mediaType: "photo", quality: 0.8, selectionLimit: 1 });
    const a = res.assets?.[0];
    if (!a?.uri) return;
    setPhoto({ uri: a.uri, name: a.fileName ?? "photo.jpg", type: a.type ?? "image/jpeg" });
  }

  const toggleShelf = (id: string) =>
    setShelves((on) => (on.includes(id) ? on.filter((x) => x !== id) : [...on, id]));

  async function save() {
    if (!ready || create.isPending || !kind) return;
    setError(null);

    /**
     * Blank fields are OMITTED, not sent empty.
     *
     * `sku: ""` is not "no SKU" to the server — it is an empty string that has
     * to pass a uniqueness rule, and the SECOND product saved without one
     * collides with the first. Same for `barcode`.
     */
    const trimmed = (v: string) => (v.trim().length > 0 ? v.trim() : undefined);

    try {
      const { photoFailed } = await create.mutateAsync({
        body: {
          name: name.trim(),
          price: price.trim(),
          item_type: kind,
          category_id: category,
          ...(trimmed(description) ? { description: description.trim() } : {}),
          ...(trimmed(salePrice) ? { discount_price: salePrice.trim() } : {}),
          ...(trimmed(cost) ? { cost: cost.trim() } : {}),
          ...(trimmed(sku) ? { sku: sku.trim() } : {}),
          ...(trimmed(barcode) ? { barcode: barcode.trim() } : {}),
          ...(stockAllowed && tracksStock
            ? {
                track_inventory: true,
                ...(trimmed(openingStock) ? { stock_quantity: openingStock.trim() } : {}),
                ...(trimmed(lowStock) ? { low_stock_threshold: lowStock.trim() } : {}),
              }
            : {}),
          ...(shelves.length > 0 ? { collection_ids: shelves } : {}),
          ...(liveSizes.length > 0
            ? { variants: liveSizes.map((v) => ({ name: v.name.trim(), price: v.price.trim() })) }
            : {}),
        },
        photo,
      });

      // Two different outcomes, said differently. "Saved" over a failed photo
      // is how somebody finds out a week later that half their menu has none.
      toast.success(
        photoFailed ? `${name.trim()} added — the photo did not upload` : `${name.trim()} added`,
      );
      nav.goBack();
    } catch (e) {
      setError(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Could not save this item");
    }
  }

  /**
   * A SHOP THAT CANNOT CATALOG ANYTHING IS TOLD SO.
   *
   * An empty `item_types` is a real answer, not a loading state — a finance
   * business sells neither goods nor labour. Drawing an empty form and
   * refusing the save is the failure this screen was written to avoid.
   */
  if (kinds.length === 0) {
    return (
      <SafeScreen>
        <View style={s.blocked}>
          <Text style={s.blockedTitle}>This shop does not sell items</Text>
          <Text style={s.blockedBody}>
            Adding to the menu needs the products module switched on for your shop. Your CartZe web
            panel is where that happens.
          </Text>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <KeyboardScreen contentStyle={s.content}>
        {/* ── what it is ──────────────────────────────────────────── */}
        <Section title="What it is">
          <AppTextInput
            label="Name"
            placeholder="Chicken Karahi"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (error) setError(null);
            }}
            autoFocus
            editable={!create.isPending}
          />

          {/* Only drawn when there is a choice — one option is not a question. */}
          {kinds.length > 1 ? (
            <Field label="Kind">
              <Chips
                options={kinds.map((t) => ({
                  // An unknown code is SHOWN, never hidden: the server added a
                  // kind this app has no word for yet, and dropping it
                  // silently would make it unreachable for ever.
                  id: t,
                  label: ITEM_TYPE_LABEL[t] ?? t,
                }))}
                selected={kind ? [kind] : []}
                onPick={setKind}
              />
            </Field>
          ) : null}

          <Field label="Category">
            <Chips
              options={[
                { id: "", label: "None" },
                ...(categories ?? []).map((cat) => ({ id: cat.id, label: cat.name })),
              ]}
              selected={[category ?? ""]}
              onPick={(id) => setCategory(id || null)}
            />
          </Field>

          <AppTextInput
            label="Description (optional)"
            placeholder="Slow-cooked, served with naan"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            editable={!create.isPending}
          />
        </Section>

        {/* ── what it costs ───────────────────────────────────────── */}
        <Section title="Price">
          <AppTextInput
            label="Price"
            placeholder="850"
            value={price}
            onChangeText={(t) => {
              setPrice(t);
              if (error) setError(null);
            }}
            // `decimal-pad`, not `numeric`: a price can carry paisa and this
            // keyboard has no letters on it to slip in.
            keyboardType="decimal-pad"
            editable={!create.isPending}
          />

          <AppTextInput
            label="Sale price (optional)"
            placeholder="Leave empty if it is not on offer"
            value={salePrice}
            onChangeText={setSalePrice}
            keyboardType="decimal-pad"
            editable={!create.isPending}
            error={
              saleAbovePrice
                ? "A sale price has to be below the price, or the crossed-out number is not true."
                : null
            }
          />

          <AppTextInput
            label="Cost (optional)"
            placeholder="What you paid"
            value={cost}
            onChangeText={setCost}
            keyboardType="decimal-pad"
            editable={!create.isPending}
          />

          {/* Said out loud, because profit on the dashboard is built on it. */}
          {margin != null ? (
            <Text style={margin >= 0 ? s.margin : s.marginBad}>
              {margin >= 0
                ? `You make ${money(margin)} on each one`
                : `You lose ${money(Math.abs(margin))} on each one`}
            </Text>
          ) : null}
        </Section>

        {/* ── how it is sold ──────────────────────────────────────── */}
        {sizesAllowed ? (
          <Section title="Sizes">
            <Text style={s.hint}>
              Leave this empty if it is sold one way. Add a row for each size and the price of that
              size.
            </Text>

            {sizes.map((v, i) => (
              <View key={`size-${i}`} style={s.sizeRow}>
                <View style={s.sizeName}>
                  <AppTextInput
                    placeholder="Large"
                    value={v.name}
                    onChangeText={(t) =>
                      setSizes((rows) => rows.map((r, j) => (j === i ? { ...r, name: t } : r)))
                    }
                    editable={!create.isPending}
                  />
                </View>
                <View style={s.sizePrice}>
                  <AppTextInput
                    placeholder="950"
                    value={v.price}
                    onChangeText={(t) =>
                      setSizes((rows) => rows.map((r, j) => (j === i ? { ...r, price: t } : r)))
                    }
                    keyboardType="decimal-pad"
                    editable={!create.isPending}
                  />
                </View>
                <Touchable
                  onPress={() => setSizes((rows) => rows.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove size ${i + 1}`}
                  hitSlop={8}
                  style={s.sizeRemove}
                >
                  <TrashIcon size={18} color={c.error} />
                </Touchable>
              </View>
            ))}

            <Touchable
              onPress={() => setSizes((rows) => [...rows, { name: "", price: "" }])}
              accessibilityRole="button"
              style={s.addSize}
            >
              <PlusIcon size={18} color={c.primaryPressed} />
              <Text style={s.addSizeText}>Add a size</Text>
            </Touchable>

            {halfTyped ? (
              <Text style={s.warn}>Every size needs both a name and a price.</Text>
            ) : null}
          </Section>
        ) : null}

        {/* ── how many ────────────────────────────────────────────── */}
        {stockAllowed ? (
          <Section title="Stock">
            <View style={s.switchRow}>
              <View style={s.switchText}>
                <Text style={s.switchLabel}>Count this item</Text>
                <Text style={s.hint}>
                  Off for a dish you cook to order. On for anything you have a number of.
                </Text>
              </View>
              <Switch
                value={tracksStock}
                onValueChange={setTracksStock}
                trackColor={{ true: c.primary, false: c.border }}
                thumbColor={c.white}
              />
            </View>

            {tracksStock ? (
              <View style={s.pairRow}>
                <View style={s.pairHalf}>
                  <AppTextInput
                    label="How many now"
                    placeholder="0"
                    value={openingStock}
                    onChangeText={setOpeningStock}
                    keyboardType="decimal-pad"
                    editable={!create.isPending}
                  />
                </View>
                <View style={s.pairHalf}>
                  <AppTextInput
                    label="Warn me at"
                    placeholder="5"
                    value={lowStock}
                    onChangeText={setLowStock}
                    keyboardType="decimal-pad"
                    editable={!create.isPending}
                  />
                </View>
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* ── how it scans ────────────────────────────────────────── */}
        <Section title="Codes (optional)">
          <View style={s.pairRow}>
            <View style={s.pairHalf}>
              <AppTextInput
                label="SKU"
                placeholder="KRH-001"
                value={sku}
                onChangeText={setSku}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!create.isPending}
              />
            </View>
            <View style={s.pairHalf}>
              <AppTextInput
                label="Barcode"
                placeholder="Scan or type"
                value={barcode}
                onChangeText={setBarcode}
                keyboardType="number-pad"
                editable={!create.isPending}
              />
            </View>
          </View>
        </Section>

        {/* ── where it shows ──────────────────────────────────────── */}
        {(collections ?? []).length > 0 ? (
          <Section title="Collections (optional)">
            <Text style={s.hint}>A shelf you arrange yourself. An item can be on several.</Text>
            <Chips
              options={(collections ?? []).map((col) => ({ id: col.id, label: col.name }))}
              selected={shelves}
              onPick={toggleShelf}
            />
          </Section>
        ) : null}

        <Section title="Photo">
          {photo ? (
            <View style={s.photoRow}>
              <Image source={{ uri: photo.uri }} style={s.photo} />
              <View style={s.photoActions}>
                <AppButton title="Replace" onPress={pick} variant="outline" />
                <AppButton
                  title="Remove"
                  onPress={() => setPhoto(null)}
                  variant="outline"
                  icon={TrashIcon}
                />
              </View>
            </View>
          ) : (
            <Touchable onPress={pick} accessibilityRole="button" style={s.picker}>
              <UploadIcon size={22} color={c.textSecondary} />
              <Text style={s.pickerText}>Choose a photo</Text>
            </Touchable>
          )}
        </Section>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <AppButton
          title="Add to the menu"
          onPress={save}
          loading={create.isPending}
          disabled={!ready}
          size="lg"
        />

        <Text style={s.foot}>
          Tax groups, pack sizes, scale codes, recipes and per-branch prices are set in the CartZe
          web panel.
        </Text>
      </KeyboardScreen>
    </SafeScreen>
  );
}

/** A titled block, so a long form reads as five short ones. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const s = styles(useColors());
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const s = styles(useColors());
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * ONE CHIP GROUP, single- or multi-select by what `selected` holds.
 *
 * Kind, category and collections are the same control asked three times; three
 * copies is how one of them ends up a different height. `ChipBar` in core is
 * the SCROLLING variant for a filter strip — this one wraps, because a form
 * field that scrolls sideways hides its own options.
 */
function Chips({
  options,
  selected,
  onPick,
}: {
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onPick: (id: string) => void;
}) {
  const s = styles(useColors());
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <Touchable
            key={o.id || "none"}
            onPress={() => onPick(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.chip, on ? s.chipOn : null]}
          >
            <Text style={[s.chipText, on ? s.chipTextOn : null]}>{o.label}</Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },
    section: { gap: spacing.sm },
    sectionTitle: {
      ...typography.label,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: c.textMuted,
      marginBottom: spacing.xs,
    },
    field: { gap: spacing.sm, marginBottom: spacing.md },
    label: { ...typography.label, color: c.gray[700] },
    hint: { ...typography.small, color: c.textSecondary, lineHeight: 18 },
    warn: { ...typography.small, color: c.error },
    margin: { ...typography.label, color: c.success },
    marginBad: { ...typography.label, color: c.error },

    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipOn: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    chipTextOn: { color: c.onPrimary },

    sizeRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    sizeName: { flex: 2 },
    sizePrice: { flex: 1 },
    sizeRemove: { padding: 6, marginTop: 12 },
    addSize: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm + 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    addSizeText: { ...typography.label, color: c.primaryPressed },

    switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    switchText: { flex: 1, gap: 2 },
    switchLabel: { ...typography.body, fontSize: 16, color: c.text },
    pairRow: { flexDirection: "row", gap: spacing.sm },
    pairHalf: { flex: 1 },

    picker: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    pickerText: { ...typography.body, color: c.textSecondary },
    photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    photo: { width: 96, height: 96, borderRadius: 14, backgroundColor: c.surfaceAlt },
    photoActions: { flex: 1, gap: spacing.sm },

    errorBox: {
      backgroundColor: c.errorBg,
      borderRadius: 12,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    errorText: { ...typography.label, fontWeight: "500", color: c.error, lineHeight: 20 },
    foot: {
      ...typography.small,
      color: c.textSecondary,
      textAlign: "center",
      lineHeight: 19,
    },

    blocked: { padding: spacing.lg, gap: spacing.sm, justifyContent: "center", flex: 1 },
    blockedTitle: { ...typography.title, color: c.text, textAlign: "center" },
    blockedBody: { ...typography.body, color: c.textSecondary, textAlign: "center", lineHeight: 22 },
  });
