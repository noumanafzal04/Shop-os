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
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BellIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { apiGet } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";

interface AppNotification {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export function NotificationsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
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
          renderItem={({ item }) => (
            <View style={[styles.row, !item.read_at && styles.rowUnread]}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowBody}>{item.body}</Text>
            </View>
          )}
        />
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
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 3,
  },
  rowUnread: { borderColor: c.brand[300], backgroundColor: c.brand[50] },
  rowTitle: { ...typography.label, color: c.text },
  rowBody: { ...typography.small, color: c.gray[600] },
});
