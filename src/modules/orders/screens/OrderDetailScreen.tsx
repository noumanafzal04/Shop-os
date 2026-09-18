import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { ScreenHeader } from "@cartze/core/ui/ScreenHeader";
import { AppButton } from "@cartze/core/ui/AppButton";
import { LoadFailed } from "@cartze/core/ui/LoadFailed";
import { Skeleton } from "@cartze/core/ui/Skeleton";
import { confirm } from "@cartze/core/ui/confirm";
import { toast } from "@cartze/core/ui/toast";
import { ApiError } from "@cartze/core/types/api";
import { money, qtyText } from "@cartze/core/format";
import { MapPinIcon, PhoneIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useAdvanceOrder, useCancelOrder, useOrder } from "../hooks/useOrders";
import { ACTION_LABEL, STATUS_LABEL, nextStates, type OrderStatus } from "../services/orderStages";
import type { Order } from "../services/ordersService";
import type { OrdersStackParamList } from "../../../navigation/types";

/**
 * ONE ORDER, AND THE ONE THING TO DO WITH IT NEXT.
 *
 * ── Why there is a single action button ──────────────────────────────
 *
 * `nextStates` almost always returns exactly two: the step forward and cancel.
 * Drawing both as equal buttons makes somebody read before pressing, during
 * service, with a customer in front of them. The forward step is the button;
 * cancelling is a quieter control underneath, because it is rare and
 * irreversible.
 */
