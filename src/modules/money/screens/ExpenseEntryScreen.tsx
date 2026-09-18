import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { KeyboardScreen } from "@cartze/core/ui/KeyboardScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useExpenseCategories, useRecordExpense } from "../hooks/useMoney";

/**
 * WHAT WAS SPENT, WRITTEN DOWN WHERE IT HAPPENED.
 *
 * The one thing this app WRITES to the books, and it is here because it is the
 * one that cannot wait for somebody to reach a computer: a shopkeeper pays for
 * the gas cylinder at the door, and the note is either made then or not at all.
 *
 * ── Today, and not later ─────────────────────────────────────────────
 *
 * The date is today and is not editable. The server refuses a future date
 * outright, and back-dating is a correction rather than a record — it belongs
 * in the panel where the whole month is visible. A date field on a phone is
 * mostly a way to get the wrong one.
 */
export function ExpenseEntryScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();

  const { data: categories, isLoading: loadingCats } = useExpenseCategories();
  const record = useRecordExpense();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");

  const ready = categoryId !== null && description.trim().length > 0 && amount.trim().length > 0;

  async function save() {
    if (!ready) return;

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      // The server refuses zero and negatives; saying so here saves a round
      // trip and names the rule in the person's own terms.
      toast.error("Enter an amount greater than zero");
      return;
    }

    try {
      await record.mutateAsync({
        expense_category_id: categoryId!,
        description: description.trim(),
        amount: value,
        // Local date, not `toISOString().slice(0,10)` — that is YESTERDAY
        // before 05:00 in Karachi, and this product has shipped that bug once.
        expense_date: localToday(),
        ...(payee.trim() ? { payee: payee.trim() } : {}),
      });
      toast.success("Expense recorded");
      nav.goBack();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Could not record it",
      );
    }
  }

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title="Record an expense" onBack={() => nav.goBack()} />

      <KeyboardScreen contentStyle={s.body}>
        <Text style={s.label}>Category</Text>
        {loadingCats ? (
          <Text style={s.quiet}>Loading categories…</Text>
        ) : categories && categories.length > 0 ? (
          <View style={s.cats}>
            {categories.map((cat) => {
              const on = cat.id === categoryId;
              return (
                <Touchable
                  key={cat.id}
                  onPress={() => setCategoryId(cat.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[s.cat, on ? s.catOn : null]}
                >
                  <Text style={[s.catText, on ? s.catTextOn : null]}>{cat.name}</Text>
                </Touchable>
              );
            })}
          </View>
        ) : (
          <Text style={s.quiet}>
            No expense categories yet. Add one in the CartZe web panel first — an expense has to
            land somewhere.
          </Text>
        )}

        <AppTextInput
          label="What was it for"
          placeholder="Gas cylinder"
          value={description}
          onChangeText={setDescription}
        />

        <AppTextInput
          label="Amount"
          placeholder="0"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
        />

        <AppTextInput
          label="Paid to (optional)"
          placeholder="Shop next door"
          value={payee}
          onChangeText={setPayee}
        />

        <Text style={s.quiet}>Recorded against today, {todayLabel()}.</Text>

        <AppButton
          title="Record expense"
          onPress={save}
          disabled={!ready}
          loading={record.isPending}
          size="lg"
        />
      </KeyboardScreen>
    </SafeScreen>
  );
}

/**
 * Today, in the phone's own timezone.
 *
 * NOT `toISOString().slice(0, 10)`. That is UTC, which is yesterday's date
 * anywhere east of Greenwich before 05:00 — and this product has already
 * shipped an expense filed on the wrong day because of it.
 */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    label: { ...typography.label, color: c.textSecondary },
    quiet: { ...typography.small, color: c.textMuted, lineHeight: 19 },
    cats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    cat: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    catOn: { backgroundColor: c.primary },
    catText: { ...typography.label, fontSize: 13, color: c.textSecondary },
    catTextOn: { color: c.onPrimary },
  });
