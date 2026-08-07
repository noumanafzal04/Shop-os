import React from "react";
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { StepBar } from "../../../common/ui/StepBar";
import { colors, radius, spacing, typography } from "../../../theme";
import { useCartStore, cartKeyOf } from "../../../stores/cartStore";
import { useMarketProducts, useMarketShop } from "../../marketplace/hooks/useMarketplace";
import type { PublicProduct } from "../../marketplace/services/marketplaceService";

const money = (n: number) => `Rs ${n.toLocaleString()}`;
const fmtQty = (n: number) => String(parseFloat(n.toFixed(3)));

/**
 * Cart tab (center FAB) — reference layout: step bar, line items with
 * stepper pills, "+ Add more items", cross-sell strip, pinned total +
 * "Confirm payment and address".
 */
export function CartScreen() {
  const navigation = useNavigation<any>();
  const cart = useCartStore();
  const slug = cart.shopSlug;

  const shop = useMarketShop(slug ?? undefined);
  // Cross-sell: simple, in-stock items from the same shop not already in the cart.
  const products = useMarketProducts(slug ?? undefined, {});
  const inCart = new Set(cart.lines.map((l) => l.product_id));
  const suggestions = (products.data?.data ?? [])
    .filter(
      (p) =>
        p.type === "product" &&
        p.in_stock &&
        p.available_now &&
        !inCart.has(p.id) &&
        p.variants.length === 0 &&
        p.modifier_groups.length === 0 &&
        p.sold_by !== "weight",
    )
    .slice(0, 8);

  const addSuggestion = (p: PublicProduct) => {
    if (!slug) return;
    cart.add(slug, {
      product_id: p.id,
      variant_id: null,
      name: p.name,
      unit_price: Number(p.price),
      sold_by: p.sold_by,
      unit_label: p.unit,
    });
  };

  if (cart.lines.length === 0) {
    return (
      <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
        <Text style={styles.title}>My Cart</Text>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={34} color={colors.brand[500]} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Browse shops near you and add something tasty.</Text>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <Text style={styles.title}>Cart</Text>
      {!!shop.data && <Text style={styles.shopName}>{shop.data.business_name}</Text>}
      <View style={styles.steps}>
        <StepBar active={2} />
      </View>

      <FlatList
        data={cart.lines}
        keyExtractor={(l) => cartKeyOf(l)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const k = cartKeyOf(item);
          const step = item.sold_by === "weight" ? 0.25 : 1;
          return (
            <View style={styles.line}>
              <View style={styles.lineThumb}>
                <Text style={styles.lineInitial}>{item.name.charAt(0)}</Text>
              </View>
              <View style={styles.lineInfo}>
                <Text style={styles.lineName} numberOfLines={1}>{item.name}</Text>
                {!!item.modifiers_label && (
                  <Text style={styles.lineMods} numberOfLines={1}>{item.modifiers_label}</Text>
                )}
                <View style={styles.stepper}>
                  <Pressable
                    style={[styles.stepBtn, styles.stepBtnGhost]}
                    onPress={() => cart.setQty(k, item.quantity - step)}
                  >
                    {item.quantity <= step ? (
                      <Trash2 size={14} color={colors.error} strokeWidth={2} />
                    ) : (
                      <Minus size={14} color={colors.gray[600]} strokeWidth={2.4} />
                    )}
                  </Pressable>
                  <Text style={styles.qty}>
                    {fmtQty(item.quantity)}
                    {item.sold_by === "weight" && item.unit_label ? ` ${item.unit_label}` : ""}
                  </Text>
                  <Pressable style={styles.stepBtn} onPress={() => cart.setQty(k, item.quantity + step)}>
                    <Plus size={14} color={colors.white} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>
              <Text style={styles.linePrice}>{money(item.unit_price * item.quantity)}</Text>
            </View>
          );
        }}
        ListFooterComponent={
          <>
            {/* Add more */}
            {!!slug && (
              <Pressable style={styles.addMore} onPress={() => navigation.navigate("MarketShop", { slug })}>
                <Plus size={16} color={colors.brand[600]} strokeWidth={2.4} />
                <Text style={styles.addMoreText}>Add more items</Text>
              </Pressable>
            )}

            {/* Cross-sell */}
            {suggestions.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Popular with your order</Text>
                <Text style={styles.sectionSub}>Other customers also bought these</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.xRow}>
                  {suggestions.map((p) => (
                    <View key={p.id} style={styles.xCard}>
                      <View style={styles.xThumb}>
                        {p.images[0] ? (
                          <Image source={{ uri: p.images[0] }} style={styles.xImg} resizeMode="cover" />
                        ) : (
                          <Text style={styles.xInitial}>{p.name.charAt(0)}</Text>
                        )}
                        <Pressable style={styles.xAdd} onPress={() => addSuggestion(p)}>
                          <Plus size={15} color={colors.white} strokeWidth={2.6} />
                        </Pressable>
                      </View>
                      <Text style={styles.xPrice}>{money(Number(p.price))}</Text>
                      <Text style={styles.xName} numberOfLines={1}>{p.name}</Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
          </>
        }
      />

      {/* Summary + continue — pinned */}
      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <View>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalHint}>Delivery fee and coupons apply at checkout</Text>
          </View>
          <Text style={styles.totalValue}>{money(cart.subtotal())}</Text>
        </View>
        <AppButton
          title="Confirm payment and address"
          onPress={() => slug && navigation.navigate("Checkout", { slug })}
        />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.black, textAlign: "center", paddingTop: spacing.sm },
  shopName: { ...typography.small, color: colors.gray[500], textAlign: "center", marginTop: 1 },
  steps: { marginTop: spacing.sm, marginBottom: spacing.xs },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...typography.h3, color: colors.black },
  emptyText: { ...typography.small, color: colors.gray[500], textAlign: "center" },

  list: { padding: spacing.md, gap: spacing.xs },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  lineThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  lineInitial: { ...typography.title, color: colors.gray[300] },
  lineInfo: { flex: 1, gap: 3 },
  lineName: { ...typography.label, color: colors.black, fontSize: 14.5 },
  lineMods: { ...typography.tiny, color: colors.gray[400] },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    padding: 3,
  },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.brand[500],
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnGhost: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  qty: { ...typography.label, color: colors.black, minWidth: 26, textAlign: "center", fontSize: 13 },
  linePrice: { ...typography.label, color: colors.black, fontSize: 14.5 },

  addMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.md,
  },
  addMoreText: { ...typography.label, color: colors.brand[600], fontSize: 14 },

  sectionTitle: { ...typography.h3, color: colors.black, fontSize: 17 },
  sectionSub: { ...typography.tiny, color: colors.gray[500], marginBottom: spacing.sm },
  xRow: { gap: spacing.sm, paddingBottom: spacing.md },
  xCard: { width: 120 },
  xThumb: {
    height: 96,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  xImg: { width: "100%", height: "100%" },
  xInitial: { fontSize: 28, fontWeight: "700", color: colors.gray[200] },
  xAdd: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.brand[500],
    alignItems: "center",
    justifyContent: "center",
  },
  xPrice: { ...typography.label, color: colors.black, fontSize: 13, marginTop: 5 },
  xName: { ...typography.tiny, color: colors.gray[500] },

  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { ...typography.h3, color: colors.black, fontSize: 16 },
  totalHint: { ...typography.tiny, color: colors.gray[400] },
  totalValue: { ...typography.title, color: colors.brand[600] },
});
