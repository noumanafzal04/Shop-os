import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { ChipBar } from "@cartze/core/ui/ChipBar";
import { EmptyState } from "@cartze/core/ui/EmptyState";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { useDebouncedValue } from "@cartze/core/hooks/useDebouncedValue";
import { usePullToRefresh } from "@cartze/core/hooks/usePullToRefresh";
import { money } from "@cartze/core/format";
import { ChevronRightIcon, ReceiptIcon, SearchIcon } from "@cartze/core/ui/icons";
import { radius, spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useSalesList } from "../hooks/useSales";
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE } from "../saleWords";
import type { Sale, SaleStatus } from "../services/salesService";
import type { SalesStackParamList } from "../../../navigation/types";

/**
 * THE LEDGER — where an order comes to rest.
 *
 * ── Why this is not the Orders tab with a different filter ───────────
 *
 * The queue is about what has to HAPPEN: four stages, counts, a rider who has
 * not been assigned. This is about what DID happen, and nothing on it is
 * actionable. Reading one list for both questions means the urgent rows are
 * buried under three months of finished ones.
 *
 * ── Opens on everything, and says so when it does not ────────────────
 *
 * No status is selected on arrival. The same reason the queue opens on ALL: a
 * filter applied before anybody asked for one hides rows, and the person is
 * not looking for the control that is hiding them. When a chip IS on, the
 * empty state names it — an empty list that cannot say why reads as a fact
 * about the shop rather than about the filter.
 */

const STATUSES: Array<{ key: SaleStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "refunded", label: "Refunded" },
  { key: "partially_refunded", label: "Part refund" },
  { key: "cancelled", label: "Cancelled" },
];

export function SalesScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation<NativeStackNavigationProp<SalesStackParamList>>();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SaleStatus | "all">("all");

  /**
   * Debounced, because every keystroke would otherwise be a query — and a
   * shopkeeper typing an invoice number types eight characters. 350ms is the
   * same figure the customer app's search uses; one number, one feel.
   */
  const typed = useDebouncedValue(search, 350);

  const query = useMemo(
    () => ({ search: typed, ...(status === "all" ? {} : { status }) }),
    [typed, status],
  );

  const list = useSalesList(query);
  const { refreshing, onRefresh } = usePullToRefresh(list.refetch);

  /** Every page, flattened. The list is read by scrolling; the pages are a
   *  transport detail and nothing on screen should know about them. */
  const sales: Sale[] = useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => p.data),
    [list.data],
  );

  const total = list.data?.pages[0]?.meta.pagination?.total;
  const filtered = status !== "all" || typed.trim() !== "";

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader
        title="Sales"
        subtitle={
          total == null
            ? undefined
            : `${total} ${total === 1 ? "sale" : "sales"}${filtered ? " match" : ""}`
        }
        onBack={() => nav.goBack()}
      />

      <View style={s.search}>
        <AppTextInput
          icon={SearchIcon}
          placeholder="Invoice number, customer or phone…"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <ChipBar items={STATUSES} active={status} onPick={setStatus} />

      {list.isLoading && sales.length === 0 ? (
        <View style={s.list}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={78} borderRadius={16} />
          ))}
        </View>
      ) : list.isError && sales.length === 0 ? (
        <View style={s.list}>
          <LoadFailed
            what="your sales"
            onRetry={() => {
              void list.refetch();
            }}
          />
        </View>
      ) : (
        <FlatList
          data={sales}
          keyExtractor={(sale) => sale.id}
          contentContainerStyle={[s.list, sales.length === 0 ? s.listEmpty : null]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
          }
          /**
           * 0.4, not 0.1. A phone list scrolls fast enough that asking at the
           * very end shows a spinner every time; asking at 40% from the
           * bottom means the next page is usually already there.
           */
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <SaleRow sale={item} onPress={() => nav.navigate("SaleDetail", { id: item.id })} />
          )}
          ListFooterComponent={
            list.isFetchingNextPage ? <Skeleton height={78} borderRadius={16} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={ReceiptIcon}
              tone="muted"
              title={filtered ? "Nothing matches" : "No sales yet"}
              message={
                filtered
                  ? "Try a different status, or clear the search."
                  : "Sales rung at the till and completed online orders both land here."
              }
            />
          }
        />
      )}
    </SafeScreen>
  );
}

/**
 * One row: what was sold, to whom, for how much.
 *
 * The NUMBER the customer was given leads — which is the offline slip number
 * when there is one, because that is the only number they ever saw. See
 * `offline_number` on the type.
 */
function SaleRow({ sale, onPress }: { sale: Sale; onPress: () => void }) {
  const c = useColors();
  const s = styles(c);
  const tone = STATUS_TONE[sale.status];

  return (
    <Touchable onPress={onPress} accessibilityRole="button" style={s.row}>
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text style={s.number} numberOfLines={1}>
            {sale.offline_number ?? sale.invoice_number}
          </Text>
          {sale.status !== "completed" ? (
            <View style={[s.pill, { backgroundColor: tone === "bad" ? c.errorBg : c.warningBg }]}>
              <Text style={[s.pillText, { color: tone === "bad" ? c.error : c.warning }]}>
                {STATUS_LABEL[sale.status]}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={s.meta} numberOfLines={1}>
          {whenText(sale.sold_at)} · {CHANNEL_LABEL[sale.channel] ?? sale.channel}
          {sale.customer_name ? ` · ${sale.customer_name}` : ""}
        </Text>
      </View>
      <Text style={s.amount}>{money(sale.total)}</Text>
      <ChevronRightIcon size={18} color={c.textMuted} />
    </Touchable>
  );
}

/**
 * The date as a person would say it: a time for today, a weekday this week,
 * a date before that.
 *
 * Built from the device's locale rather than a hand-rolled format, and the
 * parse is guarded — `sold_at` has been an ISO string on every response seen,
 * and a row that renders "Invalid Date" over a correct amount is worse than
 * one that renders the raw string.
 */
export function whenText(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days < 7 && days >= 0) {
    return at.toLocaleDateString(undefined, { weekday: "short" });
  }
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    search: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
    list: { padding: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
    listEmpty: { flexGrow: 1, justifyContent: "center" },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingVertical: spacing.sm + 4,
      paddingHorizontal: spacing.md,
    },
    rowBody: { flex: 1, gap: 3 },
    rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    number: { ...typography.label, color: c.text, flexShrink: 1 },
    meta: { ...typography.small, color: c.textSecondary },
    amount: { ...typography.label, color: c.text, fontVariant: ["tabular-nums"] },

    pill: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
    pillText: { ...typography.tiny, fontWeight: "700" },
  });
