import React, { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown, Minus, Plus, X } from "lucide-react-native";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { PublicModifierGroup, PublicProduct } from "../services/marketplaceService";
import { money, qtyText } from "../../../common/format";


export interface ConfiguredLine {
  variant_id: string | null;
  variant_name?: string;
  modifier_option_ids: string[];
  modifiers_label?: string;
  unit_price: number;
  quantity: number;
}

/**
 * Bottom-sheet product configurator — variants, food modifiers/add-ons
 * (min/max enforced), and unit/weight quantity with a live total.
 */
export function ProductSheet({
  product,
  onClose,
  onAdd,
}: {
  product: PublicProduct;
  onClose: () => void;
  onAdd: (line: ConfiguredLine) => void;
}) {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const isWeight = product.sold_by === "weight";
  const step = isWeight ? 0.25 : 1;
  const hasVariants = product.variants.length > 0;

  const [variantId, setVariantId] = useState<string | null>(
    hasVariants ? product.variants.find((v) => v.in_stock)?.id ?? null : null,
  );
  const [qty, setQty] = useState(isWeight ? 0.5 : 1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Pre-select defaults / first option of required groups.
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const g of product.modifier_groups) {
      const def = g.options.filter((o) => o.is_default).map((o) => o.id);
      initial[g.id] = def.length > 0 ? def : g.min_select > 0 && g.options[0] ? [g.options[0].id] : [];
    }
    return initial;
  });

  const toggle = (g: PublicModifierGroup, oid: string) =>
    setSel((s) => {
      const cur = s[g.id] ?? [];
      if (g.max_select === 1) return { ...s, [g.id]: [oid] };
      if (cur.includes(oid)) return { ...s, [g.id]: cur.filter((x) => x !== oid) };
      if (g.max_select > 0 && cur.length >= g.max_select) return s;
      return { ...s, [g.id]: [...cur, oid] };
    });

  const valid = product.modifier_groups.every((g) => {
    const n = (sel[g.id] ?? []).length;
    return n >= g.min_select && (g.max_select === 0 || n <= g.max_select);
  });

  const { unitPrice, label } = useMemo(() => {
    const variant = variantId ? product.variants.find((v) => v.id === variantId) : null;
    const base = variant ? Number(variant.price) : Number(product.price);
    let delta = 0;
    const names: string[] = [];
    for (const g of product.modifier_groups) {
      for (const oid of sel[g.id] ?? []) {
        const o = g.options.find((x) => x.id === oid);
        if (o) {
          delta += Number(o.price_delta);
          names.push(o.name);
        }
      }
    }
    return { unitPrice: base + delta, label: names.join(", ") };
  }, [product, variantId, sel]);

  const total = unitPrice * qty;
  const image = product.images[0];

  const add = () => {
    if (!valid) return;
    const variant = variantId ? product.variants.find((v) => v.id === variantId) : null;
    onAdd({
      variant_id: variantId,
      variant_name: variant?.name,
      modifier_option_ids: Object.values(sel).flat(),
      modifiers_label: label || undefined,
      unit_price: unitPrice,
      quantity: qty,
    });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
          <X size={18} color={c.gray[500]} strokeWidth={2.2} />
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {/* Hero image */}
          <View style={styles.hero}>
            {image ? (
              <Image source={{ uri: image }} style={styles.heroImg} resizeMode="cover" />
            ) : (
              <Text style={styles.heroInitial}>{product.name.charAt(0)}</Text>
            )}
          </View>

          {/* Name + price */}
          <View style={styles.head}>
            <View style={styles.headInfo}>
              <Text style={styles.name}>{product.name}</Text>
              {isWeight && product.unit ? (
                <Text style={styles.perUnit}>per {product.unit}</Text>
              ) : null}
            </View>
            <View style={styles.priceCol}>
              <Text style={styles.price}>{money(Number(product.price))}</Text>
              {product.original_price != null && (
                <Text style={styles.strike}>{money(product.original_price)}</Text>
              )}
            </View>
          </View>
          {!!product.description && <Text style={styles.desc}>{product.description}</Text>}

          {/* Variants */}
          {hasVariants && (
            <View style={styles.group}>
              <View style={styles.groupHead}>
                <View>
                  <Text style={styles.groupTitle}>Choose an option</Text>
                  <Text style={styles.rule}>select 1</Text>
                </View>
                <View style={[styles.pill, styles.pillRequired]}>
                  <Text style={[styles.pillText, styles.pillTextRequired]}>Required</Text>
                </View>
              </View>
              {product.variants.map((v) => {
                const on = variantId === v.id;
                return (
                  <Pressable key={v.id} style={styles.option} disabled={!v.in_stock} onPress={() => setVariantId(v.id)}>
                    <Text style={[styles.optionText, !v.in_stock && styles.optionTextOff]}>
                      {v.name}{!v.in_stock ? " · out of stock" : ""}
                    </Text>
                    <Text style={styles.optionPrice}>{money(Number(v.price))}</Text>
                    <View style={[styles.radio, on && styles.radioOn]} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Modifier groups */}
          {product.modifier_groups.map((g) => {
            const single = g.max_select === 1;
            const subtitle =
              g.min_select > 0
                ? `select ${g.min_select === g.max_select ? g.min_select : `at least ${g.min_select}`}`
                : g.max_select > 0
                  ? `select upto ${g.max_select}`
                  : "select any";
            const expandedAll = expanded[g.id] ?? false;
            const visible = expandedAll ? g.options : g.options.slice(0, 4);
            const hidden = g.options.length - visible.length;
            return (
              <View key={g.id} style={styles.group}>
                <View style={styles.groupHead}>
                  <View>
                    <Text style={styles.groupTitle}>{g.name}</Text>
                    <Text style={styles.rule}>{subtitle}</Text>
                  </View>
                  <View style={[styles.pill, g.min_select > 0 && styles.pillRequired]}>
                    <Text style={[styles.pillText, g.min_select > 0 && styles.pillTextRequired]}>
                      {g.min_select > 0 ? "Required" : "Optional"}
                    </Text>
                  </View>
                </View>
                {visible.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id);
                  return (
                    <Pressable key={o.id} style={styles.option} onPress={() => toggle(g, o.id)}>
                      <Text style={styles.optionText}>{o.name}</Text>
                      {Number(o.price_delta) > 0 && (
                        <Text style={styles.optionPrice}>+{money(Number(o.price_delta))}</Text>
                      )}
                      <View
                        style={[
                          single ? styles.radio : styles.check,
                          on && (single ? styles.radioOn : styles.checkOn),
                        ]}
                      >
                        {!single && on && <Check size={13} color={c.white} strokeWidth={3} />}
                      </View>
                    </Pressable>
                  );
                })}
                {hidden > 0 && (
                  <Pressable style={styles.viewMore} onPress={() => setExpanded((e) => ({ ...e, [g.id]: true }))}>
                    <ChevronDown size={15} color={c.gray[500]} strokeWidth={2.2} />
                    <Text style={styles.viewMoreText}>View {hidden} more</Text>
                  </Pressable>
                )}
              </View>
            );
          })}

          <View style={{ height: spacing.md }} />
        </ScrollView>

        {/* Qty + add — pinned */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.qtyRow}>
            <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => Math.max(step, q - step))}>
              <Minus size={16} color={c.gray[700]} strokeWidth={2.4} />
            </Pressable>
            <Text style={styles.qty}>
              {qtyText(qty)}
              {isWeight && product.unit ? ` ${product.unit}` : ""}
            </Text>
            <Pressable style={[styles.qtyBtn, styles.qtyBtnPlus]} onPress={() => setQty((q) => q + step)}>
              <Plus size={16} color={c.white} strokeWidth={2.4} />
            </Pressable>
          </View>
          <Pressable style={[styles.addBtn, !valid && styles.addBtnOff]} disabled={!valid} onPress={add}>
            <Text style={styles.addText}>Add to cart · {money(total)}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(16,26,38,0.55)" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: c.gray[200],
    marginTop: spacing.sm,
  },
  scroll: { paddingHorizontal: spacing.md },

  hero: {
    height: 190,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginTop: spacing.sm,
  },
  heroImg: { width: "100%", height: "100%" },
  heroInitial: { fontSize: 56, fontWeight: "700", color: c.gray[200] },

  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingTop: spacing.md },
  headInfo: { flex: 1, gap: 2 },
  name: { ...typography.title, color: c.text, fontSize: 20 },
  priceCol: { alignItems: "flex-end", gap: 2 },
  price: { ...typography.title, color: c.brand[600], fontSize: 18 },
  perUnit: { ...typography.small, color: c.gray[400] },
  strike: { ...typography.small, color: c.gray[400], textDecorationLine: "line-through" },
  desc: { ...typography.small, color: c.gray[500], marginTop: spacing.xs, marginBottom: spacing.sm },
  close: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  group: { marginTop: spacing.md },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  groupTitle: { ...typography.h3, color: c.text, fontSize: 16 },
  rule: { ...typography.tiny, color: c.gray[500], marginTop: 1 },
  pill: {
    backgroundColor: c.surfaceAlt,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillRequired: { backgroundColor: c.brand[50] },
  pillText: { ...typography.tiny, color: c.gray[500], fontWeight: "600" },
  pillTextRequired: { color: c.brand[700] },

  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  optionText: { ...typography.body, color: c.text, flex: 1, fontSize: 14, fontWeight: "500" },
  optionTextOff: { color: c.gray[400] },
  optionPrice: { ...typography.small, color: c.gray[500] },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: c.gray[300],
  },
  radioOn: { borderColor: c.brand[500], borderWidth: 6 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.gray[300],
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { borderColor: c.brand[500], backgroundColor: c.brand[500] },
  viewMore: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: spacing.sm },
  viewMoreText: { ...typography.small, color: c.gray[600], fontWeight: "600" },

  // `paddingBottom` is applied at the call site from the device's inset. The
  // sheet is the LAST thing on the screen, so nothing else is left to hold the
  // Add-to-cart button clear of the home indicator — and a button under the
  // gesture bar is a button that swipes the app away instead of buying
  // anything.
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  qtyBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnPlus: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  qty: { ...typography.label, color: c.text, minWidth: 44, textAlign: "center" },
  addBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: c.brand[500],
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnOff: { opacity: 0.4 },
  addText: { ...typography.label, color: c.white, fontSize: 15 },
});
