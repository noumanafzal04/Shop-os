import React from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { useNavigation } from "@react-navigation/native";
import { CalendarIcon } from "../../../common/ui/icons";
import { Touchable } from "../../../common/ui/Touchable";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { SkeletonStatusCard } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCancelReservation, useCustomerReservations } from "../hooks/useMarketplace";
import type { CustomerReservation } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { money } from "../../../common/format";


/**
 * WHAT A STATUS LOOKS LIKE — from the theme, not from ten fixed hexes.
 *
 * This was a literal map: `#fffaeb` on `#b54708` for pending, and so on. Ten
 * hard-coded colours, all of them taken from the LIGHT palette, on a screen
 * that renders in both. In dark mode the app puts a near-white pastel pill on
 * a near-black card — which is exactly what `darkColors` says it exists to
 * prevent: "Hues held, tints rebuilt: a light pastel background would glow on
 * dark."
 *
 * It is also the only screen in the app that decided its own semantic colours.
 * `success`, `error`, `warning` and `info` already mean these five things, in
 * both themes, and they are what every other screen draws a state with.
 *
 * A function of the palette rather than a constant, because a constant cannot
 * follow the theme — which is the whole bug.
 */
const statusStyle = (c: ThemeColors): Record<string, { bg: string; fg: string }> => ({
  pending: { bg: c.warningBg, fg: c.warning },
  accepted: { bg: c.infoBg, fg: c.info },
  completed: { bg: c.successBg, fg: c.success },
  rejected: { bg: c.errorBg, fg: c.error },
  // Neither good nor bad, and deliberately the quietest of the five: a
  // reservation somebody cancelled is a row they have finished with.
  cancelled: { bg: c.surfaceAlt, fg: c.textSecondary },
  expired: { bg: c.surfaceAlt, fg: c.textSecondary },
});

/**
 * Customer's reservations — pending/accepted ones can be cancelled.
 */
export function ReservationsScreen() {
  const navigation = useNavigation<any>();
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const badges = React.useMemo(() => statusStyle(c), [c]);
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
          contentContainerStyle={[styles.list, styles.grow]}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
            />
          }
          renderItem={({ item }) => {
            const badge = badges[item.status] ?? badges.cancelled;
            return (
              <Touchable style={styles.card} onLongPress={() => askCancel(item)}>
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
              </Touchable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon={CalendarIcon}
              title="No reservations yet"
              message="Some shops let you hold an item and collect it later. Tap Reserve on anything that offers it."
              action={{ label: "Browse shops", onPress: () => navigation.navigate("FoodTab") }}
            />
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
  /** So `ListEmptyComponent` has a screen to centre in. */
  grow: { flexGrow: 1 },
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
  badge: { borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  meta: { ...typography.small, color: c.gray[500], marginTop: spacing.xs },
  pickup: { ...typography.small, color: c.brand[600], marginTop: spacing.xs, fontWeight: "600" },
});
