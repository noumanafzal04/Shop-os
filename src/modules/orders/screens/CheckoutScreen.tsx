import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Banknote,
  Bike,
  ChevronRight,
  Clock,
  MapPin,
  PartyPopper,
  ShoppingBag,
  Store,
  Ticket,
  TriangleAlert,
} from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { ApiError } from "../../../common/types/api";
import { apiGet } from "../../../common/api/client";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useCartStore } from "../../../stores/cartStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useMarketShop } from "../../marketplace/hooks/useMarketplace";
import { usePlaceOrder } from "../hooks/useOrders";
import { SignInWall } from "../../auth/components/SignInWall";
import { useAuthStore } from "../../../stores/authStore";
import { money } from "../../../common/format";

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
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const { slug } = useRoute<RouteProp<Params, "Checkout">>().params;

  const cart = useCartStore();
  const status = useAuthStore((s) => s.status);
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

  const itemCount = lines.reduce(
    (n, l) => n + (l.sold_by === "weight" ? 1 : l.quantity),
    0,
  );
  const prep = shop.data?.prep_time_minutes ?? null;

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

  // An order has to belong to somebody. Asked HERE rather than at the door of
  // the app, and asked with the basket still assembled behind it — see
  // `SignInWall` for why this is a panel and not a redirect.
  if (status !== "authenticated") {
    return (
      <SafeScreen backgroundColor={c.bg}>
        <SignInWall
          icon={ShoppingBag}
          title="Sign in to place your order"
          message="Your basket is saved. We need an account so the shop knows who to deliver to and you can follow the order."
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen backgroundColor={c.bg}>
      {/*
        A header with a way out.

        This screen is a modal with no navigation bar, and the only way back
        was an outline button below the totals — under a form long enough that
        reaching it meant scrolling past everything you had just filled in.
        On Android the hardware key worked and nothing on screen said so.
      */}
      <View style={styles.head}>
        <Pressable
          style={styles.back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to cart"
          onPress={() => navigation.goBack()}
        >
          <ArrowLeft size={19} color={c.text} strokeWidth={2.3} />
        </Pressable>
        <View style={styles.headCopy}>
          <Text style={styles.title}>Checkout</Text>
          {!!shop.data && (
            <Text style={styles.sub} numberOfLines={1}>
              {shop.data.business_name}
            </Text>
          )}
        </View>
      </View>

      {/*
        The longest form in the app — address, phone, notes — with Place Order
        pinned under it. A plain ScrollView puts the keyboard straight over the
        button the person is trying to reach, on the one screen where being
        unable to reach it costs the order.
      */}
      <KeyboardScreen
        contentStyle={styles.content}
        footer={
          <View style={styles.bar}>
            <AppButton
              title={place.isPending ? "Placing order…" : `Place order · ${money(total)}`}
              onPress={submit}
              loading={place.isPending}
              disabled={lines.length === 0 || !deliveryReady || belowMinimum}
              size="lg"
            />
          </View>
        }
      >

        {closed && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>This shop is closed right now — orders will fail until it opens.</Text>
          </View>
        )}
        {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

        {/*
          What is in the order, as ONE line.

          The whole basket was listed here with a stepper on every row — a
          second cart, on the screen whose job is to confirm and pay. Eleven
          items pushed the address, the total and the button off the bottom,
          and the two copies could not disagree only because they shared a
          store: they still made the same screen twice.

          Changing your mind belongs in the basket, which is one tap away and
          says so.
        */}
        <Pressable
          style={({ pressed }) => [styles.basket, pressed && styles.basketPressed]}
          accessibilityRole="button"
          accessibilityLabel="Edit your basket"
          onPress={() => navigation.goBack()}
        >
          <View style={styles.basketIcon}>
            <ShoppingBag size={18} color={c.onPrimary} strokeWidth={2.2} />
          </View>
          <View style={styles.basketCopy}>
            <Text style={styles.basketCount}>
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </Text>
            <Text style={styles.basketShop} numberOfLines={1}>
              from {shop.data?.business_name ?? "this shop"}
            </Text>
          </View>
          <Text style={styles.basketEdit}>Edit</Text>
          <ChevronRight size={16} color={c.textMuted} strokeWidth={2.4} />
        </Pressable>

        {/*
          Delivery or pickup, as ONE control with two halves.

          Two separate chips both look pressable and neither looks pressED, so
          the screen never said which mode you were in — while this choice
          decides the address block, the fee and the minimum below it. A single
          track with one filled half can only ever show one answer.
        */}
        <Text style={styles.section}>How do you want it?</Text>
        <View style={styles.segment}>
          {canPickup && (
            <Pressable
              style={[styles.seg, fulfillment === "pickup" && styles.segOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: fulfillment === "pickup" }}
              onPress={() => setFulfillment("pickup")}
            >
              <Store
                size={15}
                color={fulfillment === "pickup" ? c.onPrimary : c.textSecondary}
                strokeWidth={2.2}
              />
              <Text style={[styles.segTxt, fulfillment === "pickup" && styles.segTxtOn]}>Pickup</Text>
            </Pressable>
          )}
          {canDeliver && (
            <Pressable
              style={[styles.seg, fulfillment === "delivery" && styles.segOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: fulfillment === "delivery" }}
              onPress={() => setFulfillment("delivery")}
            >
              <Bike
                size={15}
                color={fulfillment === "delivery" ? c.onPrimary : c.textSecondary}
                strokeWidth={2.2}
              />
              <Text style={[styles.segTxt, fulfillment === "delivery" && styles.segTxtOn]}>
                Delivery
                {(shop.data?.delivery_fee ?? 0) > 0 ? ` · ${money(shop.data!.delivery_fee!)}` : ""}
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
                  <MapPin size={15} color={on ? c.brand[600] : c.gray[400]} strokeWidth={2.2} />
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
              <MapPin size={15} color={addressId === null ? c.brand[600] : c.gray[400]} strokeWidth={2.2} />
              <Text style={styles.addrLabel}>Type a different address</Text>
            </Pressable>
            {addressId === null && (
              <AppTextInput placeholder="House, street, area…" value={address} onChangeText={setAddress} />
            )}
            {shop.data?.delivers_to_me === false && (
              <View style={styles.rangeWarnRow}>
                <TriangleAlert size={13} color={c.warning} strokeWidth={2.4} />
                <Text style={styles.rangeWarn}>
                  Your current pin looks outside this shop's delivery range.
                </Text>
              </View>
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

        {belowMinimum && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              Minimum order for delivery is {money(minOrder!)} — add {money(minOrder! - subtotal)} more, or switch to pickup.
            </Text>
          </View>
        )}
        {fulfillment === "delivery" && earnedFreeDelivery && (
          <View style={styles.freeBox}>
            <PartyPopper size={16} color={c.success} strokeWidth={2.2} />
            <Text style={styles.freeText}>You've earned FREE delivery!</Text>
          </View>
        )}

        <Text style={styles.section}>Order summary</Text>
        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Subtotal</Text>
            <Text style={styles.totalVal}>{money(subtotal)}</Text>
          </View>
          {fulfillment === "delivery" && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLbl}>Delivery fee</Text>
              {earnedFreeDelivery ? (
                <Text style={styles.totalFree}>FREE</Text>
              ) : (
                <Text style={styles.totalVal}>{money(deliveryFee)}</Text>
              )}
            </View>
          )}
          {!!coupon.trim() && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLbl}>Coupon {coupon.trim()}</Text>
              <Text style={styles.totalHint}>checked when you order</Text>
            </View>
          )}
          <View style={styles.totalRule} />
          <View style={styles.totalRow}>
            <Text style={styles.grand}>Total</Text>
            <Text style={styles.grandVal}>{money(total)}</Text>
          </View>
        </View>

        {/*
          The shop's own preparation time, and ONLY when it has set one.
          A default invents "30–50 min" for a shop that never said, which is a
          promise the app made on its behalf.
        */}
        {prep !== null && (
          <View style={styles.eta}>
            <Clock size={15} color={c.textSecondary} strokeWidth={2.2} />
            <Text style={styles.etaText}>
              {fulfillment === "delivery"
                ? `Estimated delivery: ${prep}–${prep + 20} min`
                : `Ready for pickup in about ${prep} min`}
            </Text>
          </View>
        )}

        <Text style={styles.section}>Payment method</Text>
        <View style={styles.payRow}>
          <Banknote size={19} color={c.success} strokeWidth={2} />
          <View style={styles.payCopy}>
            <Text style={styles.payText}>Cash on delivery</Text>
            <Text style={styles.payHint}>Pay when you receive your order</Text>
          </View>
          {/* Selected, and the only option — drawn rather than implied. */}
          <View style={styles.radio}>
            <View style={styles.radioDot} />
          </View>
        </View>

      </KeyboardScreen>
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },

  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  headCopy: { flex: 1 },

  /** The pinned action bar — see `KeyboardScreen`'s `footer`. */
  bar: {
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  basket: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  basketPressed: { backgroundColor: c.surfaceAlt },
  basketIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  basketCopy: { flex: 1 },
  basketCount: { ...typography.label, color: c.text, fontSize: 14.5 },
  basketShop: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
  basketEdit: { ...typography.small, color: c.primary, fontWeight: "700" },

  eta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  etaText: { ...typography.small, color: c.textSecondary },

  payCopy: { flex: 1 },
  payHint: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: c.primary },

  segment: {
    flexDirection: "row",
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.full,
    padding: 4,
    gap: 4,
    marginBottom: spacing.sm,
  },
  seg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: radius.full,
  },
  segOn: { backgroundColor: c.primary },
  segTxt: { ...typography.small, color: c.textSecondary, fontWeight: "600" },
  segTxtOn: { color: c.onPrimary },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  payText: { ...typography.label, color: c.text, flex: 1, fontSize: 14 },
  title: { ...typography.title, color: c.text },
  sub: { ...typography.tiny, color: c.textSecondary, marginTop: 1 },

  warnBox: { backgroundColor: c.warningBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  warnText: { ...typography.small, color: c.warning },
  freeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.successBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  freeText: { ...typography.small, color: c.success, fontWeight: "700" },
  errorBox: { backgroundColor: c.errorBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  errorText: { ...typography.small, color: c.error },


  section: { ...typography.label, color: c.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipActive: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  chipTxt: { color: c.gray[600], fontSize: 13, fontWeight: "500" },
  chipTxtActive: { color: c.white },

  addrBlock: { gap: spacing.xs, marginBottom: spacing.sm },
  addr: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  addrOn: { borderColor: c.brand[500], backgroundColor: c.brand[50] },
  addrInfo: { flex: 1, gap: 1 },
  addrLabel: { ...typography.label, color: c.text, fontSize: 13 },
  addrText: { ...typography.tiny, color: c.gray[500] },
  rangeWarnRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  rangeWarn: { ...typography.tiny, color: c.warning, flex: 1 },

  couponRow: { marginTop: spacing.xs },
  couponInput: { marginBottom: spacing.xs },

  totals: {
    marginTop: spacing.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  totalLbl: { ...typography.small, color: c.textSecondary },
  totalVal: { ...typography.small, color: c.text, fontWeight: "600" },
  totalFree: { ...typography.small, color: c.success, fontWeight: "800" },
  totalHint: { ...typography.tiny, color: c.textMuted },
  totalRule: { height: 1, backgroundColor: c.border, marginVertical: 8 },
  grand: { ...typography.h3, fontSize: 16, color: c.text },
  grandVal: { ...typography.title, fontSize: 21, color: c.primary },
});
