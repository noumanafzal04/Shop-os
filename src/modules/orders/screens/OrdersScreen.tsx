import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Bike, ReceiptText, Store } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { SkeletonStatusCard } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useMyOrders } from "../hooks/useOrders";
import { SignInWall } from "../../auth/components/SignInWall";
import { useAuthStore } from "../../../stores/authStore";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { money, qtyText } from "../../../common/format";

/** How many lines a card shows before it stops and counts the rest. */
const ITEMS_SHOWN = 2;


const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#fffaeb", fg: "#b54708" },
  confirmed: { bg: "#eff8ff", fg: "#175cd3" },
  preparing: { bg: "#eff8ff", fg: "#175cd3" },
  ready: { bg: "#eff8ff", fg: "#175cd3" },
  out_for_delivery: { bg: "#eff8ff", fg: "#175cd3" },
  completed: { bg: "#ecfdf3", fg: "#027a48" },
  cancelled: { bg: "#fef3f2", fg: "#b42318" },
};

export function OrdersScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const status = useAuthStore((s) => s.status);
  const orders = useMyOrders();
  const pull = usePullToRefresh(orders.refetch);
  const rows = orders.data?.data ?? [];

  if (status !== "authenticated") {
    return (
      <SafeScreen backgroundColor={c.bg} edges={["top"]}>
        <SignInWall
          icon={ReceiptText}
          title="Your orders live in your account"
          message="Sign in to see what you've ordered, follow a delivery, or order it again."
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen backgroundColor={c.bg} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
        <Text style={styles.sub}>Tap an order to track it live</Text>
      </View>

      {orders.isLoading ? (
        <View style={styles.list}><SkeletonStatusCard footer /><SkeletonStatusCard footer /></View>
      ) : orders.isError ? (
        <LoadFailed
          what="your orders"
          error={orders.error}
          onRetry={() => orders.refetch()}
          retrying={orders.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
          renderItem={({ item }) => {
            const badge = STATUS_STYLE[item.status] ?? STATUS_STYLE.pending;
            // No long-press-to-cancel. It was invisible, it was on every order
            // whatever its state, and a gesture nobody can see is not a control
            // — it is a way to cancel an order by accident. Cancelling lives on
            // the order's own screen, where its state is on show.
            return (
              <Pressable style={styles.card} onPress={() => navigation.navigate("Order", { id: item.id })}>
                <View style={styles.top}>
                  <Text style={styles.num}>{item.order_number}</Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeTxt, { color: badge.fg }]}>{item.status.replace(/_/g, " ")}</Text>
                  </View>
                </View>
                <Text style={styles.shop}>{item.shop?.business_name}</Text>

                {/*
                  Two lines, then a count.
                  
                  It listed every line, so a weekly grocery run of fourteen
                  items made a card taller than the screen — and a list of
                  orders where one order fills the screen has stopped being a
                  list. The full contents are one tap away on the order itself;
                  what this card is for is telling them apart.
                */}
                {item.items.slice(0, ITEMS_SHOWN).map((it, i) => (
                  <Text key={i} style={styles.item} numberOfLines={1}>
                    {qtyText(it.quantity)} × {it.product_name}
                    {it.variant_name ? ` (${it.variant_name})` : ""}
                  </Text>
                ))}
                {item.items.length > ITEMS_SHOWN && (
                  <Text style={styles.itemMore}>
                    +{item.items.length - ITEMS_SHOWN} more{" "}
                    {item.items.length - ITEMS_SHOWN === 1 ? "item" : "items"}
                  </Text>
                )}

                <View style={styles.footer}>
                  <View style={styles.metaRow}>
                    {item.fulfillment_type === "delivery" ? (
                      <Bike size={14} color={c.textSecondary} strokeWidth={2.2} />
                    ) : (
                      <Store size={14} color={c.textSecondary} strokeWidth={2.2} />
                    )}
                    <Text style={styles.meta}>
                      {item.fulfillment_type === "delivery" ? "Delivery" : "Pick-up"}
                    </Text>
                  </View>
                  <Text style={styles.total}>{money(item.total)}</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No orders yet</Text>
              <Text style={styles.emptyText}>Browse the Market and add items to your cart.</Text>
            </View>
          }
        />
      )}
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  header: { padding: spacing.md },
  title: { ...typography.title, fontSize: 22, color: c.gray[900] },
  sub: { ...typography.small, color: c.gray[500], marginTop: 2 },
  list: { padding: spacing.md, paddingTop: 0 },
  card: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, marginBottom: spacing.sm },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  num: { ...typography.label, fontSize: 15, color: c.gray[900] },
  badge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  shop: { ...typography.small, color: c.gray[500], marginTop: 2, marginBottom: spacing.sm },
  item: { ...typography.small, color: c.gray[700] },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  itemMore: { ...typography.small, color: c.textMuted, fontWeight: "600", marginTop: 2 },
  meta: { ...typography.small, color: c.gray[500] },
  total: { ...typography.label, color: c.gray[900] },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: c.gray[700] },
  emptyText: { ...typography.small, color: c.gray[500], marginTop: spacing.xs },
});
