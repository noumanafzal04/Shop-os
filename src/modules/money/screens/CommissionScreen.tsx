import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { money } from "@cartze/core/format";
import { CoinsIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useCommission } from "../hooks/useMoney";

/**
 * WHAT THIS SHOP OWES THE PLATFORM, AND THE ORDERS BEHIND IT.
 *
 * ── Why every charge is listed ───────────────────────────────────────
 *
 * A bill nobody can check is a bill nobody trusts. The server sends each
 * charge with the order it came from, the rate applied AT THE TIME and the
 * amount it was taken on — so a shopkeeper who disagrees can point at a line
 * rather than at a total.
 *
 * The rate on each charge is a SNAPSHOT. Change the platform rate tomorrow and
 * last month's charges do not move; a bill that silently re-prices itself is
 * the thing this screen exists to make impossible.
 *
 * Read-only, deliberately. Paying it is not something a phone does here.
 */
export function CommissionScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const { data, isLoading, isError, refetch } = useCommission();

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title="CartZe commission" onBack={() => nav.goBack()} />

      {isLoading && !data ? (
        <View style={s.body}>
          <Skeleton height={120} borderRadius={18} />
          <Skeleton height={200} borderRadius={18} />
        </View>
      ) : isError && !data ? (
        <View style={s.body}>
          <LoadFailed
            what="your commission"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={s.body}>
          <View style={s.hero}>
            <Text style={s.heroLabel}>Outstanding</Text>
            <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {money(data.outstanding)}
            </Text>
            <Text style={s.heroSub}>
              {data.rate}% of each online order
              {data.rate_is_yours ? " — your negotiated rate" : ""}
            </Text>
          </View>

          <Text style={s.note}>
            Commission applies to online orders only. A walk-in at the till and a phone order you
            took yourself are sales CartZe had no part in.
          </Text>

          {data.charges.length === 0 ? (
            <EmptyState
              icon={CoinsIcon}
              tone="muted"
              title="Nothing charged yet"
              message="Charges appear here as online orders complete."
            />
          ) : (
            <View style={s.card}>
              <Text style={s.cardTitle}>Recent charges</Text>
              {data.charges.slice(0, 20).map((charge, i) => (
                <View key={`${charge.order_number}-${i}`} style={s.charge}>
                  <View style={s.chargeBody}>
                    <Text style={s.chargeOrder}>{charge.order_number ?? "—"}</Text>
                    <Text style={s.chargeMeta}>
                      {money(charge.base_amount)} × {charge.rate_percent}%
                    </Text>
                  </View>
                  <Text style={s.chargeAmount}>{money(charge.amount)}</Text>
                </View>
              ))}
            </View>
          )}

          {data.invoices.length > 0 ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Invoices</Text>
              {data.invoices.map((inv) => (
                <View key={inv.number} style={s.charge}>
                  <View style={s.chargeBody}>
                    <Text style={s.chargeOrder}>{inv.number}</Text>
                    <Text style={s.chargeMeta}>
                      {inv.orders_count} {inv.orders_count === 1 ? "order" : "orders"} · {inv.status}
                    </Text>
                  </View>
                  <Text style={s.chargeAmount}>{money(inv.amount)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    hero: { backgroundColor: c.primarySoft, borderRadius: 18, padding: spacing.lg },
    heroLabel: { ...typography.label, color: c.primaryPressed },
    heroValue: { ...typography.display, fontSize: 38, color: c.text, marginTop: spacing.xs },
    heroSub: { ...typography.small, color: c.textSecondary, marginTop: spacing.xs },
    note: { ...typography.small, color: c.textSecondary, lineHeight: 19, paddingHorizontal: 2 },
    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      gap: spacing.sm + 2,
    },
    cardTitle: { ...typography.label, color: c.textSecondary },
    charge: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    chargeBody: { flex: 1, gap: 2 },
    chargeOrder: { ...typography.body, color: c.text },
    chargeMeta: { ...typography.small, color: c.textMuted },
    chargeAmount: { ...typography.label, color: c.text },
  });
