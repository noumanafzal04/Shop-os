import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Touchable } from "@cartze/core/ui/Touchable";
import { money } from "@cartze/core/format";
import { ChevronRightIcon, MotorcycleIcon, BagIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { STATUS_LABEL } from "../services/orderStages";
import type { Order } from "../services/ordersService";

/**
 * ONE ORDER IN THE QUEUE.
 *
 * What a shopkeeper needs before opening it: whose it is, how much, how long
 * it has been waiting, and whether it is going out on a bike. The number of
 * items rather than the items themselves — the list is scanned, not read.
 *
 * ── Waiting time is the thing this card is FOR ───────────────────────
 *
 * Not the clock time it was placed. "11:42" makes somebody do the subtraction
 * during service; "18 min" is the answer they were going to work out. It turns
 * to the brand colour past fifteen minutes, because that is when an order
 * stops being new and starts being late.
 */
export function OrderCard({ order, onPress }: { order: Order; onPress: () => void }) {
  const c = useColors();
  const s = styles(c);

  const waited = minutesSince(order.placed_at);
  const late = waited >= 15;
  const items = order.items?.length ?? 0;
  const delivery = order.fulfillment_type === "delivery";

  return (
    <Touchable onPress={onPress} accessibilityRole="button" style={s.card}>
      <View style={s.top}>
        <View style={s.who}>
          <Text style={s.name} numberOfLines={1}>
            {order.customer_name}
          </Text>
          <Text style={s.number} numberOfLines={1}>
            {order.order_number}
          </Text>
        </View>
        <Text style={s.total}>{money(order.total)}</Text>
      </View>

      <View style={s.bottom}>
        <View style={s.chip}>
          <Text style={s.chipText}>{STATUS_LABEL[order.status]}</Text>
        </View>

        {delivery ? (
          <MotorcycleIcon size={16} color={c.textMuted} />
        ) : (
          <BagIcon size={16} color={c.textMuted} />
        )}

        <Text style={s.meta} numberOfLines={1}>
          {items} {items === 1 ? "item" : "items"}
        </Text>

        <Text style={[s.waited, late ? s.waitedLate : null]}>{waitLabel(waited)}</Text>

        <ChevronRightIcon size={18} color={c.textMuted} />
      </View>

      {/**
       * A DELIVERY WITH NOBODY CARRYING IT.
       *
       * Said on the card rather than only in a filter, because it is the one
       * state where nothing is visibly wrong and a customer is waiting for a
       * bike that was never sent.
       */}
      {delivery && !order.rider_id && order.status === "out_for_delivery" ? (
        <Text style={s.warn}>No rider assigned</Text>
      ) : null}
    </Touchable>
  );
}

function minutesSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60_000));
}

/** "just now" under a minute, then minutes, then hours — never "0 min". */
function waitLabel(mins: number): string {
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} hr${h === 1 ? "" : "s"}`;
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm + 2,
    },
    top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    who: { flex: 1, gap: 2 },
    name: { ...typography.h3, fontSize: 17, color: c.text },
    number: { ...typography.small, color: c.textMuted },
    total: { ...typography.h3, fontSize: 17, color: c.text },
    bottom: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    chip: {
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 3,
      borderRadius: 8,
    },
    chipText: { ...typography.tiny, fontSize: 12, color: c.textSecondary },
    meta: { ...typography.small, color: c.textSecondary, flex: 1 },
    waited: { ...typography.small, color: c.textMuted },
    waitedLate: { color: c.primaryPressed, fontWeight: "700" },
    warn: { ...typography.small, color: c.error },
  });
