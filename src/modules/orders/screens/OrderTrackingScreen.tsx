import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { ArrowLeft, Check, MapPin } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppButton } from "../../../common/ui/AppButton";
import { Skeleton } from "../../../common/ui/Skeleton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useCancelMyOrder, useMyOrder, type OrderStatus } from "../hooks/useOrders";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;
type Params = { Order: { id: string } };

const STEP_LABELS: Record<string, string> = {
  pending: "Order placed",
  confirmed: "Confirmed by shop",
  preparing: "Being prepared",
  ready: "Ready for pickup",
  out_for_delivery: "On the way",
  completed: "Delivered",
};

const stepsFor = (fulfillment: "delivery" | "pickup"): OrderStatus[] =>
  fulfillment === "delivery"
    ? ["pending", "confirmed", "preparing", "out_for_delivery", "completed"]
    : ["pending", "confirmed", "preparing", "ready", "completed"];

/** Live order tracking — the screen a push-notification tap lands on. */
export function OrderTrackingScreen() {
  const navigation = useNavigation<any>();
  const { id } = useRoute<RouteProp<Params, "Order">>().params;
  const order = useMyOrder(id);
  const cancel = useCancelMyOrder();
  const o = order.data;

  const askCancel = () => {
    Alert.alert("Cancel order", `Cancel ${o?.order_number}?`, [
      { text: "Keep", style: "cancel" },
      { text: "Cancel it", style: "destructive", onPress: () => cancel.mutate(id) },
    ]);
  };

  const steps = o ? stepsFor(o.fulfillment_type) : [];
  const cancelled = o?.status === "cancelled";
  const currentIdx = o ? steps.indexOf(o.status) : -1;

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={colors.black} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Order Track</Text>
        <View style={styles.back} />
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
                          {done && <Check size={11} color={colors.white} strokeWidth={3.2} />}
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
                <MapPin size={16} color={colors.brand[600]} strokeWidth={2.2} />
                <Text style={styles.addrText}>{o.delivery_address}</Text>
              </View>
            </View>
          )}

          {/* Items */}
          <View style={styles.card}>
            {o.items.map((it, i) => (
              <View key={i} style={styles.itemRow}>
                <Text style={styles.itemQty}>{it.quantity}×</Text>
                <Text style={styles.itemName} numberOfLines={1}>
                  {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ""}
                </Text>
                <Text style={styles.itemTotal}>{money(it.line_total)}</Text>
              </View>
            ))}
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

          {(o.status === "pending" || o.status === "confirmed") && (
            <AppButton title="Cancel order" variant="outline" onPress={askCancel} loading={cancel.isPending} />
          )}
        </ScrollView>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h3, color: colors.black },
  content: { padding: spacing.md, gap: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  orderNo: { ...typography.h3, color: colors.black },
  shopName: { ...typography.small, color: colors.gray[500], marginTop: 2 },
  total: { ...typography.title, fontSize: 18, color: colors.brand[600] },

  cancelledBox: { backgroundColor: colors.errorBg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  cancelledText: { ...typography.small, color: colors.error, fontWeight: "600" },

  timeline: { marginTop: spacing.md },
  stepRow: { flexDirection: "row", gap: spacing.sm },
  stepRail: { alignItems: "center", width: 22 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.gray[200],
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: colors.brand[500], borderColor: colors.brand[500] },
  dotActive: { borderColor: colors.brand[300], borderWidth: 3 },
  rail: { width: 2, flex: 1, minHeight: 22, backgroundColor: colors.gray[200] },
  railDone: { backgroundColor: colors.brand[500] },
  stepBody: { flex: 1, paddingBottom: spacing.md },
  stepLabel: { ...typography.body, color: colors.gray[400], fontSize: 14 },
  stepLabelDone: { color: colors.black, fontWeight: "500" },
  stepLabelActive: { fontWeight: "700", color: colors.brand[700] },
  stepHint: { ...typography.tiny, color: colors.gray[400], marginTop: 1 },

  addrRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addrText: { ...typography.small, color: colors.gray[600], flex: 1 },

  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  itemQty: { ...typography.label, color: colors.brand[600], width: 30 },
  itemName: { ...typography.body, color: colors.black, flex: 1, fontSize: 14 },
  itemTotal: { ...typography.small, color: colors.gray[600] },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sumLabel: { ...typography.small, color: colors.gray[600] },
  grand: { ...typography.label, color: colors.black, fontSize: 15 },
});
