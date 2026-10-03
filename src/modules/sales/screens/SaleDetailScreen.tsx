import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { money, qtyText } from "@cartze/core/format";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { CHANNEL_LABEL, PAYMENT_LABEL, STATUS_LABEL, STATUS_TONE } from "../saleWords";
import { useSale } from "../hooks/useSales";
import type { Sale } from "../services/salesService";
import type { SalesStackParamList } from "../../../navigation/types";

/**
 * ONE SALE, AND NOTHING YOU CAN DO TO IT.
 *
 * ── Read-only is the design, not a gap ───────────────────────────────
 *
 * Cancelling, refunding and exchanging all move stock and money in several
 * directions at once — the drawer, the batches, a customer's khata, the
 * month's figures. The screen that does that needs the whole picture and a
 * keyboard; it is the panel. A phone with a Refund button and none of that
 * context is a way to get it wrong quickly.
 *
 * So there is no action bar here on purpose, and the screen says what
 * happened rather than offering to change it.
 *
 * ── Both numbers, when there are two ─────────────────────────────────
 *
 * A sale rung with no server carries an `OFF-…` slip number, and the invoice
 * number is assigned later on sync. The customer only ever saw the first one.
 * Showing just the invoice number means a shopkeeper holding the printed slip
 * cannot match it to the row they are looking at.
 */
export function SaleDetailScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<SalesStackParamList, "SaleDetail">>();

  const { data, isLoading, isError, refetch } = useSale(params.id);

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader
        title={data ? (data.offline_number ?? data.invoice_number) : "Sale"}
        subtitle={data?.branch?.name ?? undefined}
        onBack={() => nav.goBack()}
      />

      {isLoading && !data ? (
        <View style={s.body}>
          <Skeleton height={120} borderRadius={18} />
          <Skeleton height={180} borderRadius={18} />
        </View>
      ) : isError && !data ? (
        <View style={s.body}>
          <LoadFailed
            what="this sale"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={s.body}>
          <Hero sale={data} />
          <Lines sale={data} />
          <Totals sale={data} />
          {data.notes ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Note</Text>
              <Text style={s.note}>{data.notes}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeScreen>
  );
}

function Hero({ sale }: { sale: Sale }) {
  const c = useColors();
  const s = styles(c);
  const tone = STATUS_TONE[sale.status];

  return (
    <View style={s.hero}>
      <Text style={s.heroLabel}>
        {CHANNEL_LABEL[sale.channel] ?? sale.channel} ·{" "}
        {PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method}
      </Text>
      <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {money(sale.total)}
      </Text>
      <Text style={s.heroSub}>{fullWhen(sale.sold_at)}</Text>

      {tone !== "none" ? (
        <View
          style={[s.pill, { backgroundColor: tone === "bad" ? c.errorBg : c.warningBg }]}
        >
          <Text style={[s.pillText, { color: tone === "bad" ? c.error : c.warning }]}>
            {STATUS_LABEL[sale.status]}
          </Text>
        </View>
      ) : null}

      {/*
        BOTH NUMBERS, and only when there are two. Printing "Invoice INV-0042"
        under a heading that already says INV-0042 is a row that says nothing.
      */}
      {sale.offline_number ? (
        <Text style={s.heroSub}>Invoice {sale.invoice_number}</Text>
      ) : null}
    </View>
  );
}

function Lines({ sale }: { sale: Sale }) {
  const c = useColors();
  const s = styles(c);
  const items = sale.items ?? [];

  if (items.length === 0) {
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>Items</Text>
        {/*
          SAID, not left blank. The list endpoint does not eager-load items
          and the detail one does, so an empty array here means the sale
          genuinely has no lines — but a card that simply ends looks like a
          render that failed, and this screen has no other way to say so.
        */}
        <Text style={s.quiet}>No items recorded on this sale.</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>
        {items.length} {items.length === 1 ? "item" : "items"}
      </Text>
      {items.map((line) => (
        <View key={line.id} style={s.line}>
          <Text style={s.lineQty}>{qtyText(line.quantity)}×</Text>
          <View style={s.lineBody}>
            <Text style={s.lineName} numberOfLines={2}>
              {line.product_name}
              {line.variant_name ? ` · ${line.variant_name}` : ""}
            </Text>
            <Text style={s.quiet}>{money(line.unit_price)} each</Text>
          </View>
          <Text style={s.lineTotal}>{money(line.line_total)}</Text>
        </View>
      ))}
    </View>
  );
}

function Totals({ sale }: { sale: Sale }) {
  const c = useColors();
  const s = styles(c);
  const discount = Number(sale.discount ?? 0);
  const tax = Number(sale.tax ?? 0);
  const paid = sale.amount_paid == null ? null : Number(sale.amount_paid);
  const change = sale.change_due == null ? null : Number(sale.change_due);

  return (
    <View style={s.card}>
      <Row label="Subtotal" value={money(sale.subtotal)} />
      {discount > 0 ? <Row label="Discount" value={`− ${money(discount)}`} /> : null}
      {tax > 0 ? <Row label="Tax" value={money(tax)} /> : null}
      <View style={s.rule} />
      <Row label="Total" value={money(sale.total)} strong />
      {/*
        `> 0`, not `!= null`. A card sale records `amount_paid` equal to the
        total and no change; printing "Paid 1,200 / Change 0" under "Total
        1,200" is three rows saying one thing.
      */}
      {paid != null && change != null && change > 0 ? (
        <>
          <Row label="Paid" value={money(paid)} />
          <Row label="Change" value={money(change)} />
        </>
      ) : null}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const c = useColors();
  const s = styles(c);
  return (
    <View style={s.totalRow}>
      <Text style={[s.totalLabel, strong && s.strong]}>{label}</Text>
      <Text style={[s.totalValue, strong && s.strong]}>{value}</Text>
    </View>
  );
}

/** The full date and time, guarded the same way the row's short form is. */
export function fullWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

    hero: {
      backgroundColor: c.primarySoft,
      borderRadius: 18,
      padding: spacing.lg,
      gap: 2,
      alignItems: "flex-start",
    },
    heroLabel: { ...typography.label, color: c.primaryPressed },
    heroValue: { ...typography.display, fontSize: 36, color: c.text, marginTop: 2 },
    heroSub: { ...typography.small, color: c.textSecondary },

    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardTitle: { ...typography.label, color: c.textSecondary },
    quiet: { ...typography.small, color: c.textMuted },
    note: { ...typography.body, color: c.text },

    line: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    lineQty: { ...typography.label, color: c.textSecondary, minWidth: 34 },
    lineBody: { flex: 1, gap: 1 },
    lineName: { ...typography.body, color: c.text },
    lineTotal: { ...typography.label, color: c.text, fontVariant: ["tabular-nums"] },

    totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    totalLabel: { ...typography.body, color: c.textSecondary },
    totalValue: { ...typography.body, color: c.text, fontVariant: ["tabular-nums"] },
    strong: { ...typography.label, color: c.text },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 2 },

    pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
    pillText: { ...typography.tiny, fontWeight: "700" },
  });
