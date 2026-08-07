import React from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { SkeletonCard } from "../../../common/ui/Skeleton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useCancelMyOrder, useMyOrders, type CustomerOrder } from "../hooks/useOrders";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

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
  const navigation = useNavigation<any>();
  const orders = useMyOrders();
  const cancel = useCancelMyOrder();
  const rows = orders.data?.data ?? [];

  const askCancel = (o: CustomerOrder) => {
    if (o.status !== "pending" && o.status !== "confirmed") return;
    Alert.alert("Cancel order", `Cancel ${o.order_number}?`, [
      { text: "Keep", style: "cancel" },
      { text: "Cancel it", style: "destructive", onPress: () => cancel.mutate(o.id) },
    ]);
  };

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
        <Text style={styles.sub}>Tap an order to track it live</Text>
      </View>

      {orders.isLoading ? (
        <View style={styles.list}><SkeletonCard /><SkeletonCard /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} />}
          renderItem={({ item }) => {
            const badge = STATUS_STYLE[item.status] ?? STATUS_STYLE.pending;
            return (
              <Pressable style={styles.card} onPress={() => navigation.navigate("Order", { id: item.id })} onLongPress={() => askCancel(item)}>
                <View style={styles.top}>
                  <Text style={styles.num}>{item.order_number}</Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeTxt, { color: badge.fg }]}>{item.status.replace(/_/g, " ")}</Text>
                  </View>
                </View>
                <Text style={styles.shop}>{item.shop?.business_name}</Text>
                {item.items.map((it, i) => (
                  <Text key={i} style={styles.item}>
                    {it.quantity} × {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ""}
                  </Text>
                ))}
                <View style={styles.footer}>
                  <Text style={styles.meta}>{item.fulfillment_type === "delivery" ? "🚚 Delivery" : "🏬 Pickup"}</Text>
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

const styles = StyleSheet.create({
  header: { padding: spacing.md },
  title: { ...typography.title, fontSize: 22, color: colors.gray[900] },
  sub: { ...typography.small, color: colors.gray[500], marginTop: 2 },
  list: { padding: spacing.md, paddingTop: 0 },
  card: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gray[200], padding: spacing.md, marginBottom: spacing.sm },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  num: { ...typography.label, fontSize: 15, color: colors.gray[900] },
  badge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  shop: { ...typography.small, color: colors.gray[500], marginTop: 2, marginBottom: spacing.sm },
  item: { ...typography.small, color: colors.gray[700] },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray[100], paddingTop: spacing.sm },
  meta: { ...typography.small, color: colors.gray[500] },
  total: { ...typography.label, color: colors.gray[900] },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: colors.gray[700] },
  emptyText: { ...typography.small, color: colors.gray[500], marginTop: spacing.xs },
});