export function OrderDetailScreen() {
  const c = useColors();
  const s = styles(c);
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<OrdersStackParamList, "OrderDetail">>();

  const { data: order, isLoading, isError, refetch } = useOrder(params.id);
  const advance = useAdvanceOrder();
  const cancel = useCancelOrder();

  const busy = advance.isPending || cancel.isPending;

  async function moveTo(status: OrderStatus) {
    try {
      await advance.mutateAsync({ id: params.id, status });
      toast.success(`Order is now ${STATUS_LABEL[status].toLowerCase()}`);
    } catch (e) {
      /**
       * The server re-checks the transition. `ORDER_INVALID_TRANSITION` means
       * this app's mirror of the stage rules has drifted, or somebody else
       * moved the order first — both are worth saying plainly rather than as
       * "something went wrong".
       */
      toast.error(e instanceof ApiError ? e.message : "Could not update the order");
    }
  }

  async function reject() {
    if (!order) return;

    const yes = await confirm.ask({
      title: `Cancel ${order.order_number}?`,
      // Named consequences, because this one cannot be taken back and the
      // stock movement surprises people.
      message: "The customer is told, and any stock this order held is put back.",
      confirmLabel: "Cancel order",
      tone: "danger",
    });
    if (!yes) return;

    try {
      await cancel.mutateAsync({ id: params.id });
      toast.success("Order cancelled");
      nav.goBack();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not cancel the order");
    }
  }

  return (
    <SafeScreen edges={["top"]}>
      <ScreenHeader title={order?.order_number ?? "Order"} onBack={() => nav.goBack()} />

      {isLoading && !order ? (
        <View style={s.body}>
          <Skeleton height={120} borderRadius={16} />
          <Skeleton height={200} borderRadius={16} />
        </View>
      ) : isError && !order ? (
        <View style={s.body}>
          <LoadFailed
            what="this order"
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : order ? (
        <>
          <ScrollView contentContainerStyle={s.body}>
            <Detail order={order} />
          </ScrollView>
          <Actions order={order} busy={busy} onMove={moveTo} onReject={reject} />
        </>
      ) : null}
    </SafeScreen>
  );
}

function Detail({ order }: { order: Order }) {
  const c = useColors();
  const s = styles(c);
  const items = order.items ?? [];

  return (
    <>
      <View style={s.card}>
        <View style={s.stageRow}>
          <Text style={s.stage}>{STATUS_LABEL[order.status]}</Text>
          <Text style={s.kind}>
            {order.fulfillment_type === "delivery"
              ? "Delivery"
              : order.fulfillment_type === "pickup"
                ? "Collection"
                : "Dine in"}
          </Text>
        </View>

        <Text style={s.name}>{order.customer_name}</Text>

        {order.customer_phone ? (
          <Text
            style={s.link}
            onPress={() => {
              void Linking.openURL(`tel:${order.customer_phone}`);
            }}
          >
            <PhoneIcon size={14} color={c.primaryPressed} /> {order.customer_phone}
          </Text>
        ) : null}

        {order.delivery_address ? (
          <Text style={s.address}>
            <MapPinIcon size={14} color={c.textMuted} /> {order.delivery_address}
          </Text>
        ) : null}

        {order.notes ? <Text style={s.notes}>“{order.notes}”</Text> : null}
      </View>

      <View style={s.card}>
        {items.map((item) => (
          <View key={item.id} style={s.line}>
            <Text style={s.qty}>{qtyText(item.quantity)}×</Text>
            <View style={s.lineBody}>
              <Text style={s.lineName}>
                {item.product_name}
                {item.variant_name ? ` · ${item.variant_name}` : ""}
              </Text>
              {item.modifiers && item.modifiers.length > 0 ? (
                <Text style={s.mods} numberOfLines={2}>
                  {item.modifiers.map((m) => m.option ?? m.name).filter(Boolean).join(", ")}
                </Text>
              ) : null}
            </View>
            <Text style={s.lineTotal}>{money(item.line_total)}</Text>
          </View>
        ))}

        <View style={s.rule} />

        <Row label="Subtotal" value={money(order.subtotal)} />
        {Number(order.delivery_fee) > 0 ? (
          <Row label="Delivery" value={money(order.delivery_fee)} />
        ) : null}
        <Row label="Total" value={money(order.total)} strong />
        <Row
          label="Payment"
          value={`${order.payment_method === "cod" ? "Cash on delivery" : "Paid"} · ${order.payment_status}`}
        />
      </View>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const s = styles(useColors());
  return (
    <View style={s.totalRow}>
      <Text style={[s.totalLabel, strong ? s.strong : null]}>{label}</Text>
      <Text style={[s.totalValue, strong ? s.strong : null]}>{value}</Text>
    </View>
  );
}

/**
 * The bar that does not scroll away.
 *
 * Pinned, because the action is why this screen was opened and hunting for it
 * under a long order is time somebody does not have.
 */
function Actions({
  order,
  busy,
  onMove,
  onReject,
}: {
  order: Order;
  busy: boolean;
  onMove: (s: OrderStatus) => void;
  onReject: () => void;
}) {
  const s = styles(useColors());
  const next = nextStates(order.status, order.fulfillment_type);
  const forward = next.find((n) => n !== "cancelled");
  const canCancel = next.includes("cancelled");

  // A finished order has nothing to do — and an empty bar is better than a
  // disabled button, which invites a press that can never work.
  if (!forward && !canCancel) return null;

  return (
    <View style={s.actions}>
      {forward ? (
        <AppButton
          title={ACTION_LABEL[forward]}
          onPress={() => onMove(forward)}
          loading={busy}
          size="lg"
        />
      ) : null}
      {canCancel ? (
        <Text style={s.reject} onPress={busy ? undefined : onReject}>
          Cancel this order
        </Text>
      ) : null}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    stageRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    stage: { ...typography.label, color: c.primaryPressed },
    kind: { ...typography.small, color: c.textSecondary },
    name: { ...typography.h3, fontSize: 18, color: c.text },
    link: { ...typography.body, color: c.primaryPressed },
    address: { ...typography.body, color: c.textSecondary, lineHeight: 21 },
    notes: { ...typography.body, color: c.text, fontStyle: "italic" },

    line: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
    qty: { ...typography.label, color: c.textSecondary, minWidth: 34 },
    lineBody: { flex: 1, gap: 2 },
    lineName: { ...typography.body, color: c.text },
    mods: { ...typography.small, color: c.textSecondary },
    lineTotal: { ...typography.label, color: c.text },

    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: spacing.xs },
    totalRow: { flexDirection: "row", justifyContent: "space-between" },
    totalLabel: { ...typography.body, color: c.textSecondary },
    totalValue: { ...typography.body, color: c.text },
    strong: { ...typography.h3, fontSize: 17, color: c.text },

    actions: {
      padding: spacing.md,
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    reject: { ...typography.label, color: c.error, textAlign: "center", paddingVertical: spacing.sm },
  });
