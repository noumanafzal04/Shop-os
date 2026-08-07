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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { Skeleton } from "../../../common/ui/Skeleton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useSaleMutations, useSales } from "../hooks/useSales";
import type { Sale } from "../types";
import type { ShopStackParamList } from "../../../navigation/types";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

export function SalesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ShopStackParamList>>();
  const sales = useSales({});
  const { cancel } = useSaleMutations();

  const rows = sales.data?.data ?? [];

  const confirmCancel = (sale: Sale) => {
    if (sale.status !== "completed") return;
    Alert.alert(
      "Cancel sale",
      `Cancel ${sale.invoice_number}? Stock will be restored.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel sale",
          style: "destructive",
          onPress: () => cancel.mutate({ id: sale.id }),
        },
      ],
    );
  };

  return (
    <SafeScreen backgroundColor={colors.gray[50]} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Sales</Text>
        <Pressable style={styles.addBtn} onPress={() => navigation.navigate("NewSale")}>
          <Text style={styles.addBtnText}>+ New Sale</Text>
        </Pressable>
      </View>

      {sales.isLoading ? (
        <View style={styles.list}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.card}>
              <Skeleton width="50%" height={16} />
              <Skeleton width="30%" height={12} style={{ marginTop: spacing.sm }} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={sales.isRefetching} onRefresh={() => sales.refetch()} />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onLongPress={() => confirmCancel(item)}>
              <View style={styles.rowTop}>
                <Text style={styles.invoice}>{item.invoice_number}</Text>
                <Text style={styles.total}>{money(item.total)}</Text>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.meta}>
                  {new Date(item.sold_at).toLocaleString()} · {item.items_count} item(s)
                </Text>
                <View
                  style={[
                    styles.badge,
                    item.status === "cancelled" && styles.badgeCancelled,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      item.status === "cancelled" && styles.badgeTextCancelled,
                    ]}
                  >
                    {item.status}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No sales yet</Text>
              <Text style={styles.emptyText}>Tap "+ New Sale" to record your first sale.</Text>
            </View>
          }
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
    padding: spacing.md,
  },
  title: { ...typography.title, fontSize: 22, color: colors.gray[900] },
  addBtn: {
    backgroundColor: colors.brand[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  addBtnText: { color: colors.white, fontWeight: "600", fontSize: 14 },
  list: { padding: spacing.md, paddingTop: 0 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between" },
  invoice: { ...typography.label, fontSize: 15, color: colors.gray[900] },
  total: { ...typography.label, color: colors.brand[600] },
  rowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  meta: { ...typography.small, color: colors.gray[500] },
  badge: {
    backgroundColor: "#ecfdf3",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeCancelled: { backgroundColor: "#fef3f2" },
  badgeText: { fontSize: 11, color: "#027a48" },
  badgeTextCancelled: { color: "#b42318" },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: colors.gray[700] },
  emptyText: { ...typography.small, color: colors.gray[500], marginTop: spacing.xs },
});
