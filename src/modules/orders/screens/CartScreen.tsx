import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  BagIcon,
  PlusIcon,
  TrashIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { AddButton } from "../../../common/ui/AddButton";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { Appear } from "../../../common/ui/Appear";
import { Price } from "../../../common/ui/Price";
import { confirm } from "../../../common/ui/confirm";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCartStore, cartKeyOf } from "../../../stores/cartStore";
import { useMarketProducts, useMarketShop } from "../../marketplace/hooks/useMarketplace";
import { shopInitial, useShopCover } from "../../marketplace/shopCover";
import type { PublicProduct } from "../../marketplace/services/marketplaceService";
import { money, qtyText } from "../../../common/format";
import { QtyStepper } from "../../marketplace/components/QtyStepper";

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
  const coverFor = useShopCover();
  const slug = cart.shopSlug;

  const shop = useMarketShop(slug ?? undefined);
  // "See summary" scrolls to the bill. Above the empty-basket return, so the
  // hooks run in the same order on every render.
  const scrollRef = React.useRef<ScrollView>(null);
  const billY = React.useRef(0);
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
      image: p.images[0] ?? null,
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
        <EmptyState
          icon={BagIcon}
          title="Your cart is empty"
          message="Browse shops near you and add something. Your basket holds one shop at a time, so it all arrives together."
          /*
            A WAY OUT. The cart is a leaf of the tab bar — no back arrow — and
            this state used to tell somebody to go browsing while giving them
            nothing to press.
          */
          action={{ label: "Browse shops", onPress: () => navigation.navigate("FoodTab") }}
        />
      </SafeScreen>
    );
  }

  const count = cart.count();
  const minOrder = delivers ? (shop.data?.min_order_amount ?? null) : null;
  const toMinimum = minOrder != null && subtotal < minOrder ? minOrder - subtotal : null;
  const prep = shop.data?.prep_time_minutes ?? null;

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
          <TrashIcon size={15} color={c.error} />
          <Text style={styles.clearText}>Empty</Text>
        </Pressable>
      </View>

      {/*
        ── EVERYTHING SCROLLS; ONLY THE TOTAL AND THE BUTTON STAY ──────

        The bill used to be pinned — a coupon box, three bill rows, a rule, the
        total and the button — and on a phone it took four tenths of the
        screen, so the basket itself showed two lines at a time. The bill is a
        card in the scroll now, like every marketplace cart; what is pinned is
        the one number and the one press that move the order on.
      */}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {delivers && prep !== null && (
          <View style={styles.timePill}>
            <Text style={styles.timeText}>
              Delivery: <Text style={styles.timeStrong}>{prep} – {prep + 20} min</Text>
            </Text>
          </View>
        )}
        <View style={styles.card}>
          {cart.lines.map((item, index) => {
            const k = cartKeyOf(item);
            const step = item.sold_by === "weight" ? 0.25 : 1;
            const cover = coverFor(item.product_id);
            const unit = item.sold_by === "weight" && item.unit_label ? ` ${item.unit_label}` : "";
            return (
              <Appear key={k} index={index}>
                <View style={[styles.line, index > 0 && styles.lineRule]}>
                  <SmartImage
                    uri={item.image}
                    fallback={shopInitial(item.name)}
                    fallbackBackground={cover.bg}
                    fallbackColor={cover.fg}
                    style={styles.lineThumb}
                  />
                  <View style={styles.lineInfo}>
                    <Text style={styles.lineName} numberOfLines={2}>
                      {item.name}
                    </Text>
                    {!!item.modifiers_label && (
                      <Text style={styles.lineMeta} numberOfLines={2}>
                        {item.modifiers_label}
                      </Text>
                    )}
                    <View style={styles.lineFoot}>
                  {/*
                    The same − n + the menu row has, so a quantity is changed
                    the same way wherever it is seen. At the last step the
                    minus is a bin: the next press removes the line.
                  */}
                  <QtyStepper
                    value={item.quantity}
                    display={`${qtyText(item.quantity)}${unit}`}
                    last={item.quantity - step <= 0}
                    label={item.name}
                    onMinus={() => cart.setQty(k, item.quantity - step)}
                    onPlus={() => cart.setQty(k, item.quantity + step)}
                  />
                      <Text style={styles.linePrice}>{money(item.unit_price * item.quantity)}</Text>
                    </View>
                  </View>
                </View>
              </Appear>
            );
          })}

        </View>

        {!!slug && (
          <Touchable
            style={styles.addMore}
            accessibilityRole="button"
            onPress={() => navigation.navigate("MarketShop", { slug })}
          >
            <PlusIcon size={16} color={c.text} />
            <Text style={styles.addMoreText}>Add more items</Text>
          </Touchable>
        )}

        {suggestions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Popular with your order</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.xRow}>
              {suggestions.map((p) => {
                const cover = coverFor(p.id);
                return (
                  <Touchable
                    key={p.id}
                    style={styles.xCard}
                    scaleTo={0.95}
                    accessibilityRole="button"
                    accessibilityLabel={p.name}
                    onPress={() => addSuggestion(p)}
                  >
                    <View style={styles.xThumb}>
                      <SmartImage
                        uri={p.images[0] ?? null}
                        fallback={shopInitial(p.name)}
                        fallbackBackground={cover.bg}
                        fallbackColor={cover.fg}
                        style={styles.xImg}
                      />
                      <AddButton size={28} label={p.name} style={styles.xAdd} onPress={() => addSuggestion(p)} />
                    </View>
                    <Text style={styles.xName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Price value={p.price} was={p.original_price} size="sm" />
                  </Touchable>
                );
              })}
            </ScrollView>
          </>
        )}

        {/*
          What stands between this basket and a delivery, said with the
          number: the shop's minimum first (it decides whether the order can
          go at all), then the free-delivery line (it only changes the fee).
        */}
        {toMinimum !== null && (
          <View style={styles.nudge}>
            <Text style={styles.nudgeText}>
              Add {money(toMinimum)} more to reach the minimum order of {money(minOrder ?? 0)} for delivery
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (subtotal / (minOrder ?? 1)) * 100)}%` }]} />
            </View>
          </View>
        )}
        {toMinimum === null && toFreeDelivery !== null && toFreeDelivery > 0 && (
          <View style={[styles.nudge, styles.nudgeDeal]}>
            <Text style={styles.nudgeDealText}>Add {money(toFreeDelivery)} more for free delivery</Text>
            <View style={styles.track}>
              <View style={[styles.fill, styles.fillDeal, { width: `${Math.min(100, (subtotal / (freeAbove ?? 1)) * 100)}%` }]} />
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle} onLayout={(e) => (billY.current = e.nativeEvent.layout.y)}>
          Bill details
        </Text>
        <View style={[styles.card, styles.bill]}>
          <View style={styles.billRow}>
            <Text style={styles.billLabel}>
              Subtotal · {count} {count === 1 ? "item" : "items"}
            </Text>
            <Text style={styles.billValue}>{money(subtotal)}</Text>
          </View>
          {delivers && (
            <View style={styles.billRow}>
              <Text style={styles.billLabel}>Delivery fee</Text>
              {earnedFreeDelivery ? (
                <Text style={styles.billFree}>Free</Text>
              ) : (
                <Text style={styles.billValue}>{money(deliveryFee)}</Text>
              )}
            </View>
          )}
          <Text style={styles.billNote}>Coupons and the final total are worked out at checkout.</Text>
        </View>
      </ScrollView>

      {/*
        The one number and the one press — on a card that rises off the
        page, the way the reference cart ends: the total with what it
        includes, a link down to the bill, and the button.
      */}
      <View style={styles.footer}>
        <View style={styles.footerTotal}>
          <View>
            <Text style={styles.totalLabel}>
              Total <Text style={styles.totalHint}>(incl. delivery)</Text>
            </Text>
            <Text
              style={styles.summaryLink}
              accessibilityRole="link"
              onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, billY.current - 12), animated: true })}
            >
              See summary
            </Text>
          </View>
          <Text style={styles.totalValue}>{money(total)}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          onPress={() => slug && navigation.navigate("Checkout", { slug })}
        >
          <Text style={styles.ctaText}>Confirm payment and address</Text>
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
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    headerCopy: { flex: 1 },
    title: { ...typography.title, color: c.text },
    shopName: { ...typography.small, color: c.textSecondary, marginTop: 2 },
    clearBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
    clearText: { ...typography.caption, color: c.error, fontWeight: "700" },

    scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.ms },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    timePill: {
      backgroundColor: c.surface,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
    },
    timeText: { ...typography.body, color: c.text },
    timeStrong: { fontWeight: "700" },
    line: { flexDirection: "row", alignItems: "flex-start", gap: spacing.ms, padding: spacing.ms },
    // Dashed between lines, as the reference does: a list of things, not cards.
    lineRule: { borderTopWidth: 1, borderTopColor: c.border, borderStyle: "dashed" },
    lineFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
    lineThumb: { width: 56, height: 56, borderRadius: radius.xs },
    lineInfo: { flex: 1, gap: 2 },
    lineName: { ...typography.label, color: c.text, fontSize: 15, lineHeight: 20 },
    lineMeta: { ...typography.caption, color: c.textSecondary },
    linePrice: { ...typography.price, color: c.text },

    addMore: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
    },
    addMoreText: { ...typography.label, color: c.text },

    sectionTitle: { ...typography.h3, color: c.text, marginTop: spacing.sm },
    xRow: { gap: spacing.ms, paddingRight: spacing.md },
    xCard: { width: 128, gap: 4 },
    xThumb: { width: 128, height: 104, borderRadius: radius.sm, overflow: "hidden" },
    xImg: { width: "100%", height: "100%" },
    xAdd: { position: "absolute", right: 6, bottom: 6 },
    xName: { ...typography.label, color: c.text, fontSize: 13, lineHeight: 18 },

    nudge: { backgroundColor: c.warningBg, borderRadius: radius.sm, padding: spacing.ms, gap: spacing.sm },
    nudgeText: { ...typography.small, color: c.warning, fontWeight: "600" },
    nudgeDeal: { backgroundColor: c.warmSoft },
    nudgeDealText: { ...typography.small, color: c.onWarm, fontWeight: "600" },
    track: { height: 4, borderRadius: 2, backgroundColor: c.surface, overflow: "hidden" },
    fill: { height: 4, borderRadius: 2, backgroundColor: c.warning },
    fillDeal: { backgroundColor: c.warm },

    bill: { padding: spacing.md, gap: spacing.sm },
    billRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    billLabel: { ...typography.body, color: c.textSecondary },
    billValue: { ...typography.price, color: c.text },
    billFree: { ...typography.price, color: c.success },
    billNote: { ...typography.caption, color: c.textMuted },

    footer: {
      backgroundColor: c.surface,
      marginHorizontal: spacing.sm,
      marginBottom: spacing.sm,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.ms,
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: -2 },
      elevation: 10,
    },
    footerTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    totalLabel: { ...typography.name, color: c.text, fontWeight: "700" },
    totalHint: { ...typography.caption, color: c.textSecondary, fontWeight: "400" },
    summaryLink: { ...typography.small, color: c.text, textDecorationLine: "underline", marginTop: 2 },
    totalValue: { ...typography.total, color: c.text },
    cta: {
      height: 52,
      borderRadius: 26,
      backgroundColor: c.primary,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    ctaPressed: { opacity: 0.88 },
    ctaText: { ...typography.button, color: c.onPrimary },
  });
