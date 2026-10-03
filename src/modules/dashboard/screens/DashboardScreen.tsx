import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Gradient } from "@cartze/core/ui/Gradient";
import { usePullToRefresh } from "@cartze/core/hooks/usePullToRefresh";
import { money } from "@cartze/core/format";
import {
  AlertTriangleIcon,
  BoxIcon,
  ClockIcon,
  PersonIcon,
  ReceiptIcon,
  type Icon,
} from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAuthStore } from "../../../stores/authStore";
import { useDashboard } from "../hooks/useDashboard";
import { WeekChart } from "../components/WeekChart";
import { StatTile } from "../components/StatTile";
import type { Dashboard } from "../services/dashboardService";
import { ScreenHeader } from "../../../common/components/ScreenHeader";

/**
 * TODAY, FOR SOMEBODY STANDING BEHIND A COUNTER.
 *
 * The order of this screen is the order the questions get asked, and it is not
 * the order the API returns them in:
 *
 *   1. what have I taken today          the reason the app was opened
 *   2. what needs me right now          orders waiting, stock about to bite
 *   3. how has the week gone            context, once the urgent is handled
 *   4. who owes whom                    asked last, but asked
 *
 * Money the shop has not been paid sits at the bottom, not because it matters
 * least but because it is never the reason somebody unlocks their phone
 * mid-service.
 */
export function DashboardScreen() {
  const c = useColors();
  const s = styles(c);
  const user = useAuthStore((st) => st.user);

  // Branch picking arrives with the Money tab. Until then this is the owner's
  // All-Branches view, which is what a single-branch shop sees anyway.
  const { data, isLoading, isError, refetch } = useDashboard(null);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  return (
    <SafeScreen edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
        }
      >
        <ScreenHeader
          title={user?.tenant?.business_name ?? "Your shop"}
          subtitle={todayLabel()}
        />

        {isLoading ? <Loading /> : null}

        {isError && !data ? (
          <LoadFailed
            what="today's figures"
            onRetry={() => {
              void refetch();
            }}
          />
        ) : null}

        {data ? <Body data={data} /> : null}
      </ScrollView>
    </SafeScreen>
  );
}

