import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { Skeleton } from "../../../common/ui/Skeleton";
import { ApiError } from "../../../common/types/api";
import { colors, radius, spacing, typography } from "../../../theme";
import { useExpenseCategories, useExpenseMutations } from "../hooks/useExpenses";

const today = () => new Date().toISOString().slice(0, 10);

export function AddExpenseScreen() {
  const navigation = useNavigation();
  const categories = useExpenseCategories();
  const { create } = useExpenseMutations();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorMessage = apiError ? apiError.firstFieldError() ?? apiError.message : null;

  const submit = () => {
    if (!categoryId || !description.trim() || !amount || create.isPending) return;
    create.mutate(
      {
        expense_category_id: categoryId,
        description: description.trim(),
        amount: Number(amount),
        expense_date: today(),
      },
      {
        onSuccess: (response) => {
          const w = (response.meta as { warnings?: string[] }).warnings?.[0];
          if (w) {
            setWarning(w);
            setTimeout(() => navigation.goBack(), 1800);
          } else {
            navigation.goBack();
          }
        },
      },
    );
  };

  return (
    <SafeScreen>
      <KeyboardScreen contentStyle={styles.content}>
        <Text style={styles.title}>Add Expense</Text>
        <Text style={styles.subtitle}>Dated today — edit on web for past dates.</Text>

        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}
        {warning && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>{warning}</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Category *</Text>
        {categories.isLoading ? (
          <View style={styles.chips}>
            <Skeleton width={80} height={36} borderRadius={radius.full} />
            <Skeleton width={110} height={36} borderRadius={radius.full} />
          </View>
        ) : (
          <View style={styles.chips}>
            {(categories.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(c.id)}
                style={[styles.chip, categoryId === c.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <AppTextInput
          label="Description *"
          placeholder="e.g. Shop electricity bill"
          value={description}
          onChangeText={setDescription}
        />
        <AppTextInput
          label="Amount *"
          placeholder="0"
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
        />

        <AppButton
          title="Save expense"
          onPress={submit}
          loading={create.isPending}
          disabled={!categoryId || !description.trim() || !amount}
          style={{ marginTop: spacing.sm }}
        />
        <AppButton
          title="Cancel"
          variant="outline"
          onPress={() => navigation.goBack()}
          style={{ marginTop: spacing.sm }}
        />
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  title: { ...typography.title, fontSize: 24, color: colors.gray[900] },
  subtitle: {
    ...typography.body,
    color: colors.gray[500],
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  sectionLabel: { ...typography.label, color: colors.gray[700], marginBottom: spacing.sm },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
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
  warnBox: {
    backgroundColor: "#fffaeb",
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warnText: { color: "#b54708", fontSize: 13 },
});
