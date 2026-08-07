import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { colors, radius, spacing, typography } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useCategories, useProductMutations } from "../hooks/useCatalog";
import type { ItemType } from "../types";

/**
 * Quick add for items on the go. Variants are a web-side power feature —
 * mobile creates simple items (keyboard-aware, tap-guarded).
 */
export function ProductFormScreen() {
  const navigation = useNavigation();
  const categories = useCategories();
  const { create } = useProductMutations();

  const servicesEnabled = useAuthStore(
    (s) => (s.user?.tenant as unknown as { features?: Record<string, boolean> })?.features?.services ?? true,
  );

  const [type, setType] = useState<ItemType>("product");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("0");
  const [duration, setDuration] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0] ?? null;
  const generalError =
    apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const flatCategories = (categories.data ?? []).flatMap((c) => [c, ...(c.children ?? [])]);

  const submit = () => {
    if (!name.trim() || !price || create.isPending) return;

    create.mutate(
      {
        type,
        name: name.trim(),
        category_id: categoryId,
        sku: sku.trim() || undefined,
        price,
        ...(type === "product"
          ? { cost: cost || undefined, stock_quantity: Number(stock) || 0 }
          : { duration_minutes: duration ? Number(duration) : undefined }),
      },
      {
        onSuccess: (response) => {
          const w = (response.meta as { warnings?: string[] }).warnings?.[0];
          if (w) {
            setWarning(w);
            setTimeout(() => navigation.goBack(), 1600);
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
        <Text style={styles.title}>Add Item</Text>

        {generalError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{generalError}</Text>
          </View>
        )}
        {warning && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>{warning}</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Type</Text>
        <View style={styles.chips}>
          {(["product", "service"] as ItemType[]).map((t) => (
            <Pressable
              key={t}
              disabled={t === "service" && !servicesEnabled}
              onPress={() => setType(t)}
              style={[
                styles.chip,
                type === t && styles.chipActive,
                t === "service" && !servicesEnabled && styles.chipDisabled,
              ]}
            >
              <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <AppTextInput
          label="Name *"
          placeholder={type === "service" ? "e.g. Haircut" : "e.g. T-Shirt"}
          value={name}
          onChangeText={setName}
          error={errorFor("name")}
        />

        {flatCategories.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Category</Text>
            <View style={styles.chips}>
              {flatCategories.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  style={[styles.chip, categoryId === c.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <AppTextInput
          label="Price *"
          placeholder="0"
          keyboardType="numeric"
          value={price}
          onChangeText={setPrice}
          error={errorFor("price")}
        />

        {type === "product" ? (
          <>
            <AppTextInput
              label="Cost"
              placeholder="0"
              keyboardType="numeric"
              value={cost}
              onChangeText={setCost}
            />
            <AppTextInput
              label="Opening stock"
              placeholder="0"
              keyboardType="numeric"
              value={stock}
              onChangeText={setStock}
            />
            <AppTextInput
              label="SKU"
              placeholder="Unique code"
              autoCapitalize="characters"
              value={sku}
              onChangeText={setSku}
              error={errorFor("sku")}
            />
          </>
        ) : (
          <AppTextInput
            label="Duration (minutes)"
            placeholder="e.g. 30"
            keyboardType="numeric"
            value={duration}
            onChangeText={setDuration}
          />
        )}

        <AppButton
          title="Create item"
          onPress={submit}
          loading={create.isPending}
          disabled={!name.trim() || !price}
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
  title: { ...typography.title, fontSize: 24, color: colors.gray[900], marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.label,
    color: colors.gray[700],
    marginBottom: spacing.sm,
  },
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
  chipDisabled: { opacity: 0.4 },
  chipText: { color: colors.gray[700], fontSize: 13, textTransform: "capitalize" },
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
