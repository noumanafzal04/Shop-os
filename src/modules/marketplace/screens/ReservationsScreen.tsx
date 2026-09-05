import React from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { SkeletonStatusCard } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCancelReservation, useCustomerReservations } from "../hooks/useMarketplace";
import type { CustomerReservation } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { money } from "../../../common/format";


const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#fffaeb", fg: "#b54708" },
  accepted: { bg: "#eff8ff", fg: "#175cd3" },
  completed: { bg: "#ecfdf3", fg: "#027a48" },
  rejected: { bg: "#fef3f2", fg: "#b42318" },
  cancelled: { bg: "#f2f4f7", fg: "#475467" },
  expired: { bg: "#f2f4f7", fg: "#475467" },
};

/**
 * Customer's reservations — pending/accepted ones can be cancelled.
 */
export function ReservationsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const reservations = useCustomerReservations(true);
  const pull = usePullToRefresh(reservations.refetch);
  const cancel = useCancelReservation();

  const rows = reservations.data?.data ?? [];

  const askCancel = (r: CustomerReservation) => {
    if (r.status !== "pending" && r.status !== "accepted") return;
    Alert.alert("Cancel reservation", `Cancel ${r.product_name}?`, [
      { text: "Keep", style: "cancel" },
      { text: "Cancel it", style: "destructive", onPress: () => cancel.mutate(r.id) },
    ]);
  };

  return (
    <SafeScreen backgroundColor={c.gray[50]}>
      <ScreenHeader title="Reservations" subtitle="Long-press to cancel a pending one" />

      {reservations.isLoading ? (
        <View style={styles.list}>
          <SkeletonStatusCard />
          <SkeletonStatusCard />
          <SkeletonStatusCard />
        </View>
      ) : reservations.isError ? (
        <LoadFailed
          what="your reservations"
          error={reservations.error}
          onRetry={() => reservations.refetch()}
          retrying={reservations.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
            />
          }
          renderItem={({ item }) => {
            const badge = STATUS_STYLE[item.status] ?? STATUS_STYLE.cancelled;
            return (
              <Pressable style={styles.card} onLongPress={() => askCancel(item)}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.product_name}
                    {item.variant_name ? ` / ${item.variant_name}` : ""}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.fg }]}>{item.status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {item.shop?.business_name ?? ""} · {item.quantity} ×{" "}
                  {money(item.unit_price)}
                </Text>
                {item.status === "accepted" && item.expires_at && (
                  <Text style={styles.pickup}>
                    Pick up before {new Date(item.expires_at).toLocaleString()}
                  </Text>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No reservations yet</Text>
              <Text style={styles.emptyText}>
                Find a shop in the market and tap Reserve on an item.
              </Text>
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
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  name: { ...typography.label, fontSize: 15, color: c.gray[900], flex: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  meta: { ...typography.small, color: c.gray[500], marginTop: spacing.xs },
  pickup: { ...typography.small, color: c.brand[600], marginTop: spacing.xs, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: c.gray[700] },
  emptyText: { ...typography.small, color: c.gray[500], marginTop: spacing.xs },
});
