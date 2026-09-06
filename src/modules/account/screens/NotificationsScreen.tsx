import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BellIcon,
  ChevronRightIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { Touchable } from "../../../common/ui/Touchable";
import { notificationKind, timeAgo, type NotificationTone } from "../notificationKinds";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { apiGet, apiPost } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";

interface AppNotification {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  /**
   * WHAT IT IS ABOUT, and WHERE IT LEADS.
   *
   * Both have been on the payload since notifications existed — the model
   * casts `data` to an array and the endpoint returns it whole. The app was
   * reading the title and throwing the rest away, so every row looked
   * identical and none of them went anywhere. See `notificationKinds.ts`.
   */
  type?: string | null;
  data?: Record<string, unknown> | null;
}

export function NotificationsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();

  /**
   * Open the thing it is about, and stop it being new.
   *
   * The read is FIRE AND FORGET and the navigation does not wait for it: a
   * notification about an order that is out for delivery should open that
   * order at the speed of a tap, not at the speed of the network. If the mark
   * fails, the worst case is a row that stays bold — which is a great deal
   * better than a tap that appears to do nothing.
   *
   * The dot is turned off locally first, for the same reason.
   */
  const open = (n: AppNotification, to: { route: string; params?: object } | null) => {
    if (n.read_at == null) {
      queryClient.setQueryData(["notifications"], (old: any) =>
        old == null
          ? old
          : {
              ...old,
              pages: old.pages.map((page: any) => ({
                ...page,
                data: page.data.map((row: AppNotification) =>
                  row.id === n.id ? { ...row, read_at: new Date().toISOString() } : row,
                ),
              })),
            },
      );
      apiPost(`/notifications/${n.id}/read`).catch(() => {});
    }

    if (to != null) navigation.navigate(to.route, to.params);
  };

  /**
   * Fifteen at a time, like the endpoint has always sent them.
   *
   * Somebody who has been ordering for a year has hundreds of these and could
   * see fifteen. A notification list that stops silently is one where the
   * thing you half-remember is simply not there.
   */
  const list = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) =>
      apiGet<AppNotification[]>("/notifications", { params: { page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      if (p == null || p.current_page >= p.last_page) return undefined;

      return p.current_page + 1;
    },
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.data);

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeftIcon size={20} color={c.text} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        {/*
          A SPACER, so the title sits centred between two equal margins — and
          it must NOT reuse `styles.back`, which carries a surface fill and a
          border. Reused, the balancing gap renders as an empty white circle
          floating in the top right. Same bug, third screen.
        */}
        <View style={styles.headSpacer} />
      </View>

      {list.isLoading ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <SkeletonListRow key={i} />
          ))}
        </View>
      ) : list.isError ? (
        <LoadFailed
          what="your notifications"
          error={list.error}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(n) => n.id}
          contentContainerStyle={[styles.list, styles.grow]}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View style={styles.more}>
                <ActivityIndicator color={c.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={BellIcon}
              title="No notifications yet"
              message="When a shop accepts your order, or a rider sets off with it, you will hear about it here."
            />
          }
          renderItem={({ item }) => {
            const kind = notificationKind(item.type);
            const to = kind.target?.(item.data ?? {}) ?? null;
            const unread = item.read_at == null;
            const Mark = kind.icon;

            return (
              <Touchable
                style={[styles.row, unread && styles.rowUnread]}
                accessibilityRole={to ? "button" : "text"}
                accessibilityLabel={item.title}
                disabled={to == null}
                onPress={() => open(item, to)}
              >
                {/*
                  A MARK, in the colour of what happened.

                  "Rider on the way" and "Order cancelled" were the same bold
                  line over the same grey line — the one thing that separates
                  them, whether this is good news or bad, was carried only by
                  words somebody had to read.
                */}
                <View style={[styles.mark, { backgroundColor: toneBg(kind.tone, c) }]}>
                  <Mark size={18} color={toneInk(kind.tone, c)} />
                </View>

                <View style={styles.rowCopy}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowWhen}>{timeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={styles.rowBody} numberOfLines={2}>
                    {item.body}
                  </Text>
                </View>

                {/*
                  A dot for unread, a chevron for somewhere to go, and NOTHING
                  where there is neither. A chevron on a row that leads nowhere
                  is the promise this screen was breaking on every line.
                */}
                {unread ? (
                  <View style={styles.dot} />
                ) : to != null ? (
                  <ChevronRightIcon size={16} color={c.textMuted} />
                ) : null}
              </Touchable>
            );
          }}
        />
      )}
    </SafeScreen>
  );
}

/**
 * The mark's colours, per tone.
 *
 * Semantic, not decorative: green means it happened, red means it did not,
 * amber means somebody has to do something. Those are the three questions a
 * list of notifications is scanned for, and the fourth — plain information —
 * takes the page's own grey rather than a fourth accent.
 */
function toneBg(tone: NotificationTone, c: ThemeColors): string {
  return tone === "good"
    ? c.successBg
    : tone === "bad"
      ? c.errorBg
      : tone === "act"
        ? c.warningBg
        : c.surfaceAlt;
}

function toneInk(tone: NotificationTone, c: ThemeColors): string {
  return tone === "good"
    ? c.success
    : tone === "bad"
      ? c.error
      : tone === "act"
        ? c.warning
        : c.textSecondary;
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
  headSpacer: { width: 40 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h3, color: c.text },

  more: { paddingVertical: spacing.lg, alignItems: "center" },
  list: { padding: spacing.md, gap: spacing.xs },
  /**
   * SO THE EMPTY STATE HAS A SCREEN TO CENTRE IN.
   *
   * `ListEmptyComponent` is laid out inside the content container, and a
   * content container is only as tall as its content — so without this it
   * centres inside nothing and lands at the top.
   */
  grow: { flexGrow: 1 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  /**
   * Unread is a TINT and a dot, not a border.
   *
   * A coloured border on some rows and not others makes the list look like two
   * kinds of card; a faint ground reads as "new" and leaves the shape alone.
   */
  rowUnread: { backgroundColor: c.primarySoft, borderColor: c.brand[100] },

  mark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  rowCopy: { flex: 1, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { ...typography.label, color: c.text, flex: 1, fontSize: 14 },
  rowTitleUnread: { fontWeight: "800" },
  // Pinned right and never shrinking: "2h" is the fact that tells two
  // otherwise identical order updates apart.
  rowWhen: { ...typography.tiny, color: c.textMuted, flexShrink: 0 },
  rowBody: { ...typography.small, color: c.textSecondary, fontSize: 12.5, lineHeight: 17 },

  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary },
});
