import React from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Bike, ChevronRight, ReceiptText, Store } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { Touchable } from "../../../common/ui/Touchable";
import { Appear } from "../../../common/ui/Appear";
import { SkeletonStatusCard } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useMyOrders, type CustomerOrder } from "../hooks/useOrders";
import { placedAt, statusColors, statusLook, stepOf, stepsFor } from "../orderStatus";
import { SignInWall } from "../../auth/components/SignInWall";
import { useAuthStore } from "../../../stores/authStore";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { money, qtyText } from "../../../common/format";

/**
 * EVERY ORDER, WITH THE MOVING ONES FIRST.
 *
 * ── What was wrong with one flat list ────────────────────────────────
 *
 * The cards were identical whatever the order was doing. A delivery three
 * streets away and a receipt from last March were the same rectangle with a
 * different word in the corner — so the one card on the screen that is
 * genuinely urgent had to be FOUND, by reading badges.
 *
 * They are two different questions. "Where is my food" is asked once a week
 * and answered in a second; "what did I order in March" is a search. So the
 * live ones lift into their own section with a progress track on each, and
 * everything else becomes the history it is.
 *
 * The split is computed from the rows that have loaded, not requested
 * separately: a second endpoint would be a second thing to keep in sync, and
 * an order that finishes while the list is open would then sit in both.
 *
 * ── The section header is a list row ─────────────────────────────────
 *
 * Not `ListHeaderComponent` — the "Earlier" heading has to sit BETWEEN two
 * groups, and there is only one of those. Rows carry their own kind instead,
 * which also keeps the infinite scroll working: appending a page appends
 * orders, and the partition simply runs again.
 */

/** How many lines a card shows before it stops and counts the rest. */
const ITEMS_SHOWN = 2;

type Row =
  | { kind: "heading"; key: string; title: string }
  | { kind: "order"; key: string; order: CustomerOrder; live: boolean };

/** Live first, then the rest, with a heading before each group that has any. */
function rowsFrom(orders: CustomerOrder[]): Row[] {
  const live: CustomerOrder[] = [];
  const past: CustomerOrder[] = [];
  for (const o of orders) {
    (statusLook(o.status, o.fulfillment_type).live ? live : past).push(o);
  }

  const rows: Row[] = [];
  if (live.length > 0) {
    rows.push({ kind: "heading", key: "h-live", title: live.length === 1 ? "Ongoing" : "Ongoing orders" });
    for (const o of live) rows.push({ kind: "order", key: o.id, order: o, live: true });
  }
  if (past.length > 0) {
    // No heading at all when there is nothing above it — a lone "Earlier" over
    // the only group on the screen is a label for the page, not for a section.
    if (live.length > 0) rows.push({ kind: "heading", key: "h-past", title: "Earlier" });
    for (const o of past) rows.push({ kind: "order", key: o.id, order: o, live: false });
  }
  return rows;
}

export function OrdersScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const status = useAuthStore((s) => s.status);
  const orders = useMyOrders();
  const pull = usePullToRefresh(orders.refetch);

  const rows = React.useMemo(
    () => rowsFrom((orders.data?.pages ?? []).flatMap((p) => p.data)),
    [orders.data],
  );

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
        <View style={styles.list}>
          <SkeletonStatusCard footer />
          <SkeletonStatusCard footer />
        </View>
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
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.primary} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (orders.hasNextPage && !orders.isFetchingNextPage) orders.fetchNextPage();
          }}
          ListFooterComponent={
            orders.isFetchingNextPage ? (
              <View style={styles.more}>
                <ActivityIndicator color={c.primary} />
              </View>
            ) : null
          }
          renderItem={({ item, index }) =>
            item.kind === "heading" ? (
              <Text style={styles.groupTitle}>{item.title}</Text>
            ) : (
              <Appear index={index}>
                <OrderCard
                  order={item.order}
                  live={item.live}
                  onPress={() => navigation.navigate("Order", { id: item.order.id })}
                />
              </Appear>
            )
          }
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

