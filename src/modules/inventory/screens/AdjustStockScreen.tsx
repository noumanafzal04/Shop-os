import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { Skeleton } from "../../../common/ui/Skeleton";
import { ApiError } from "../../../common/types/api";
import { colors, radius, spacing, typography } from "../../../theme";
import { useAdjustStock, useProductMovements } from "../hooks/useInventory";
import type { ShopStackParamList } from "../../../navigation/types";

type AdjustType = "in" | "out" | "set";

const TYPES: Array<[AdjustType, string]> = [
  ["in", "Stock in"],
  ["out", "Stock out"],
  ["set", "Recount"],
];

export function AdjustStockScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ShopStackParamList, "AdjustStock">>();
  const { productId, productName, stock } = route.params;

  const adjust = useAdjustStock();
  const movements = useProductMovements(productId);

  const [type, setType] = useState<AdjustType>("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  const errorMessage =
    adjust.error instanceof ApiError
      ? adjust.error.firstFieldError() ?? adjust.error.message
      : null;

  const submit = () => {
    if (!quantity || adjust.isPending) return;
    adjust.mutate(
      {
        product_id: productId,
        type,
        ...(type === "set" ? { new_quantity: Number(quantity) } : { quantity: Number(quantity) }),
        reason: reason.trim() || undefined,
      },
      { onSuccess: () => navigation.goBack() },
    );
  };

  return (
    <SafeScreen>
      <KeyboardScreen contentStyle={styles.content}>
        <Text style={styles.title}>Adjust stock</Text>
        <Text style={styles.subtitle}>
          {productName} — current stock: <Text style={styles.stock}>{stock}</Text>
        </Text>

        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.chips}>
          {TYPES.map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setType(value)}
              style={[styles.chip, type === value && styles.chipActive]}
            >
              <Text style={[styles.chipText, type === value && styles.chipTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <AppTextInput
          label={type === "set" ? "New counted quantity" : "Quantity"}
          placeholder={type === "set" ? "e.g. 42" : "e.g. 5"}
          keyboardType="numeric"
          value={quantity}
          onChangeText={setQuantity}
        />

        <AppTextInput
          label="Reason (optional)"
          placeholder={
            type === "in" ? "e.g. Supplier delivery" : type === "out" ? "e.g. Damaged" : "e.g. Physical recount"
          }
          value={reason}
          onChangeText={setReason}
        />

        <AppButton
          title="Apply"
          onPress={submit}
          loading={adjust.isPending}
          disabled={!quantity}
          style={{ marginTop: spacing.sm }}
        />
        <AppButton
          title="Cancel"
          variant="outline"
          onPress={() => navigation.goBack()}
          style={{ marginTop: spacing.sm }}
        />

        <Text style={styles.historyTitle}>Recent movements</Text>
        {movements.isLoading ? (
          <Skeleton height={48} />
        ) : (movements.data ?? []).length === 0 ? (
          <Text style={styles.historyEmpty}>No movements yet.</Text>
        ) : (
          (movements.data ?? []).slice(0, 8).map((m) => (
            <View key={m.id} style={styles.historyRow}>
              <Text style={styles.historyLabel}>
                {m.type === "set" ? "Recount" : m.quantity_change > 0 ? "In" : "Out"}
                {m.reason ? ` — ${m.reason}` : ""}
              </Text>
              <Text
                style={[
                  styles.historyDelta,
                  { color: m.quantity_change >= 0 ? colors.success : colors.error },
                ]}
              >
                {m.quantity_change > 0 ? "+" : ""}
                {m.quantity_change} → {m.quantity_after}
              </Text>
            </View>
          ))
        )}
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  title: { ...typography.title, fontSize: 24, color: colors.gray[900] },
  subtitle: { ...typography.body, color: colors.gray[500], marginTop: spacing.xs, marginBottom: spacing.lg },
  stock: { fontWeight: "700", color: colors.gray[900] },
  chips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.brand[500], borderColor: colors.brand[500] },
  chipText: { color: colors.gray[700], fontSize: 13 },
  chipTextActive: { color: colors.white },
  errorBox: {
    backgroundColor: "#fef3f2",
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: 13 },
  historyTitle: {
    ...typography.label,
    color: colors.gray[700],
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  historyEmpty: { ...typography.small, color: colors.gray[400] },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  historyLabel: { ...typography.small, color: colors.gray[500], flex: 1, marginRight: spacing.sm },
  historyDelta: { ...typography.small, fontWeight: "600" },
});
