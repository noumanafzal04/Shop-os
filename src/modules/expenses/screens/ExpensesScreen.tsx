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
import { useExpenseMutations, useExpenses } from "../hooks/useExpenses";
import type { Expense } from "../services/expensesService";
import type { ShopStackParamList } from "../../../navigation/types";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

export function ExpensesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ShopStackParamList>>();
  const expenses = useExpenses();
  const { remove } = useExpenseMutations();

  const rows = expenses.data?.data ?? [];

  const confirmDelete = (expense: Expense) => {
    Alert.alert("Delete expense", `Delete "${expense.description}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(expense.id) },
    ]);
  };

  return (
    <SafeScreen backgroundColor={colors.gray[50]} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Expenses</Text>
        <Pressable style={styles.addBtn} onPress={() => navigation.navigate("AddExpense")}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </Pressable>
      </View>

      {expenses.isLoading ? (
        <View style={styles.list}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.card}>
              <Skeleton width="55%" height={16} />
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
            <RefreshControl
              refreshing={expenses.isRefetching}
              onRefresh={() => expenses.refetch()}
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onLongPress={() => confirmDelete(item)}>
              <View style={styles.rowTop}>
                <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
                <Text style={styles.amount}>{money(item.amount)}</Text>
              </View>
              <Text style={styles.meta}>
                {item.expense_date.slice(0, 10)}
                {item.category?.name ? ` · ${item.category.name}` : ""}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No expenses yet</Text>
              <Text style={styles.emptyText}>Tap "+ Add" to record your first expense.</Text>
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
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  desc: { ...typography.label, fontSize: 15, color: colors.gray[900], flex: 1 },
  amount: { ...typography.label, color: colors.error },
  meta: { ...typography.small, color: colors.gray[500], marginTop: spacing.xs },
  empty: { alignItems: "center", paddingVertical: spacing.xl * 2 },
  emptyTitle: { ...typography.label, color: colors.gray[700] },
  emptyText: { ...typography.small, color: colors.gray[500], marginTop: spacing.xs },
});
