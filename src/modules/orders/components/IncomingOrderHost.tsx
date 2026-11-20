import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { money } from "@cartze/core/format";
import { toast } from "@cartze/core/ui/toast";
import { confirm } from "@cartze/core/ui/confirm";
import { BagIcon, BellIcon, MotorcycleIcon } from "@cartze/core/ui/icons";
import { radius, spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAuthStore } from "../../../stores/authStore";
import { holds } from "../../../common/permissions";
import { useAdvanceOrder, useCancelOrder, useOrders } from "../hooks/useOrders";
import { nextToRing, RING_PATTERN, waited, waitingBehind } from "../incoming";

/**
 * THE NEW-ORDER SCREEN — over whatever tab is open.
 *
 * Mounted once, inside the navigator, for whoever runs orders. It reads the
 * waiting (pending) orders on the same 15-second poll as the queue, and when
 * there is one it takes the screen and buzzes until it is accepted, rejected,
 * or put off with "Later". See `incoming.ts` for the rules.
 */
export function IncomingOrderHost({ onOpen }: { onOpen: (orderId: string) => void }) {
  const user = useAuthStore((s) => s.user);
  if (!holds(user, "orders.manage")) return null;
  return <Ringer onOpen={onOpen} />;
}

function Ringer({ onOpen }: { onOpen: (orderId: string) => void }) {
  const c = useColors();
  const s = styles(c);
  const insets = useSafeAreaInsets();
  const pending = useOrders({ status: "pending" });
  const advance = useAdvanceOrder();
  const cancel = useCancelOrder();
  const [later, setLater] = useState<ReadonlySet<string>>(new Set());

  const list = useMemo(() => pending.data?.orders ?? [], [pending.data]);
  const order = nextToRing(list, later);
  const behind = waitingBehind(list, later);
  const busy = advance.isPending || cancel.isPending;

  // Buzz while an order is on screen; stop the moment it is not.
  useEffect(() => {
    if (!order) return;
    Vibration.vibrate(RING_PATTERN, true);
    return () => Vibration.cancel();
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;

  const delivery = order.fulfillment_type === "delivery";
  const Mode = delivery ? MotorcycleIcon : BagIcon;
  const items = order.items ?? [];

  const accept = () =>
    advance.mutate(
      { id: order.id, status: "confirmed" },
      {
        onSuccess: () => toast.success(`Accepted — ${order.order_number}`),
        onError: () => toast.error("Couldn't accept it. Check the connection and try again."),
      },
    );

  const reject = async () => {
    const yes = await confirm.ask({
      title: `Reject ${order.order_number}?`,
      message: "The customer is told the shop could not take it, and nothing is charged.",
      confirmLabel: "Reject order",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!yes) return;
    cancel.mutate(
      { id: order.id, reason: "The shop could not take this order right now." },
      {
        onSuccess: () => toast.info(`Rejected — ${order.order_number}`),
        onError: () => toast.error("Couldn't reject it. Try again."),
      },
    );
  };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={() => setLater(new Set([...later, order.id]))}>
      <View style={[s.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={s.head}>
          <View style={s.bell}>
            <BellIcon size={26} color={c.onPrimary} bold />
          </View>
          <Text style={s.kicker}>New order</Text>
          <Text style={s.number}>{order.order_number}</Text>
          <Text style={s.when}>
            {waited(order.placed_at)}
            {behind > 0 ? ` · ${behind} more waiting` : ""}
          </Text>
        </View>

        <View style={s.card}>
          <View style={s.metaRow}>
            <View style={s.modePill}>
              <Mode size={14} color={c.primaryPressed} />
              <Text style={s.modeText}>{delivery ? "Delivery" : order.fulfillment_type === "dine_in" ? "Dine-in" : "Pick-up"}</Text>
            </View>
            <Text style={s.customer} numberOfLines={1}>
              {order.customer_name}
            </Text>
          </View>

          <ScrollView style={s.items} contentContainerStyle={s.itemsInner}>
            {items.map((it) => (
              <View key={it.id} style={s.itemRow}>
                <Text style={s.qty}>{Number(it.quantity)}×</Text>
                <View style={s.itemCopy}>
                  <Text style={s.itemName}>
                    {it.product_name}
                    {it.variant_name ? ` (${it.variant_name})` : ""}
                  </Text>
                  {!!it.modifiers?.length && (
                    <Text style={s.itemMods} numberOfLines={2}>
                      {it.modifiers.map((m) => m.name ?? m.option).filter(Boolean).join(", ")}
                    </Text>
                  )}
                </View>
                <Text style={s.itemTotal}>{money(it.line_total)}</Text>
              </View>
            ))}
            {!!order.notes && <Text style={s.notes}>Note: {order.notes}</Text>}
            {delivery && !!order.delivery_address && (
              <Text style={s.address} numberOfLines={2}>
                {order.delivery_address}
              </Text>
            )}
          </ScrollView>

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total · {order.payment_method === "paid" ? "Paid online" : "Cash on delivery"}</Text>
            <Text style={s.total}>{money(order.total)}</Text>
          </View>
        </View>

        <View style={s.actions}>
          <Pressable
            style={({ pressed }) => [s.reject, pressed && s.pressed]}
            onPress={reject}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Reject ${order.order_number}`}
          >
            <Text style={s.rejectText}>Reject</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.accept, pressed && s.pressed, busy && s.disabled]}
            onPress={accept}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Accept ${order.order_number}`}
          >
            <Text style={s.acceptText}>{advance.isPending ? "Accepting…" : "Accept order"}</Text>
          </Pressable>
        </View>
        <View style={s.links}>
          <Pressable
            onPress={() => {
              setLater(new Set([...later, order.id]));
              onOpen(order.id);
            }}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={s.link}>Open full order</Text>
          </Pressable>
          <Pressable onPress={() => setLater(new Set([...later, order.id]))} hitSlop={10} accessibilityRole="button">
            <Text style={s.linkMuted}>Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.primary, paddingHorizontal: spacing.md, gap: spacing.md },
    head: { alignItems: "center", gap: 4, paddingTop: spacing.sm },
    bell: {
      width: 56,
      height: 56,
      borderRadius: 26,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xs,
    },
    kicker: { ...typography.label, color: c.onPrimary, opacity: 0.85, letterSpacing: 1, textTransform: "uppercase" },
    number: { ...typography.title, color: c.onPrimary, fontSize: 28, lineHeight: 34 },
    when: { ...typography.small, color: c.onPrimary, opacity: 0.85 },
    card: { flex: 1, backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.ms },
    metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    modePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: c.primarySoft,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
    },
    modeText: { ...typography.label, color: c.primaryPressed, fontSize: 13, lineHeight: 18 },
    customer: { ...typography.label, color: c.text, flex: 1, fontSize: 15, lineHeight: 20 },
    items: { flex: 1 },
    itemsInner: { gap: spacing.sm },
    itemRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    qty: { ...typography.label, color: c.primaryPressed, fontSize: 17, lineHeight: 24, minWidth: 34 },
    itemCopy: { flex: 1 },
    itemName: { ...typography.body, color: c.text, fontSize: 17, lineHeight: 24 },
    itemMods: { ...typography.small, color: c.textSecondary },
    itemTotal: { ...typography.label, color: c.text, fontSize: 15, lineHeight: 24 },
    notes: { ...typography.small, color: c.warning, fontWeight: "700" },
    address: { ...typography.small, color: c.textSecondary },
    totalRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.ms,
    },
    totalLabel: { ...typography.small, color: c.textSecondary, flex: 1 },
    total: { ...typography.title, color: c.text, fontSize: 22, lineHeight: 28 },
    actions: { flexDirection: "row", gap: spacing.sm },
    reject: {
      flex: 1,
      height: 58,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.7)",
      alignItems: "center",
      justifyContent: "center",
    },
    rejectText: { ...typography.label, color: c.onPrimary, fontSize: 17 },
    accept: {
      flex: 2,
      height: 58,
      borderRadius: 18,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    acceptText: { ...typography.label, color: c.primaryPressed, fontSize: 18, fontWeight: "800" },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.6 },
    links: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.xs },
    link: { ...typography.label, color: c.onPrimary, textDecorationLine: "underline" },
    linkMuted: { ...typography.label, color: c.onPrimary, opacity: 0.8 },
  });