function Body({ data }: { data: Dashboard }) {
  const c = useColors();
  const s = styles(c);
  const t = data.today;

  /**
   * Revenue minus refunds, and it is NOT `revenue`.
   *
   * The server publishes the two separately on purpose — a refund is dated by
   * the day it went out, so netting it into revenue would rewrite the day the
   * sale came in. But the figure a shopkeeper means by "what did I take today"
   * is the one with today's refunds already out of it, so the headline does
   * that arithmetic and says so underneath when there were any.
   */
  const taken = t.revenue - t.refunds;

  return (
    <View style={s.body}>
      {/*
        1 — WHAT HAVE I TAKEN, on the brand's own ramp.

        This was a pale tint of the brand with dark type on it — correct, and
        indistinguishable from the four cards underneath it. The one number
        somebody unlocked their phone for was the same weight as the count of
        items running low.

        A gradient earns its place here for the reason it does on the
        customer's home screen: the palette is a ten-step strip whose defining
        property is that it travels, and this is the one block on the screen
        big enough to show it. Everything inside is therefore drawn for a dark
        ground — see `ThemeColors.gradient`, whose first stop is the one that
        has to carry type.
      */}
      <Gradient style={s.hero} direction="vertical" borderRadius={18}>
        <Text style={s.heroLabel}>Taken today</Text>
        <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {money(taken)}
        </Text>

        <View style={s.heroMeta}>
          {t.deltas.revenue != null ? (
            <Text
              style={[
                s.heroDelta,
                t.deltas.revenue >= 0 ? { color: c.success } : { color: c.error },
              ]}
            >
              {t.deltas.revenue > 0 ? "+" : ""}
              {Math.round(t.deltas.revenue)}% vs yesterday
            </Text>
          ) : (
            // Said out loud rather than left blank: an empty space where a
            // comparison usually sits reads as a number that failed to load.
            <Text style={s.heroQuiet}>No takings yesterday to compare</Text>
          )}
          {t.refunds > 0 ? (
            <Text style={s.heroQuiet}>{money(t.refunds)} refunded today</Text>
          ) : null}
        </View>
      </Gradient>

      <View style={s.row}>
        <StatTile label="Sales" value={String(t.sales_count)} icon={ReceiptIcon} />
        <StatTile label="Customers" value={String(t.customers_count)} icon={PersonIcon} />
      </View>

      {/* 2 — what needs me */}
      {data.order_pipeline.pending + data.order_pipeline.preparing + data.order_pipeline.delivery >
      0 ? (
        <Section title="Orders on the go">
          <View style={s.pipeline}>
            <Stage label="Waiting" count={data.order_pipeline.pending} urgent />
            <Stage label="Preparing" count={data.order_pipeline.preparing} />
            <Stage label="On the way" count={data.order_pipeline.delivery} />
          </View>
        </Section>
      ) : null}

      {data.inventory.out_of_stock + data.inventory.low_stock + data.inventory.expiring_soon > 0 ? (
        <Section title="Needs attention">
          <View style={s.alerts}>
            {data.inventory.out_of_stock > 0 ? (
              <Alert
                icon={BoxIcon}
                text={`${data.inventory.out_of_stock} ${plural(data.inventory.out_of_stock, "item", "items")} out of stock`}
              />
            ) : null}
            {data.inventory.low_stock > 0 ? (
              <Alert
                icon={AlertTriangleIcon}
                text={`${data.inventory.low_stock} running low`}
              />
            ) : null}
            {data.inventory.expiring_soon > 0 ? (
              <Alert
                icon={ClockIcon}
                text={`${data.inventory.expiring_soon} expiring soon`}
              />
            ) : null}
          </View>
        </Section>
      ) : null}

      {/* 3 — how has the week gone */}
      <Section title="This week">
        <WeekChart series={data.sales_series} />
      </Section>

      <View style={s.row}>
        <StatTile
          label="Spent today"
          value={money(t.expenses)}
          delta={t.deltas.expenses}
          invert
        />
        <StatTile label="Profit today" value={money(t.profit)} delta={t.deltas.profit} />
      </View>

      {/* 4 — who owes whom */}
      {data.money_owed.receivable.total > 0 || data.money_owed.payable.total > 0 ? (
        <Section title="Money owed">
          <View style={s.owed}>
            <Owed
              label="Owed to you"
              total={data.money_owed.receivable.total}
              accounts={data.money_owed.receivable.accounts}
            />
            <View style={s.owedRule} />
            <Owed
              label="You owe"
              total={data.money_owed.payable.total}
              accounts={data.money_owed.payable.accounts}
            />
          </View>
        </Section>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const s = styles(useColors());
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Stage({ label, count, urgent }: { label: string; count: number; urgent?: boolean }) {
  const c = useColors();
  const s = styles(c);
  return (
    <View style={s.stage}>
      {/* `primaryPressed` — see PartnerTabs. `primary` is 2.54:1 on this card,
        and this is the URGENT count: the one number on the screen that has to
        be read was drawn in the one colour that could not be. */}
    <Text style={[s.stageCount, urgent && count > 0 ? { color: c.primaryPressed } : null]}>
      {count}
    </Text>
      <Text style={s.stageLabel}>{label}</Text>
    </View>
  );
}

function Alert({ icon: Glyph, text }: { icon: Icon; text: string }) {
  const c = useColors();
  const s = styles(c);
  return (
    <View style={s.alert}>
      <Glyph size={18} color={c.warning} />
      <Text style={s.alertText}>{text}</Text>
    </View>
  );
}

function Owed({ label, total, accounts }: { label: string; total: number; accounts: number }) {
  const s = styles(useColors());
  return (
    <View style={s.owedHalf}>
      <Text style={s.owedLabel}>{label}</Text>
      <Text style={s.owedValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {money(total)}
      </Text>
      <Text style={s.owedSub}>
        {accounts} {plural(accounts, "account", "accounts")}
      </Text>
    </View>
  );
}

function Loading() {
  const s = styles(useColors());
  return (
    <View style={s.body}>
      <Skeleton height={120} borderRadius={18} />
      <View style={s.row}>
        <Skeleton height={96} borderRadius={14} style={{ flex: 1 }} />
        <Skeleton height={96} borderRadius={14} style={{ flex: 1 }} />
      </View>
      <Skeleton height={220} borderRadius={18} />
    </View>
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Thursday, 18 September" — the shop's own clock, not UTC. */
function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    /**
     * The gutter moved OFF the scroll container and onto the body.
     *
     * `ScreenHeader` carries its own horizontal padding, so leaving 16 on the
     * ScrollView too would inset the title twice — 32 on this screen and 16 on
     * every other one, which is the kind of difference nobody can name and
     * everybody can see.
     */
    content: { paddingBottom: spacing.xxl },
    body: { gap: spacing.md, padding: spacing.md },

    hero: {
      // No `backgroundColor` — `Gradient` paints it. Leaving one here would
      // draw a flat fill UNDER an SVG that already covers the block, which
      // costs a layer and shows as a hairline at the rounded corners.
      padding: spacing.lg,
    },
    // Drawn for the ramp, not for the page: `inkMuted` is the muted tier for
    // a dark block, where `textSecondary` disappears.
    heroLabel: { ...typography.label, color: c.inkMuted },
    /**
     * 40pt. The largest number on the screen because it is the only one most
     * people came for, and it shrinks rather than wraps so a busy day and a
     * quiet one lay out identically.
     */
    heroValue: {
      ...typography.display,
      fontSize: 40,
      color: c.textInverse,
      marginTop: spacing.xs,
    },
    heroMeta: { marginTop: spacing.sm, gap: 2 },
    heroDelta: { ...typography.label, fontSize: 13 },
    heroQuiet: { ...typography.small, color: c.inkMuted },

    row: { flexDirection: "row", gap: spacing.md },

    section: { gap: spacing.sm },
    sectionTitle: { ...typography.label, color: c.textSecondary, marginLeft: 2 },
    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
    },

    pipeline: { flexDirection: "row" },
    stage: { flex: 1, alignItems: "center", gap: 4 },
    stageCount: { ...typography.display, fontSize: 28, color: c.text },
    stageLabel: { ...typography.small, color: c.textSecondary },

    alerts: { gap: spacing.sm + 2 },
    alert: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    alertText: { ...typography.body, color: c.text, flexShrink: 1 },

    owed: { flexDirection: "row", alignItems: "stretch" },
    owedHalf: { flex: 1, gap: 2 },
    owedRule: { width: StyleSheet.hairlineWidth, backgroundColor: c.border, marginHorizontal: spacing.md },
    owedLabel: { ...typography.small, color: c.textSecondary },
    owedValue: { ...typography.title, fontSize: 22, color: c.text },
    owedSub: { ...typography.tiny, fontSize: 12, color: c.textMuted },
  });
