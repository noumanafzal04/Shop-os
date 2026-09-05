import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { ArrowLeft, Check, MapPin, Phone } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { useMarketShop } from "../../marketplace/hooks/useMarketplace";
import { Skeleton } from "../../../common/ui/Skeleton";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCancelMyOrder, useMyOrder, type OrderStatus } from "../hooks/useOrders";
import { money, qtyText } from "../../../common/format";

type Params = { Order: { id: string } };

const STEP_LABELS: Record<string, string> = {
  pending: "Order placed",
  confirmed: "Confirmed by shop",
  preparing: "Being prepared",
  ready: "Ready for pickup",
  out_for_delivery: "On the way",
  completed: "Delivered",
};

/**
 * Where the order is, in the words somebody would use.
 *
 * The timeline already carries this, one step at a time and in the same size
 * as the four steps that have not happened. A person opening this screen is
 * asking ONE question, and it deserves to be the largest thing here.
 */
const HEADLINE: Record<string, string> = {
  pending: "Waiting for the shop",
  confirmed: "Accepted by the shop",
  preparing: "Being prepared",
  ready: "Ready for pickup",
  out_for_delivery: "On the way to you",
  completed: "Delivered",
  cancelled: "Cancelled",
};

/** How many item lines before the rest are summarised — see `OrdersScreen`. */
const ITEMS_SHOWN = 4;

const stepsFor = (fulfillment: "delivery" | "pickup"): OrderStatus[] =>
  fulfillment === "delivery"
    ? ["pending", "confirmed", "preparing", "out_for_delivery", "completed"]
    : ["pending", "confirmed", "preparing", "ready", "completed"];