function OrderCard({
  order,
  live,
  onPress,
}: {
  order: CustomerOrder;
  live: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const look = statusLook(order.status, order.fulfillment_type);
  const badge = statusColors(look.tone, c);
  const delivery = order.fulfillment_type === "delivery";
  const Mode = delivery ? Bike : Store;

  const steps = stepsFor(order.fulfillment_type);
  const at = stepOf(order.status, order.fulfillment_type);

  return (
    <Touchable style={[styles.card, live && styles.cardLive]} onPress={onPress}>
      {/* ── Who it is from, and when ─────────────────────────────── */}
      <View style={styles.top}>
        <View style={styles.topCopy}>
          <Text style={styles.shop} numberOfLines={1}>
            {order.shop?.business_name ?? "Shop"}
          </Text>
          {/*
            The order NUMBER moved down here, beside the date.

            It led the card in 15pt bold, which gives the loudest line on a
            shop's card to a string nobody recognises. It is a reference for a
            phone call, not a name — so it sits with the other reference
            information, and the shop takes the line.
          */}
          <Text style={styles.when} numberOfLines={1}>
            {placedAt(order.placed_at)} · {order.order_number}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeTxt, { color: badge.fg }]}>{look.label}</Text>
        </View>
      </View>

      {/*
        ── How far along, for a live order only ────────────────────

        A finished order does not need a full bar to say it is finished, and a
        cancelled one has no position on the journey at all — `stepOf` returns
        null rather than drawing it one segment from delivered.
      */}
      {live && at != null && (
        <View style={styles.track} accessibilityLabel={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <View key={s} style={[styles.seg, i <= at && styles.segOn]} />
          ))}
        </View>
      )}

      {/*
        Two lines, then a count.

        It listed every line, so a weekly grocery run of fourteen items made a
        card taller than the screen — and a list of orders where one order fills
        the screen has stopped being a list. The full contents are one tap away
        on the order itself; what this card is for is telling them apart.
      */}
      <View style={styles.items}>
        {order.items.slice(0, ITEMS_SHOWN).map((it, i) => (
          <Text key={i} style={styles.item} numberOfLines={1}>
            {qtyText(it.quantity)} × {it.product_name}
            {it.variant_name ? ` (${it.variant_name})` : ""}
          </Text>
        ))}
        {order.items.length > ITEMS_SHOWN && (
          <Text style={styles.itemMore}>
            +{order.items.length - ITEMS_SHOWN} more{" "}
            {order.items.length - ITEMS_SHOWN === 1 ? "item" : "items"}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.metaRow}>
          <Mode size={14} color={c.textSecondary} strokeWidth={2.2} />
          <Text style={styles.meta}>{delivery ? "Delivery" : "Pick-up"}</Text>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.total}>{money(order.total)}</Text>
          {/*
            A live order's card ends in the verb, not in a chevron.

            The whole reason to open this one is to watch it move, and "Track"
            says that where an arrow only says "there is more".
          */}
          {live ? (
            <View style={styles.trackCta}>
              <Text style={styles.trackCtaText}>Track</Text>
              <ChevronRight size={13} color={c.primary} strokeWidth={2.8} />
            </View>
          ) : (
            <ChevronRight size={16} color={c.textMuted} strokeWidth={2.2} />
          )}
        </View>
      </View>
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 12 },
    title: { ...typography.title, fontSize: 22, color: c.text },
    sub: { ...typography.small, color: c.textSecondary, marginTop: 2 },
    more: { paddingVertical: spacing.lg, alignItems: "center" },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },

    groupTitle: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "800",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginTop: spacing.sm,
      marginBottom: 10,
    },

    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      marginBottom: 12,
      gap: 10,
    },
    // The one difference between a live card and a finished one, and it is a
    // border rather than a fill: a tinted card in a list of white ones reads as
    // selected, which it is not.
    cardLive: { borderColor: c.brand[200] },

    top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    topCopy: { flex: 1, gap: 2 },
    shop: { ...typography.h3, color: c.text, fontSize: 15.5 },
    when: { ...typography.tiny, color: c.textMuted },
    badge: {
      // An explicit radius, not `radius.full`: a very large radius renders as a
      // square on small views under the new architecture.
      borderRadius: 9,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    badgeTxt: { ...typography.tiny, fontWeight: "800", fontSize: 10.5 },

    track: { flexDirection: "row", gap: 4 },
    seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt },
    segOn: { backgroundColor: c.primary },

    items: { gap: 2 },
    item: { ...typography.small, color: c.textSecondary },
    itemMore: { ...typography.tiny, color: c.textMuted, fontWeight: "700", marginTop: 1 },

    footer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 10,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    meta: { ...typography.small, color: c.textSecondary },
    totalRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    total: { ...typography.label, color: c.text, fontSize: 15 },
    trackCta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 1,
      backgroundColor: c.primarySoft,
      borderRadius: 9,
      paddingLeft: 9,
      paddingRight: 5,
      paddingVertical: 4,
    },
    trackCtaText: { ...typography.tiny, color: c.primary, fontWeight: "800" },

    empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
    emptyTitle: { ...typography.label, color: c.textSecondary },
    emptyText: { ...typography.small, color: c.textMuted, marginTop: spacing.xs },
  });
