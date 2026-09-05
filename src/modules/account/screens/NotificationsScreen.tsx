import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bell } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
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
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<AppNotification[]>("/notifications"),
  });
  const rows = list.data?.data ?? [];

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={c.text} strokeWidth={2} />
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
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Bell size={32} color={c.gray[300]} strokeWidth={1.6} />
              <Text style={styles.empty}>Nothing yet — order updates will land here.</Text>
            </View>
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
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h3, color: c.text },

  list: { padding: spacing.md, gap: spacing.xs },
  emptyWrap: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxl },
  empty: { ...typography.small, color: c.gray[400] },

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
