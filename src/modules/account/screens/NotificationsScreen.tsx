import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bell } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { Skeleton } from "../../../common/ui/Skeleton";
import { apiGet } from "../../../common/api/client";
import { colors, radius, spacing, typography } from "../../../theme";

interface AppNotification {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<AppNotification[]>("/notifications"),
  });
  const rows = list.data?.data ?? [];

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={colors.black} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.back} />
      </View>

      {list.isLoading ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={72} borderRadius={radius.lg} />
          ))}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Bell size={32} color={colors.gray[300]} strokeWidth={1.6} />
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

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h3, color: colors.black },

  list: { padding: spacing.md, gap: spacing.xs },
  emptyWrap: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxl },
  empty: { ...typography.small, color: colors.gray[400] },

  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 3,
  },
  rowUnread: { borderColor: colors.brand[300], backgroundColor: colors.brand[50] },
  rowTitle: { ...typography.label, color: colors.black },
  rowBody: { ...typography.small, color: colors.gray[600] },
});
