import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Ticket } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { StepBar } from "../../../common/ui/StepBar";
import { ApiError } from "../../../common/types/api";
import { apiGet } from "../../../common/api/client";
import { colors, radius, spacing, typography } from "../../../theme";
import { useCartStore, cartKeyOf } from "../../../stores/cartStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useMarketShop } from "../../marketplace/hooks/useMarketplace";
import { usePlaceOrder } from "../hooks/useOrders";

const money = (n: number) => `Rs ${n.toLocaleString()}`;
const fmtQty = (n: number) => String(parseFloat(n.toFixed(3)));
type Params = { Checkout: { slug: string } };

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

/** Friendly copy for the COD errors the backend enforces. */
const ERROR_COPY: Record<string, string> = {
  SHOP_CLOSED: "This shop is closed right now — try again during business hours.",
  OUT_OF_DELIVERY_AREA: "", // server message already explains the distance
  MIN_ORDER_QTY: "",
  INSUFFICIENT_STOCK: "Something in your cart just sold out — adjust the quantity and retry.",
};

export function CheckoutScreen() {
  const navigation = useNavigation<any>();
  const { slug } = useRoute<RouteProp<Params, "Checkout">>().params;

  const cart = useCartStore();
  const pin = useLocationStore();
  const shop = useMarketShop(slug, { lat: pin.lat ?? undefined, lng: pin.lng ?? undefined });
  const place = usePlaceOrder();

  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: async () => (await apiGet<SavedAddress[]>("/customer/addresses")).data,
  });

  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [coupon, setCoupon] = useState("");
  const [notes, setNotes] = useState("");

  // Preselect the default saved address once loaded.
  useEffect(() => {
    if (addressId === null && (addresses.data?.length ?? 0) > 0) {
      const def = addresses.data!.find((a) => a.is_default) ?? addresses.data![0];
      setAddressId(def.id);
    }
  }, [addresses.data, addressId]);

  const lines = cart.shopSlug === slug ? cart.lines : [];
  const canDeliver = shop.data?.fulfillment?.delivery ?? shop.data?.features?.delivery ?? false;
  const canPickup = shop.data?.fulfillment?.pickup ?? true;
  const closed = shop.data?.is_open_now === false;

  // Snap to a mode the shop actually offers.
  useEffect(() => {
    if (!shop.data) return;
    if (fulfillment === "pickup" && !canPickup) setFulfillment("delivery");
    if (fulfillment === "delivery" && !canDeliver) setFulfillment("pickup");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.data]);

  // Delivery economics (display estimates — the server is authoritative).
  const subtotal = cart.subtotal();
  const freeAbove = shop.data?.free_delivery_threshold ?? null;
  const earnedFreeDelivery = freeAbove != null && subtotal >= freeAbove;
  const deliveryFee = fulfillment === "delivery" && !earnedFreeDelivery ? (shop.data?.delivery_fee ?? 0) : 0;
  const total = subtotal + deliveryFee;
  const minOrder = shop.data?.min_order_amount ?? null;
  const belowMinimum = fulfillment === "delivery" && minOrder != null && subtotal < minOrder;

  const selected = addresses.data?.find((a) => a.id === addressId) ?? null;
  const deliveryText = selected ? selected.address : address.trim();
  const deliveryReady = fulfillment !== "delivery" || deliveryText.length > 0;

  const apiError = place.error instanceof ApiError ? place.error : null;
  const error = apiError
    ? ERROR_COPY[apiError.errorCode ?? ""] || apiError.firstFieldError() || apiError.message
    : null;

  const submit = () => {
    if (lines.length === 0 || place.isPending || !deliveryReady) return;
    // The pin: the saved address's coordinates, else the live GPS pin.
    const lat = selected?.latitude ?? pin.lat ?? undefined;
    const lng = selected?.longitude ?? pin.lng ?? undefined;
    place.mutate(
      {
        shop_slug: slug,
        fulfillment_type: fulfillment,
        delivery_address: fulfillment === "delivery" ? deliveryText : undefined,
        latitude: fulfillment === "delivery" ? lat : undefined,
        longitude: fulfillment === "delivery" ? lng : undefined,
        coupon_code: coupon.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? undefined,
          quantity: l.quantity,
          modifier_option_ids: l.modifier_option_ids?.length ? l.modifier_option_ids : undefined,
        })),
      },
      {
        onSuccess: (res) => {
          cart.clear();
          // Straight to live tracking for the order we just placed.
          const id = res?.data?.id;
          if (id) navigation.navigate("Order", { id });
          else navigation.navigate("Tabs", { screen: "OrdersTab" });
        },
      },
    );
  };

  return (
    <SafeScreen backgroundColor={colors.bg}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Checkout</Text>
        <Text style={styles.sub}>{shop.data?.business_name}</Text>
        <View style={{ marginBottom: spacing.md }}>
          <StepBar active={3} />
        </View>

        {closed && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>This shop is closed right now — orders will fail until it opens.</Text>
          </View>
        )}
        {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

        {/* Items */}
        <View style={styles.card}>
          {lines.map((l) => {
            const k = cartKeyOf(l);
            const step = l.sold_by === "weight" ? 0.25 : 1;
            return (
              <View key={k} style={styles.line}>
                <View style={styles.lineInfo}>
                  <Text style={styles.lineName} numberOfLines={1}>{l.name}</Text>
                  {!!l.modifiers_label && <Text style={styles.lineMods} numberOfLines={1}>{l.modifiers_label}</Text>}
                </View>
                <View style={styles.stepper}>
                  <Pressable style={styles.step} onPress={() => cart.setQty(k, l.quantity - step)}>
                    <Text style={styles.stepTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.qty}>
                    {fmtQty(l.quantity)}{l.sold_by === "weight" && l.unit_label ? ` ${l.unit_label}` : ""}
                  </Text>
                  <Pressable style={styles.step} onPress={() => cart.setQty(k, l.quantity + step)}>
                    <Text style={styles.stepTxt}>+</Text>
                  </Pressable>
                </View>
                <Text style={styles.lineTotal}>{money(l.unit_price * l.quantity)}</Text>
              </View>
            );
          })}
        </View>

        {/* Fulfillment */}
        <Text style={styles.section}>How do you want it?</Text>
        <View style={styles.chips}>
          {canPickup && (
            <Pressable onPress={() => setFulfillment("pickup")} style={[styles.chip, fulfillment === "pickup" && styles.chipActive]}>
              <Text style={[styles.chipTxt, fulfillment === "pickup" && styles.chipTxtActive]}>Pickup</Text>
            </Pressable>
          )}
          {canDeliver && (
            <Pressable onPress={() => setFulfillment("delivery")} style={[styles.chip, fulfillment === "delivery" && styles.chipActive]}>
              <Text style={[styles.chipTxt, fulfillment === "delivery" && styles.chipTxtActive]}>
                Delivery{(shop.data?.delivery_fee ?? 0) > 0 ? ` (+${money(shop.data!.delivery_fee!)})` : ""}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Delivery address — saved pins first, manual fallback */}
        {fulfillment === "delivery" && (
          <View style={styles.addrBlock}>
            {(addresses.data ?? []).map((a) => {
              const on = addressId === a.id;
              return (
                <Pressable key={a.id} style={[styles.addr, on && styles.addrOn]} onPress={() => setAddressId(a.id)}>
                  <MapPin size={15} color={on ? colors.brand[600] : colors.gray[400]} strokeWidth={2.2} />
                  <View style={styles.addrInfo}>
                    <Text style={styles.addrLabel}>{a.label}{a.is_default ? " · default" : ""}</Text>
                    <Text style={styles.addrText} numberOfLines={1}>{a.address}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.addr, addressId === null && styles.addrOn]}
              onPress={() => setAddressId(null)}
            >
              <MapPin size={15} color={addressId === null ? colors.brand[600] : colors.gray[400]} strokeWidth={2.2} />
              <Text style={styles.addrLabel}>Type a different address</Text>
            </Pressable>
            {addressId === null && (
              <AppTextInput placeholder="House, street, area…" value={address} onChangeText={setAddress} />
            )}
            {shop.data?.delivers_to_me === false && (
              <Text style={styles.rangeWarn}>⚠ Your current pin looks outside this shop's delivery range.</Text>
            )}
          </View>
        )}

        {/* Coupon + notes */}
        <View style={styles.couponRow}>
          <View style={styles.couponInput}>
            <AppTextInput
              icon={Ticket}
              placeholder="Coupon code (optional)"
              value={coupon}
              onChangeText={(v) => setCoupon(v.toUpperCase())}
              autoCapitalize="characters"
            />
          </View>
        </View>
        <AppTextInput placeholder="Notes for the shop (optional)" value={notes} onChangeText={setNotes} />

        {/* Payment method — COD only (per platform policy) */}
        <Text style={styles.section}>Payment method</Text>
        <View style={styles.payRow}>
          <Text style={styles.payEmoji}>💵</Text>
          <Text style={styles.payText}>Cash on delivery</Text>
          <Text style={styles.payAmount}>{money(total)}</Text>
        </View>

        {belowMinimum && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              Minimum order for delivery is {money(minOrder!)} — add {money(minOrder! - subtotal)} more, or switch to pickup.
            </Text>
          </View>
        )}
        {fulfillment === "delivery" && earnedFreeDelivery && (
          <View style={styles.freeBox}>
            <Text style={styles.freeText}>🎉 You've earned FREE delivery!</Text>
          </View>
        )}

        {/* Totals */}
        <View style={styles.totals}>
          <View style={styles.totalRow}><Text style={styles.totalLbl}>Subtotal</Text><Text style={styles.totalLbl}>{money(subtotal)}</Text></View>
          {deliveryFee > 0 && <View style={styles.totalRow}><Text style={styles.totalLbl}>Delivery</Text><Text style={styles.totalLbl}>{money(deliveryFee)}</Text></View>}
          {!!coupon.trim() && <View style={styles.totalRow}><Text style={styles.totalLbl}>Coupon</Text><Text style={styles.totalLbl}>applied at order</Text></View>}
          <View style={styles.totalRow}><Text style={styles.grand}>Total</Text><Text style={styles.grand}>{money(total)}</Text></View>
          <Text style={styles.codNote}>💵 Cash on delivery — pay when you receive your order.</Text>
        </View>

        <AppButton
          title={place.isPending ? "Placing order…" : `Place order · ${money(total)}`}
          onPress={submit}
          loading={place.isPending}
          disabled={lines.length === 0 || !deliveryReady || belowMinimum}
          style={{ marginTop: spacing.md }}
        />
        <AppButton title="Keep shopping" variant="outline" onPress={() => navigation.goBack()} style={{ marginTop: spacing.sm }} />
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  payEmoji: { fontSize: 18 },
  payText: { ...typography.label, color: colors.black, flex: 1, fontSize: 14 },
  payAmount: { ...typography.label, color: colors.brand[600], fontSize: 15 },
  title: { ...typography.title, fontSize: 24, color: colors.black },
  sub: { ...typography.body, color: colors.gray[500], marginTop: 2, marginBottom: spacing.md },

  warnBox: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  warnText: { ...typography.small, color: colors.warning },
  freeBox: { backgroundColor: colors.successBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  freeText: { ...typography.small, color: colors.success, fontWeight: "700" },
  errorBox: { backgroundColor: colors.errorBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  errorText: { ...typography.small, color: colors.error },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  line: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.sm },
  lineInfo: { flex: 1, gap: 1 },
  lineName: { ...typography.body, color: colors.black, fontSize: 14, fontWeight: "500" },
  lineMods: { ...typography.tiny, color: colors.gray[400] },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  step: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  stepTxt: { fontSize: 15, color: colors.gray[700] },
  qty: { minWidth: 34, textAlign: "center", color: colors.black, fontSize: 13, fontWeight: "600" },
  lineTotal: { width: 76, textAlign: "right", ...typography.label, color: colors.black, fontSize: 14 },

  section: { ...typography.label, color: colors.black, marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand[500], borderColor: colors.brand[500] },
  chipTxt: { color: colors.gray[600], fontSize: 13, fontWeight: "500" },
  chipTxtActive: { color: colors.white },

  addrBlock: { gap: spacing.xs, marginBottom: spacing.sm },
  addr: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  addrOn: { borderColor: colors.brand[500], backgroundColor: colors.brand[50] },
  addrInfo: { flex: 1, gap: 1 },
  addrLabel: { ...typography.label, color: colors.black, fontSize: 13 },
  addrText: { ...typography.tiny, color: colors.gray[500] },
  rangeWarn: { ...typography.tiny, color: colors.warning },

  couponRow: { marginTop: spacing.xs },
  couponInput: { marginBottom: spacing.xs },

  totals: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLbl: { ...typography.body, color: colors.gray[600], fontSize: 14 },
  grand: { ...typography.title, fontSize: 18, color: colors.black },
  codNote: { ...typography.tiny, color: colors.gray[500], marginTop: spacing.xs },
});
