import React, { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { AppButton } from "@cartze/core/ui/AppButton";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { usePullToRefresh } from "@cartze/core/hooks/usePullToRefresh";
import { money } from "@cartze/core/format";
import { ChevronRightIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { PeriodBar } from "../components/PeriodBar";
import { useCommission, useSummary } from "../hooks/useMoney";
import type { Period, Summary } from "../services/moneyService";
import type { MoneyStackParamList } from "../../../navigation/types";

/**
 * WHAT THE SHOP MADE.
 *
 * ── Why "kept" is not "revenue" ──────────────────────────────────────
 *
 * The server publishes `revenue` and `refunds` separately, because a refund is
 * dated by the day it went out and netting it would rewrite the day the sale
 * came in. That is right for the books and wrong for the headline: the figure
 * a shopkeeper means by "what did I make" already has the refunds out of it.
 * So this screen does the subtraction, says it did, and never quietly relabels
 * the server's number.
 *
 * Net profit is shown second and stated as such. It is the honest figure and
 * it is not the one people open the app for.
 */
export function MoneyScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation<NativeStackNavigationProp<MoneyStackParamList>>();
  const [period, setPeriod] = useState<Period>("monthly");

  const { data, isLoading, isError, refetch } = useSummary(period);
  const { data: commission } = useCommission();
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  return (
    <SafeScreen edges={["top"]}>
      <Text style={s.title}>Money</Text>
      <PeriodBar active={period} onPick={setPeriod} />

      <ScrollView
        contentContainerStyle={s.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
        }
      >
        {isLoading && !data ? (
          <>
            <Skeleton height={140} borderRadius={18} />
            <Skeleton height={160} borderRadius={18} />
          </>
        ) : isError && !data ? (
          <LoadFailed
            what="your figures"
            onRetry={() => {
              void refetch();
            }}
          />
        ) : data ? (
          <Totals summary={data} />
        ) : null}

        {commission ? (
          <Touchable
            onPress={() => nav.navigate("Commission")}
            accessibilityRole="button"
            style={s.rowCard}
          >
            <View style={s.rowBody}>
              <Text style={s.rowLabel}>CartZe commission</Text>
              <Text style={s.rowMeta}>
                {commission.rate}% of online orders
                {commission.rate_is_yours ? " · your rate" : ""}
              </Text>
            </View>
            <Text style={s.rowValue}>{money(commission.outstanding)}</Text>
            <ChevronRightIcon size={18} color={c.textMuted} />
          </Touchable>
        ) : null}

        <AppButton
          title="Record an expense"
          variant="outline"
          onPress={() => nav.navigate("ExpenseEntry")}
          size="lg"
        />
      </ScrollView>
    </SafeScreen>
  );
}

function Totals({ summary }: { summary: Summary }) {
  const c = useColors();
  const s = styles(c);
  const t = summary.totals;
  const kept = t.revenue - t.refunds;

  return (
    <>
      <View style={s.hero}>
        <Text style={s.heroLabel}>Sales, after refunds</Text>
        <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {money(kept)}
        </Text>
        <Text style={s.heroSub}>
          {t.sales_count} {t.sales_count === 1 ? "sale" : "sales"}
          {t.refunds > 0 ? ` · ${money(t.refunds)} refunded` : ""}
        </Text>
      </View>

      <View style={s.card}>
        <Line label="Sales" value={money(t.revenue)} />
        {t.refunds > 0 ? <Line label="Refunds" value={`− ${money(t.refunds)}`} /> : null}
        {t.other_income > 0 ? <Line label="Other income" value={money(t.other_income)} /> : null}
        {/**
         * Cost of goods is stated even when it is zero, and named plainly.
         * A books-only shop has no COGS and a shopkeeper should be able to see
         * that rather than wonder where the row went.
         */}
        <Line label="Cost of goods" value={`− ${money(t.cogs)}`} />
        <Line label="Gross profit" value={money(t.gross_profit)} />
        <Line label="Expenses" value={`− ${money(t.expenses)}`} />
        <View style={s.rule} />
        <Line label="Net profit" value={money(t.net_profit)} strong />
      </View>

      {summary.top_products.length > 0 ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Best sellers</Text>
          {summary.top_products.slice(0, 5).map((p) => (
            <View key={p.name} style={s.top}>
              <Text style={s.topName} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={s.topUnits}>{p.units}</Text>
              <Text style={s.topValue}>{money(p.revenue)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const s = styles(useColors());
  return (
    <View style={s.line}>
      <Text style={[s.lineLabel, strong ? s.strong : null]}>{label}</Text>
      <Text style={[s.lineValue, strong ? s.strong : null]}>{value}</Text>
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { ...typography.title, color: c.text, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
    body: { padding: spacing.md, paddingTop: spacing.xs, gap: spacing.md, paddingBottom: spacing.xxl },

    hero: { backgroundColor: c.primarySoft, borderRadius: 18, padding: spacing.lg },
    heroLabel: { ...typography.label, color: c.primaryPressed },
    heroValue: { ...typography.display, fontSize: 38, color: c.text, marginTop: spacing.xs },
    heroSub: { ...typography.small, color: c.textSecondary, marginTop: spacing.xs },

    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardTitle: { ...typography.label, color: c.textSecondary, marginBottom: 2 },
    line: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
    lineLabel: { ...typography.body, color: c.textSecondary },
    lineValue: { ...typography.body, color: c.text },
    strong: { ...typography.h3, fontSize: 17, color: c.text },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: spacing.xs },

    top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    topName: { ...typography.body, color: c.text, flex: 1 },
    topUnits: { ...typography.small, color: c.textMuted, minWidth: 34, textAlign: "right" },
    topValue: { ...typography.label, color: c.text, minWidth: 80, textAlign: "right" },

    rowCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
    },
    rowBody: { flex: 1, gap: 2 },
    rowLabel: { ...typography.body, fontSize: 16, color: c.text },
    rowMeta: { ...typography.small, color: c.textMuted },
    rowValue: { ...typography.h3, fontSize: 17, color: c.text },
  });
