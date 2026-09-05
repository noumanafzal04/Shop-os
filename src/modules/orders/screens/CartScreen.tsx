import React from "react";
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowRight, Minus, Plus, ShoppingBag, TicketPercent, Trash2 } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AddButton } from "../../../common/ui/AddButton";
import { confirm } from "../../../common/ui/confirm";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCartStore, cartKeyOf } from "../../../stores/cartStore";
import { useMarketProducts, useMarketShop } from "../../marketplace/hooks/useMarketplace";
import { shopCover, shopInitial } from "../../marketplace/shopCover";
import type { PublicProduct } from "../../marketplace/services/marketplaceService";
import { money, qtyText } from "../../../common/format";

/**
 * The basket.
 *
 * ── Why this screen is laid out for HEIGHT ────────────────────────────
 *
 * A cart is a screen you check, not one you read. Its whole job is to let
 * somebody see everything they are about to pay for, at once, and press one
 * button — and it was failing that: five lines and you were already scrolling.
 *
 * The space went to chrome, not to the basket. A three-step progress bar
 * (Menu · Cart · Checkout) announcing a step the tab bar was already showing,
 * a row that stacked name / options / stepper three deep for a 56px thumbnail
 * to sit beside, and a footer that spent 140px saying one number and one verb.
 * Together, 330px of a 800px screen before a single item was drawn — and the
 * floating tab bar takes another 98 that it genuinely needs.
 *
 * So each block below is costed:
 *
 *   header    46   one row, the shop's name under the title
 *   line      70   44px thumb, two text lines, stepper and bin INLINE
 *   footer    73   the total and the button on ONE line
 *
 * which fits eight lines instead of five, and means a normal order — three to
 * six things — does not scroll at all.
 */
