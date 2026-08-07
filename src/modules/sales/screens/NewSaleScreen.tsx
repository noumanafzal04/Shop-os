import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { colors, radius, spacing, typography } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useProducts } from "../../catalog/hooks/useCatalog";
import type { Product, ProductVariant } from "../../catalog/types";
import { useSaleMutations } from "../hooks/useSales";
import type { PaymentMethod } from "../types";

interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  label: string;
  quantity: number;
  unitPrice: number;
}

const money = (n: number) => `Rs ${n.toLocaleString()}`;

const PAYMENTS: Array<[PaymentMethod, string]> = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["bank_transfer", "Bank"],
  ["other", "Other"],
];

/**
 * Quick POS on the phone: search → tap to add → steppers → payment →
 * complete (tap-guarded + server-side idempotency).
 */
export function NewSaleScreen() {
  const navigation = useNavigation();
  const { create } = useSaleMutations();

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const results = useProducts({ search: debounced });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    [cart],
  );

  const addLine = (product: Product, variant: ProductVariant | null = null) => {
    const key = `${product.id}:${variant?.id ?? "base"}`;
    setCart((lines) => {
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...lines,
        {
          key,
          productId: product.id,
          variantId: variant?.id ?? null,
          label: variant ? `${product.name} / ${variant.name}` : product.name,
          quantity: 1,
          unitPrice: Number(variant?.price ?? product.price),
        },
      ];
    });
    setSearch("");
  };

  const bump = (key: string, delta: number) => {
    setCart((lines) =>
      lines
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  };

  const errorMessage =
    create.error instanceof ApiError
      ? create.error.firstFieldError() ?? create.error.message
      : null;

  const paid = Number(amountPaid) || 0;

  const complete = () => {
    if (cart.length === 0 || paid < total || create.isPending) return;
    create.mutate(
      {
        channel: "walk_in",
        items: cart.map((l) => ({
          product_id: l.productId,
          variant_id: l.variantId ?? undefined,
          quantity: l.quantity,
          unit_price: l.unitPrice,
        })),
        payment_method: payment,
        amount_paid: paid,
      },
      { onSuccess: () => navigation.goBack() },
    );
  };

  const searchResults = (results.data?.data ?? []).filter((p) => p.is_active);

  return (
    <SafeScreen>
      <View style={styles.container}>
        <Text style={styles.title}>New Sale</Text>

        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <AppTextInput
          label=""
          placeholder="Search items to add…"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />

        {debounced.length > 0 && searchResults.length > 0 && (
          <View style={styles.results}>
            {searchResults.slice(0, 5).flatMap((p) =>
              p.variants.length === 0
                ? [
                    <Pressable key={p.id} style={styles.resultRow} onPress={() => addLine(p)}>
                      <Text style={styles.resultName}>{p.name}</Text>
                      <Text style={styles.resultPrice}>{money(Number(p.price))}</Text>
                    </Pressable>,
                  ]
                : p.variants.map((v) => (
                    <Pressable key={v.id} style={styles.resultRow} onPress={() => addLine(p, v)}>
                      <Text style={styles.resultName}>
                        {p.name} / {v.name}
                      </Text>
                      <Text style={styles.resultPrice}>{money(Number(v.price))}</Text>
                    </Pressable>
                  )),
            )}
          </View>
        )}

        <FlatList
          data={cart}
          keyExtractor={(l) => l.key}
          style={styles.cart}
          ListEmptyComponent={
            <Text style={styles.emptyCart}>Cart is empty — search above.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.cartRow}>
              <View style={styles.cartInfo}>
                <Text style={styles.cartLabel} numberOfLines={1}>{item.label}</Text>
                <Text style={styles.cartPrice}>{money(item.unitPrice * item.quantity)}</Text>
              </View>
              <View style={styles.stepper}>
                <Pressable style={styles.stepBtn} onPress={() => bump(item.key, -1)}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.qty}>{item.quantity}</Text>
                <Pressable style={styles.stepBtn} onPress={() => bump(item.key, 1)}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
          )}
        />

        <View style={styles.footer}>
          <View style={styles.chips}>
            {PAYMENTS.map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setPayment(value)}
                style={[styles.chip, payment === value && styles.chipActive]}
              >
                <Text style={[styles.chipText, payment === value && styles.chipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total {money(total)}</Text>
            <View style={styles.paidWrap}>
              <AppTextInput
                label=""
                placeholder="Amount paid"
                keyboardType="numeric"
                value={amountPaid}
                onChangeText={setAmountPaid}
              />
            </View>
          </View>
          {paid > total && (
            <Text style={styles.change}>Change: {money(paid - total)}</Text>
          )}

          <AppButton
            title={`Complete Sale · ${money(total)}`}
            onPress={complete}
            loading={create.isPending}
            disabled={cart.length === 0 || paid < total}
          />
          <AppButton
            title="Cancel"
            variant="outline"
            onPress={() => navigation.goBack()}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  title: { ...typography.title, fontSize: 24, color: colors.gray[900], marginBottom: spacing.md },
  errorBox: {
    backgroundColor: "#fef3f2",
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: 13 },
  results: {
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    marginBottom: spacing.sm,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  resultName: { ...typography.body, color: colors.gray[900], flex: 1, marginRight: spacing.sm },
  resultPrice: { ...typography.label, color: colors.gray[500] },
  cart: { flex: 1, marginTop: spacing.sm },
  emptyCart: { ...typography.small, color: colors.gray[400], textAlign: "center", paddingVertical: spacing.xl },
  cartRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  cartInfo: { flex: 1, marginRight: spacing.md },
  cartLabel: { ...typography.body, color: colors.gray[900] },
  cartPrice: { ...typography.small, color: colors.gray[500], marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray[300],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  stepText: { fontSize: 18, color: colors.gray[700] },
  qty: { ...typography.label, minWidth: 24, textAlign: "center", color: colors.gray[900] },
  footer: { paddingTop: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.brand[500], borderColor: colors.brand[500] },
  chipText: { color: colors.gray[700], fontSize: 13 },
  chipTextActive: { color: colors.white },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  totalLabel: { ...typography.title, fontSize: 18, color: colors.gray[900] },
  paidWrap: { width: 140 },
  change: { ...typography.small, color: colors.success, marginBottom: spacing.xs },
});
