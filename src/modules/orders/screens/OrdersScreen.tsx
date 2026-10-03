import React, { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { usePullToRefresh } from "@cartze/core/hooks/usePullToRefresh";
import { ReceiptIcon } from "@cartze/core/ui/icons";
import { spacing, useColors } from "@cartze/core/theme";
import { ScreenHeader } from "../../../common/components/ScreenHeader";
import { StageBar } from "../components/StageBar";
import { OrderCard } from "../components/OrderCard";
import { useOrders } from "../hooks/useOrders";
import { STATUS_LABEL, type OrderStatus } from "../services/orderStages";
import type { OrdersStackParamList } from "../../../navigation/types";

/**
 * THE QUEUE.
 *
 * Opens on ALL rather than on "new", and that is deliberate. A shop mid-shift
 * has orders at four stages at once, and landing on one of them hides the rest
 * behind a filter somebody has to notice is applied. The stage bar carries the
 * counts, so "what is waiting" is answered without changing screen.
 *
 * It polls. A shopkeeper is not going to pull-to-refresh between customers,
 * and an order that arrives while the phone is on the counter has to appear
 * without being asked for.
 */
export function OrdersScreen() {
  const c = useColors();
  const s = styles();
  const nav = useNavigation<NativeStackNavigationProp<OrdersStackParamList>>();
  const [stage, setStage] = useState<OrderStatus | "all">("all");

  const { data, isLoading, isError, refetch } = useOrders(
    stage === "all" ? {} : { status: stage },
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const orders = data?.orders ?? [];
  const unassigned = data?.meta.unassigned ?? 0;

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader
        title="Orders"
        {...(unassigned > 0
          ? {
              /**
               * A WARNING, NOT A FILTER RESULT.
               *
               * The server counts unassigned deliveries across every stage on
               * purpose — an order marked out for delivery with nobody
               * carrying it is a customer waiting for a bike that was never
               * sent, and it stays true whichever chip is selected.
               */
              subtitle: `${unassigned} ${unassigned === 1 ? "delivery has" : "deliveries have"} no rider`,
              subtitleTone: "alert" as const,
            }
          : {})}
      />

      <StageBar active={stage} counts={data?.meta.status_counts} onPick={setStage} />

      {isLoading && orders.length === 0 ? (
        <View style={s.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={104} borderRadius={16} />
          ))}
        </View>
      ) : isError && !data ? (
        <View style={s.list}>
          <LoadFailed
            what="your orders"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={[s.list, orders.length === 0 ? s.listEmpty : null]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
          }
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => nav.navigate("OrderDetail", { id: item.id })} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon={ReceiptIcon}
              tone="muted"
              title={stage === "all" ? "No orders yet" : `Nothing ${STATUS_LABEL[stage].toLowerCase()}`}
              /**
               * The empty state NAMES the filter when one is on. An empty list
               * that cannot say why reads as a fact about the shop, and there
               * is no retry on a fact — the same lesson the rider board's six
               * reasons were written for.
               */
              message={
                stage === "all"
                  ? "Orders placed online, or taken by phone, appear here."
                  : "Other stages may have orders — tap All to see everything."
              }
            />
          }
        />
      )}
    </SafeScreen>
  );
}

// No colours left on this screen — the header, the bar and the cards each own
// their own. A `(c: ThemeColors)` factory that reads nothing is a hook this
// screen re-runs for no reason.
const styles = () =>
  StyleSheet.create({
    list: { padding: spacing.md, paddingTop: spacing.xs, gap: spacing.sm + 2 },
    listEmpty: { flexGrow: 1, justifyContent: "center" },
  });