export function CartScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
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

  /**
   * What this basket costs, as far as the CART can honestly know.
   *
   * The delivery line is the shop's own fee, shown only when the shop delivers
   * at all — a zero fee cannot say whether it does, which is what `delivers`
   * is for. Choosing pickup at the next screen drops it, and the server prices
   * the order either way; this is an estimate and the copy says so.
   */
  const subtotal = cart.subtotal();
  const freeAbove = shop.data?.free_delivery_threshold ?? null;
  const earnedFreeDelivery = freeAbove != null && subtotal >= freeAbove;
  const delivers = shop.data?.delivers ?? shop.data?.fulfillment?.delivery ?? false;
  const deliveryFee = delivers && !earnedFreeDelivery ? (shop.data?.delivery_fee ?? 0) : 0;
  const total = subtotal + deliveryFee;
  /** How much more buys free delivery — the one number that changes a basket. */
  const toFreeDelivery =
    freeAbove != null && !earnedFreeDelivery ? Math.max(0, freeAbove - subtotal) : null;

  const emptyBasket = () => {
    confirm
      .ask({
        title: "Empty your basket?",
        message: "Everything in it will be removed.",
        confirmLabel: "Empty",
        cancelLabel: "Keep it",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) cart.clear();
      })
      .catch(() => {});
  };

  if (cart.lines.length === 0) {
    return (
      <SafeScreen backgroundColor={c.bg} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>Cart</Text>
        </View>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={34} color={c.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Browse shops near you and add something tasty.</Text>
        </View>
      </SafeScreen>
    );
  }

  const count = cart.count();

  return (
    <SafeScreen backgroundColor={c.bg} edges={["top"]}>
      {/*
        One row. The title, the shop the basket belongs to underneath it, and
        emptying on the right — where a destructive action goes, and out of the
        way of the thumb that is about to press Checkout.
      */}
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Cart</Text>
          {!!shop.data && (
            <Text style={styles.shopName} numberOfLines={1}>
              {shop.data.business_name}
            </Text>
          )}
        </View>

        {/*
          Emptying the whole basket, out loud.

          It was only possible by pressing minus on every line until each one
          disappeared — which is not a feature, it is the absence of one that
          people work around.
        */}
        <Pressable
          style={styles.clearBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Empty basket"
          onPress={emptyBasket}
        >
          <Trash2 size={15} color={c.error} strokeWidth={2.2} />
          <Text style={styles.clearText}>Empty</Text>
        </Pressable>
      </View>

      <FlatList
        data={cart.lines}
        keyExtractor={(l) => cartKeyOf(l)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const k = cartKeyOf(item);
          const step = item.sold_by === "weight" ? 0.25 : 1;
          // Same derived cover the shop cards use: a wall of identical pale
          // tiles reads as a page whose images failed, at any size.
          const cover = shopCover(item.product_id);
          const unit = item.sold_by === "weight" && item.unit_label ? ` ${item.unit_label}` : "";
          return (
            <View style={styles.line}>
              <View style={[styles.lineThumb, { backgroundColor: cover.bg }]}>
                <Text style={[styles.lineInitial, { color: cover.fg }]}>{shopInitial(item.name)}</Text>
              </View>

              <View style={styles.lineInfo}>
                <Text style={styles.lineName} numberOfLines={1}>
                  {item.name}
                </Text>
                {/*
                  Price and options on ONE line. They were two, and the options
                  line is empty for most items — so the row was paying for a
                  third line of height that usually had nothing in it.
                */}
                <Text style={styles.lineMeta} numberOfLines={1}>
                  <Text style={styles.linePrice}>{money(item.unit_price * item.quantity)}</Text>
                  {item.modifiers_label ? `  ·  ${item.modifiers_label}` : ""}
                </Text>
              </View>

              <View style={styles.stepper}>
                {/*
                  Minus stays minus. It used to turn into a bin at a quantity
                  of one, so the control changed meaning under the thumb — and
                  removing a line meant noticing that it had. The bin is its
                  own button now, on the right, where a row's actions go.
                */}
                <Pressable
                  style={[styles.stepBtn, styles.stepBtnGhost]}
                  accessibilityRole="button"
                  accessibilityLabel={`Less ${item.name}`}
                  onPress={() => cart.setQty(k, item.quantity - step)}
                >
                  <Minus size={13} color={c.textSecondary} strokeWidth={2.6} />
                </Pressable>
                <Text style={styles.qty}>
                  {qtyText(item.quantity)}
                  {unit}
                </Text>
                <Pressable
                  style={styles.stepBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`More ${item.name}`}
                  onPress={() => cart.setQty(k, item.quantity + step)}
                >
                  <Plus size={13} color={c.onPrimary} strokeWidth={2.6} />
                </Pressable>
              </View>

              <Pressable
                style={styles.lineRemove}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
                onPress={() => cart.setQty(k, 0)}
              >
                <Trash2 size={15} color={c.textMuted} strokeWidth={2} />
              </Pressable>
            </View>
          );
        }}
        ListFooterComponent={
          <>
            {!!slug && (
              <Pressable
                style={styles.addMore}
                accessibilityRole="button"
                onPress={() => navigation.navigate("MarketShop", { slug })}
              >
                <Plus size={15} color={c.primary} strokeWidth={2.6} />
                <Text style={styles.addMoreText}>Add more items</Text>
              </Pressable>
            )}

            {suggestions.length > 0 && (
              <>
                {/*
                  One heading, not two. "Popular with your order" over "Other
                  customers also bought these" said the same thing twice and
                  cost 46px in the middle of the scroll it was interrupting.
                */}
                <Text style={styles.sectionTitle}>Popular with your order</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.xRow}
                >
                  {suggestions.map((p) => {
                    const cover = shopCover(p.id);
                    return (
                      <View key={p.id} style={styles.xCard}>
                        <View style={[styles.xThumb, !p.images[0] && { backgroundColor: cover.bg }]}>
                          {p.images[0] ? (
                            <Image source={{ uri: p.images[0] }} style={styles.xImg} resizeMode="cover" />
                          ) : (
                            <Text style={[styles.xInitial, { color: cover.fg }]}>{shopInitial(p.name)}</Text>
                          )}
                          <AddButton
                            size={26}
                            label={p.name}
                            style={styles.xAdd}
                            onPress={() => addSuggestion(p)}
                          />
                        </View>
                        <Text style={styles.xName} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={styles.xPrice}>{money(Number(p.price))}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </>
        }
      />

      {/*
        The bill, pinned.

        Three lines and a button rather than one number: a basket that shows
        only a subtotal is a basket whose real cost arrives one screen later,
        and the delivery fee is exactly the surprise people back out over.

        Pinned, so it costs the LIST height once and never grows the scroll —
        which is the difference between this and the footer it replaced.
      */}
      <View style={styles.footer}>
        {/*
          The coupon rides WITH the bill, not above it in the scroll.

          It sat after the last item, which is fine for a basket of three and
          invisible for a basket of eleven — the row it was on is a screen and
          a half below the fold, on the one screen where the whole point is
          that nothing important is below the fold.

          What it does is honest about its limits: a code can only be CHECKED
          by the server when the order is placed, so an "Apply" that reported
          success here would be reporting a guess. It opens the box instead.
        */}
        {!!slug && (
          <Pressable
            style={({ pressed }) => [styles.coupon, pressed && styles.couponPressed]}
            accessibilityRole="button"
            onPress={() => navigation.navigate("Checkout", { slug })}
          >
            <View style={styles.couponIcon}>
              <TicketPercent size={15} color={c.onPrimary} strokeWidth={2.3} />
            </View>
            <Text style={styles.couponText}>Have a coupon code?</Text>
            <Text style={styles.couponCta}>Apply</Text>
          </Pressable>
        )}

        <View style={styles.billRow}>
          <Text style={styles.billLabel}>
            Subtotal · {count} {count === 1 ? "item" : "items"}
          </Text>
          <Text style={styles.billValue}>{money(subtotal)}</Text>
        </View>

        {delivers && (
          <View style={styles.billRow}>
            <View style={styles.billLabelCol}>
              <Text style={styles.billLabel}>Delivery</Text>
              {/*
                The one number that changes what somebody buys, said where the
                fee it would remove is written. Drawn only when there IS a
                threshold and it has not been met — "Rs 0 to go" is a sentence
                about nothing.
              */}
              {toFreeDelivery !== null && toFreeDelivery > 0 && (
                <Text style={styles.freeHint}>
                  Add {money(toFreeDelivery)} more for free delivery
                </Text>
              )}
            </View>
            {earnedFreeDelivery ? (
              <Text style={styles.billFree}>FREE</Text>
            ) : (
              <Text style={styles.billValue}>{money(deliveryFee)}</Text>
            )}
          </View>
        )}

        <View style={styles.billRule} />

        <View style={styles.billRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{money(total)}</Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          onPress={() => slug && navigation.navigate("Checkout", { slug })}
        >
          <Text style={styles.ctaText}>Checkout now</Text>
          <ArrowRight size={17} color={c.onPrimary} strokeWidth={2.6} />
        </Pressable>
      </View>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
      gap: spacing.sm,
    },
    headerCopy: { flex: 1 },
    title: { ...typography.title, color: c.text },
    shopName: { ...typography.tiny, color: c.textSecondary, marginTop: 1 },
    clearBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
    clearText: { ...typography.tiny, color: c.error, fontWeight: "700" },

    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
    },
    emptyIcon: {
      width: 84,
      height: 84,
      borderRadius: radius.full,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    emptyTitle: { ...typography.h3, color: c.text },
    emptyText: { ...typography.small, color: c.textSecondary, textAlign: "center" },

    list: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: 6 },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    lineThumb: {
      width: 44,
      height: 44,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    lineInitial: { fontSize: 19, fontWeight: "700" },
    lineInfo: { flex: 1, gap: 2 },
    lineName: { ...typography.label, color: c.text, fontSize: 14 },
    lineMeta: { ...typography.tiny, color: c.textMuted },
    linePrice: { color: c.text, fontWeight: "700" },

    stepper: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.full,
      padding: 3,
      gap: 3,
    },
    stepBtn: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    stepBtnGhost: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    qty: { ...typography.tiny, color: c.text, fontWeight: "700", minWidth: 22, textAlign: "center" },
    lineRemove: { padding: 2 },

    addMore: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: spacing.sm,
      paddingVertical: 11,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: c.border,
    },
    addMoreText: { ...typography.label, color: c.primary, fontSize: 13.5 },

    sectionTitle: { ...typography.h3, color: c.text, fontSize: 15, marginTop: spacing.md, marginBottom: spacing.sm },
    xRow: { gap: spacing.sm, paddingBottom: spacing.xs },
    xCard: { width: 104 },
    xThumb: {
      height: 72,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    xImg: { width: "100%", height: "100%" },
    xInitial: { fontSize: 24, fontWeight: "700" },
    // Position only — the disc itself is `AddButton`, which owns its own
    // colour and its own press.
    xAdd: { position: "absolute", right: 5, bottom: 5 },
    xName: { ...typography.tiny, color: c.text, fontWeight: "600", marginTop: 5 },
    xPrice: { ...typography.tiny, color: c.textMuted },

    // Sized to ride inside the bill without pushing a row off the list: 38px
    // and a hairline, not a 52px panel.
    coupon: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      height: 38,
      paddingHorizontal: 8,
      marginBottom: 8,
      borderRadius: radius.md,
      backgroundColor: c.primarySoft,
    },
    couponPressed: { opacity: 0.75 },
    couponIcon: {
      width: 26,
      height: 26,
      borderRadius: radius.full,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    couponText: { ...typography.tiny, color: c.text, fontWeight: "700", flex: 1 },
    couponCta: {
      ...typography.tiny,
      color: c.onPrimary,
      fontWeight: "800",
      backgroundColor: c.primary,
      borderRadius: radius.full,
      paddingHorizontal: 12,
      paddingVertical: 5,
      overflow: "hidden",
    },
    billLabelCol: { flex: 1 },
    freeHint: { ...typography.tiny, color: c.warm, fontWeight: "700", marginTop: 1 },

    footer: {
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: spacing.md,
      paddingTop: 10,
      paddingBottom: 12,
    },
    billRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 2 },
    billLabel: { ...typography.small, color: c.textSecondary },
    billValue: { ...typography.small, color: c.text, fontWeight: "600" },
    billFree: { ...typography.small, color: c.success, fontWeight: "800" },
    billRule: { height: 1, backgroundColor: c.border, marginVertical: 7 },
    totalLabel: { ...typography.h3, color: c.text, fontSize: 16 },
    totalValue: { ...typography.title, fontSize: 21, color: c.primary },
    cta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      backgroundColor: c.primary,
      borderRadius: radius.md,
      height: 50,
      marginTop: 10,
    },
    ctaPressed: { backgroundColor: c.primaryPressed },
    ctaText: { ...typography.label, color: c.onPrimary, fontSize: 15 },
  });
