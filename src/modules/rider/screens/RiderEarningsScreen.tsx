import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banknote, Package, Store, Wallet } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { money } from "../../../common/format";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useRiderEarnings } from "../hooks/useRider";

/**
 * What a rider earned, and what they are still holding.
 *
 * ── Two numbers that must never be added together ────────────────────
 *
 * EARNED is the delivery fee on jobs done in the chosen period — the rider's
 * money.
 *
 * CASH IN HAND is the shop's money, sitting in the rider's pocket because
 * somebody paid at the door. It ignores the period on purpose: "what am I
 * holding" is a fact about right now, and a rider looking at last month must
 * not be told they owe nothing.
 *
 * They are shown apart, worded apart, and coloured apart, because a rider who
 * reads the second as income spends it.
 */

type Range = "today" | "week" | "month";

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "This month" },
];

function boundsFor(range: Range): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (range === "today") return { from: iso(now), to: iso(now) };
  if (range === "week") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { from: iso(from), to: iso(now) };
  }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}

export function RiderEarningsScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const [range, setRange] = React.useState<Range>("today");
  const { from, to } = boundsFor(range);
  const earnings = useRiderEarnings(from, to);

  return (
    <SafeScreen edges={["top", "bottom"]}>
      <ScreenHeader title="Earnings" subtitle="Your money, and the shop's" />

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.tabs}>
          {RANGES.map((r) => {
            const on = range === r.key;
            return (
              <Pressable
                key={r.key}
                style={[styles.tab, on && styles.tabOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setRange(r.key)}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {earnings.isError ? (
          <LoadFailed
            what="your earnings"
            error={earnings.error}
            onRetry={() => earnings.refetch()}
            retrying={earnings.isFetching}
          />
        ) : earnings.isLoading ? (
          <View style={styles.skeletons}>
            {[0, 1, 2].map((i) => (
              <SkeletonListRow key={i} />
            ))}
          </View>
        ) : (
          <>
            {/* ── Yours ─────────────────────────────────────────────── */}
            <View style={styles.hero}>
              <Wallet size={20} color={c.onPrimary} strokeWidth={2.2} />
              <Text style={styles.heroValue}>{money(earnings.data?.earned ?? 0)}</Text>
              <Text style={styles.heroLabel}>
                Earned from {earnings.data?.deliveries ?? 0} deliver
                {(earnings.data?.deliveries ?? 0) === 1 ? "y" : "ies"}
              </Text>
            </View>

            {/* ── Theirs ────────────────────────────────────────────── */}
            <View style={styles.cash}>
              <View style={styles.cashHead}>
                <Banknote size={18} color={c.onWarm} strokeWidth={2.2} />
                <Text style={styles.cashTitle}>Cash in hand</Text>
                <Text style={styles.cashValue}>{money(earnings.data?.cash_in_hand ?? 0)}</Text>
              </View>
              <Text style={styles.cashHint}>
                {(earnings.data?.cash_in_hand ?? 0) > 0
                  ? `From ${earnings.data?.cash_orders ?? 0} cash order${(earnings.data?.cash_orders ?? 0) === 1 ? "" : "s"}. This is the shop's money — hand it back and they will mark it settled.`
                  : "You are not holding anybody's cash. Everything has been settled."}
              </Text>
            </View>

            {(earnings.data?.by_shop.length ?? 0) > 0 && (
              <>
                <Text style={styles.caption}>Owed to each shop</Text>
                <View style={styles.card}>
                  {earnings.data!.by_shop.map((s, i) => (
                    <View
                      key={`${s.shop}-${i}`}
                      style={[styles.shop, i < earnings.data!.by_shop.length - 1 && styles.shopDivided]}
                    >
                      <Store size={16} color={c.textMuted} strokeWidth={2} />
                      <View style={styles.shopCopy}>
                        <Text style={styles.shopName} numberOfLines={1}>
                          {s.shop ?? "Shop"}
                        </Text>
                        <Text style={styles.shopMeta}>
                          {s.orders} order{s.orders === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <Text style={styles.shopCash}>{money(s.cash)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <View style={styles.note}>
              <Package size={15} color={c.textMuted} strokeWidth={2} />
              <Text style={styles.noteText}>
                A shop settles with you from their own screen. Once they do, the amount above drops
                and what you earned stays.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },

    tabs: {
      flexDirection: "row",
      backgroundColor: c.surfaceAlt,
      borderRadius: 14,
      padding: 3,
      gap: 3,
    },
    tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 11 },
    tabOn: { backgroundColor: c.surface },
    tabText: { ...typography.small, color: c.textMuted, fontWeight: "600" },
    tabTextOn: { color: c.text, fontWeight: "800" },

    hero: {
      backgroundColor: c.primary,
      borderRadius: radius.lg,
      padding: spacing.lg,
      alignItems: "center",
      gap: 4,
    },
    heroValue: { ...typography.display, color: c.onPrimary, fontSize: 32 },
    heroLabel: { ...typography.small, color: c.brand[100] },

    cash: {
      backgroundColor: c.warmSoft,
      borderWidth: 1,
      borderColor: c.warm,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: 6,
    },
    cashHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    cashTitle: { ...typography.label, color: c.onWarm, flex: 1, fontSize: 14 },
    cashValue: { ...typography.h3, color: c.onWarm, fontSize: 18 },
    cashHint: { ...typography.tiny, color: c.onWarm, lineHeight: 16, opacity: 0.85 },

    caption: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "700",
      marginTop: spacing.sm,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    shop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    shopDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    shopCopy: { flex: 1, gap: 1 },
    shopName: { ...typography.body, color: c.text, fontSize: 14.5, fontWeight: "500" },
    shopMeta: { ...typography.tiny, color: c.textMuted },
    shopCash: { ...typography.label, color: c.text, fontSize: 14.5 },

    skeletons: { gap: spacing.sm, marginTop: spacing.sm },

    note: {
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
      marginTop: spacing.sm,
      paddingHorizontal: 2,
    },
    noteText: { ...typography.tiny, color: c.textMuted, flex: 1, lineHeight: 16 },
  });