/** Live order tracking — the screen a push-notification tap lands on. */
export function OrderTrackingScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const { id } = useRoute<RouteProp<Params, "Order">>().params;
  const order = useMyOrder(id);
  const cancel = useCancelMyOrder();
  const o = order.data;

  // The shop's own record, for its phone number. The order payload does not
  // carry one, and the Help Centre tells people the number is on this screen.
  const shop = useMarketShop(o?.shop?.slug ?? undefined);
  const phone = shop.data?.phone ?? null;

  const askCancel = () => {
    // The app's own sheet, not `Alert.alert`. A system dialog is the thing
    // people dismiss without reading, and this one destroys an order.
    confirm
      .ask({
        title: "Cancel this order?",
        message: `${o?.order_number} will be cancelled. The shop has not started it yet.`,
        confirmLabel: "Cancel it",
        cancelLabel: "Keep it",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) cancel.mutate(id);
      })
      .catch(() => {});
  };

  const callShop = () => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      toast.error("Could not open the dialler", { detail: phone });
    });
  };

  const steps = o ? stepsFor(o.fulfillment_type) : [];
  const cancelled = o?.status === "cancelled";
  const currentIdx = o ? steps.indexOf(o.status) : -1;

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={c.text} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Order</Text>
        {/*
          A SPACER, so the title sits centred between two equal margins. It
          used to reuse `styles.back`, which carries a surface fill and a
          border — so the balancing gap rendered as a white circle floating in
          the top right with nothing in it.
        */}
        <View style={styles.headerSpacer} />
      </View>

      {order.isLoading || !o ? (
        <View style={styles.content}>
          <Skeleton width="100%" height={200} borderRadius={radius.lg} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Status card */}
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View>
                <Text style={styles.orderNo}>{o.order_number}</Text>
                <Text style={styles.shopName}>{o.shop?.business_name}</Text>
              </View>
              <Text style={styles.total}>{money(o.total)}</Text>
            </View>

            <Text style={styles.headline}>
              {HEADLINE[o.status] ?? "In progress"}
            </Text>

            {cancelled ? (
              <View style={styles.cancelledBox}>
                <Text style={styles.cancelledText}>This order was cancelled.</Text>
              </View>
            ) : (
              <View style={styles.timeline}>
                {steps.map((s, i) => {
                  const done = i <= currentIdx;
                  const active = i === currentIdx;
                  const last = i === steps.length - 1;
                  return (
                    <View key={s} style={styles.stepRow}>
                      <View style={styles.stepRail}>
                        <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
                          {done && <Check size={11} color={c.white} strokeWidth={3.2} />}
                        </View>
                        {!last && <View style={[styles.rail, i < currentIdx && styles.railDone]} />}
                      </View>
                      <View style={styles.stepBody}>
                        <Text style={[styles.stepLabel, done && styles.stepLabelDone, active && styles.stepLabelActive]}>
                          {STEP_LABELS[s]}
                        </Text>
                        {active && !["completed"].includes(s) && (
                          <Text style={styles.stepHint}>We'll notify you at every update</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Delivery info */}
          {o.fulfillment_type === "delivery" && !!o.delivery_address && (
            <View style={styles.card}>
              <View style={styles.addrRow}>
                <MapPin size={16} color={c.brand[600]} strokeWidth={2.2} />
                <Text style={styles.addrText}>{o.delivery_address}</Text>
              </View>
            </View>
          )}

          {/* Items */}
          <View style={styles.card}>
            {/*
              Capped, for the same reason the orders list is: a grocery order
              of thirty lines turns a tracking screen into a receipt, and the
              status it exists to show scrolls off the top.
            */}
            {o.items.slice(0, ITEMS_SHOWN).map((it, i) => (
              <View key={i} style={styles.itemRow}>
                <Text style={styles.itemQty} numberOfLines={1}>{qtyText(it.quantity)}×</Text>
                <Text style={styles.itemName} numberOfLines={1}>
                  {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ""}
                </Text>
                <Text style={styles.itemTotal}>{money(it.line_total)}</Text>
              </View>
            ))}
            {o.items.length > ITEMS_SHOWN && (
              <Text style={styles.itemsMore}>
                +{o.items.length - ITEMS_SHOWN} more{" "}
                {o.items.length - ITEMS_SHOWN === 1 ? "item" : "items"}
              </Text>
            )}
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Subtotal</Text>
              <Text style={styles.sumLabel}>{money(o.subtotal)}</Text>
            </View>
            {Number(o.delivery_fee) > 0 && (
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>Delivery</Text>
                <Text style={styles.sumLabel}>{money(o.delivery_fee)}</Text>
              </View>
            )}
            <View style={styles.sumRow}>
              <Text style={styles.grand}>Total (COD)</Text>
              <Text style={styles.grand}>{money(o.total)}</Text>
            </View>
          </View>

          {/*
            Only while the order is still a REQUEST. Once the shop accepts it,
            the shop has committed a slot, stock and sometimes a rider — and
            the server refuses a cancel past that point, so offering the button
            would be offering a refusal.
          */}
          {!!phone && !cancelled && o.status !== "completed" && (
            <Pressable style={styles.call} accessibilityRole="button" onPress={callShop}>
              <Phone size={17} color={c.primary} strokeWidth={2.3} />
              <Text style={styles.callText}>Call {o.shop?.business_name ?? "the shop"}</Text>
            </Pressable>
          )}

          {o.status === "pending" && (
            <AppButton title="Cancel order" variant="outline" onPress={askCancel} loading={cancel.isPending} />
          )}
          {o.status === "confirmed" && (
            <Text style={styles.acceptedNote}>
              {o.shop?.business_name ?? "The shop"} has accepted this order. Call them if
              you need to change it.
            </Text>
          )}
        </ScrollView>
      )}
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
    paddingVertical: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSpacer: { width: 40 },
  headline: { ...typography.title, fontSize: 20, color: c.text, marginTop: spacing.sm },
  itemsMore: { ...typography.tiny, color: c.textMuted, paddingVertical: 4 },
  call: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.primary,
    backgroundColor: c.primarySoft,
  },
  callText: { ...typography.label, color: c.primary, fontSize: 14 },
  acceptedNote: { ...typography.small, color: c.textSecondary, textAlign: "center" },
  title: { ...typography.h3, color: c.text },
  content: { padding: spacing.md, gap: spacing.sm },

  card: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  orderNo: { ...typography.h3, color: c.text },
  shopName: { ...typography.small, color: c.gray[500], marginTop: 2 },
  total: { ...typography.title, fontSize: 18, color: c.brand[600] },

  cancelledBox: { backgroundColor: c.errorBg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  cancelledText: { ...typography.small, color: c.error, fontWeight: "600" },

  timeline: { marginTop: spacing.md },
  stepRow: { flexDirection: "row", gap: spacing.sm },
  stepRail: { alignItems: "center", width: 22 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  dotActive: { borderColor: c.brand[300], borderWidth: 3 },
  rail: { width: 2, flex: 1, minHeight: 22, backgroundColor: c.gray[200] },
  railDone: { backgroundColor: c.brand[500] },
  stepBody: { flex: 1, paddingBottom: spacing.md },
  stepLabel: { ...typography.body, color: c.gray[400], fontSize: 14 },
  stepLabelDone: { color: c.text, fontWeight: "500" },
  stepLabelActive: { fontWeight: "700", color: c.brand[700] },
  stepHint: { ...typography.tiny, color: c.gray[400], marginTop: 1 },

  addrRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addrText: { ...typography.small, color: c.gray[600], flex: 1 },

  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  itemQty: { ...typography.label, color: c.primary, minWidth: 34 },
  itemName: { ...typography.body, color: c.text, flex: 1, fontSize: 14 },
  itemTotal: { ...typography.small, color: c.gray[600] },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  sumLabel: { ...typography.small, color: c.gray[600] },
  grand: { ...typography.label, color: c.text, fontSize: 15 },
});
