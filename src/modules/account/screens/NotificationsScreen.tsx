import React, { useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader, HeaderButton } from "@cartze/core/ui/ScreenHeader";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { usePullToRefresh } from "@cartze/core/hooks/usePullToRefresh";
import { BellIcon, CheckIcon } from "@cartze/core/ui/icons";
import { radius, spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import {
  unreadCount,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from "../../notifications/hooks/useNotifications";
import type { AppNotification } from "../../notifications/services/notificationService";
import { whenText } from "../../sales/screens/SalesScreen";

/**
 * WHAT HAPPENED WHILE THE APP WAS SHUT.
 *
 * ── This is the record, push is the tap on the shoulder ──────────────
 *
 * A push is dismissed and gone, arrives on one device, and cannot be looked
 * at twice. This list is the only place a shop can go back and ask what it
 * missed — which is why it does not wait on Firebase and is not a view of it.
 *
 * ── Tapping a row marks it read, and nothing else ────────────────────
 *
 * It is tempting to route from here: an order notification opening the order.
 * `data` carries ids for some types and not others, and a tap that works on
 * three of nine kinds is worse than one that works on none — the person
 * learns it is unreliable and stops trying. Routing arrives when every type
 * can answer "where does this go", not before.
 */
export function NotificationsScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();

  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const { refreshing, onRefresh } = usePullToRefresh(list.refetch);

  const items: AppNotification[] = useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => p.data),
    [list.data],
  );
  const unread = unreadCount(list.data?.pages);

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
        onBack={() => nav.goBack()}
        right={
          /*
            Offered only when it would DO something. A "Mark all read" that is
            always there is a control that usually does nothing when pressed,
            and this codebase has the name for that: offered must be doable.
          */
          unread > 0 ? (
            <HeaderButton
              label="Mark all as read"
              onPress={() => {
                markAll.mutate();
              }}
            >
              {/* `primaryPressed`, not `primary` — a MARK, not a fill. The
                  palette says so and `houseRules.test.ts` enforces it: the
                  brand at full strength is a fill colour and is under the
                  3:1 floor as a glyph. */}
              <CheckIcon size={19} color={c.primaryPressed} />
            </HeaderButton>
          ) : undefined
        }
      />

      {list.isLoading && items.length === 0 ? (
        <View style={s.list}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={76} borderRadius={16} />
          ))}
        </View>
      ) : list.isError && items.length === 0 ? (
        <View style={s.list}>
          <LoadFailed
            what="your notifications"
            onRetry={() => {
              void list.refetch();
            }}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={[s.list, items.length === 0 ? s.listEmpty : null]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <NotificationRow
              item={item}
              onPress={() => {
                if (item.read_at == null) markRead.mutate(item.id);
              }}
            />
          )}
          ListFooterComponent={
            list.isFetchingNextPage ? <Skeleton height={76} borderRadius={16} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={BellIcon}
              tone="muted"
              title="Nothing yet"
              message="Orders, low stock and reviews show up here — including the ones that arrive while this app is closed."
            />
          }
        />
      )}
    </SafeScreen>
  );
}

function NotificationRow({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  const c = useColors();
  const s = styles(c);
  const unread = item.read_at == null;

  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${unread ? "Unread" : "Read"}`}
      style={[s.row, unread && s.rowUnread]}
    >
      {/*
        A DOT AND A GROUND, not a ground alone. Colour by itself is never an
        accessible cue, and a tinted card is the first thing to disappear
        under a screen filter or in bright sun.
      */}
      <View style={[s.dot, { backgroundColor: unread ? c.primary : "transparent" }]} />
      <View style={s.rowBody}>
        <Text style={[s.title, unread && s.titleUnread]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={s.body} numberOfLines={3}>
          {item.body}
        </Text>
        <Text style={s.when}>{whenText(item.created_at)}</Text>
      </View>
    </Touchable>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { padding: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
    listEmpty: { flexGrow: 1, justifyContent: "center" },

    row: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
    },
    rowUnread: { backgroundColor: c.primarySoft, borderColor: c.primarySoft },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    rowBody: { flex: 1, gap: 3 },
    title: { ...typography.body, color: c.text },
    titleUnread: { ...typography.label, color: c.text },
    body: { ...typography.small, color: c.textSecondary },
    when: { ...typography.tiny, color: c.textMuted, marginTop: 2 },
  });
